import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore, connectLambda } from '@netlify/blobs'
import crypto from 'crypto'

// Extract tenant from URL path
function getTenantFromPath(event: any) {
  // Try to get tenant from path like /api/t/tenantSlug/scans/complete
  if (event.path.includes('/t/')) {
    const pathParts = event.path.split('/')
    const tIndex = pathParts.findIndex(part => part === 't')
    if (tIndex !== -1 && pathParts[tIndex + 1]) {
      return pathParts[tIndex + 1]
    }
  }
  return null
}

export const handler: Handler = async (event, context) => {
  console.log('=== SCAN COMPLETE ===')
  
  // Initialize Netlify Blobs for Lambda compatibility mode
  connectLambda(event)
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  // Get tenant from path
  const tenantSlug = getTenantFromPath(event)
  if (!tenantSlug) {
    console.log('Tenant slug missing from path')
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Tenant parameter missing', debug: { path: event.path } })
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { uploadId } = body

    if (!uploadId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'uploadId is required' })
      }
    }

    console.log(`Completing upload ${uploadId}`)

    // Get session from Netlify Blobs
    const sessionsStore = getStore('uploads-sessions')
    
    const sessionDataText = await sessionsStore.get(`${uploadId}.json`)
    const sessionData = sessionDataText ? JSON.parse(sessionDataText) : null
    
    if (!sessionData) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Upload session not found' })
      }
    }

    // Verify ownership
    if (sessionData.tenantSlug !== tenantSlug) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Forbidden' })
      }
    }

    // Check if already completed (idempotency)
    if (sessionData.status === 'complete') {
      console.log('Upload already completed')
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      }
    }

    // Verify all bytes received
    if (sessionData.receivedBytes !== sessionData.expectedBytes) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Incomplete upload',
          receivedBytes: sessionData.receivedBytes,
          expectedBytes: sessionData.expectedBytes
        })
      }
    }

    // Optional: Verify overall SHA-256 if provided
    if (sessionData.overallSha256) {
      const scansStore = getStore('scans')
      
      const blob = await scansStore.get(sessionData.key)
      if (blob) {
        const buffer = Buffer.from(await blob.arrayBuffer())
        const actualHash = crypto.createHash('sha256').update(buffer).digest('hex')
        
        if (actualHash !== sessionData.overallSha256) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              error: 'File hash mismatch',
              expected: sessionData.overallSha256,
              actual: actualHash
            })
          }
        }
      }
    }

    // Write metadata record
    const metaStore = getStore('scans-meta')
    
    const metadataKey = `records/${sessionData.tenantSlug}/${sessionData.key}.json`
    const metadata = {
      tenantSlug: sessionData.tenantSlug,
      key: sessionData.key,
      size: sessionData.receivedBytes,
      contentType: sessionData.contentType,
      originalName: sessionData.originalName,
      createdAt: sessionData.createdAt,
      completedAt: new Date().toISOString(),
      overallSha256: sessionData.overallSha256 || null,
      chunks: sessionData.chunks.length,
      uploadId: uploadId,
      userId: null, // User info not available in tenant-aware routing
      email: null
    }
    
    await metaStore.set(metadataKey, JSON.stringify(metadata))

    // Update session status
    sessionData.status = 'complete'
    sessionData.completedAt = new Date().toISOString()
    await sessionsStore.set(`${uploadId}.json`, JSON.stringify(sessionData))

    console.log(`Upload ${uploadId} completed successfully`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ok: true,
        key: sessionData.key,
        size: sessionData.receivedBytes,
        chunks: sessionData.chunks.length
      })
    }
  } catch (error) {
    console.error('Complete upload error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to complete upload',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}