import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore } from '@netlify/blobs'
import crypto from 'crypto'

// Extract auth context from JWT token
function getAuthContext(event: any) {
  const authHeader = event.headers.authorization || event.headers.Authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  try {
    const token = authHeader.substring(7)
    const jwtSecret = process.env.JWT_SECRET || 'your-jwt-secret-key'
    const decodedToken = jwt.verify(token, jwtSecret) as any
    
    return {
      tenantId: decodedToken.tenantId || decodedToken.tenant || decodedToken.sub || 'unknown',
      userId: decodedToken.userId,
      email: decodedToken.email
    }
  } catch (error) {
    console.error('JWT verification failed:', error)
    return null
  }
}

export const handler: Handler = async (event, context) => {
  console.log('=== SCAN COMPLETE ===')
  
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  // Get auth context
  const auth = getAuthContext(event)
  if (!auth) {
    console.log('Authentication failed')
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unauthorized' })
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
    const sessionsStore = getStore({
      name: 'uploads-sessions',
      consistency: 'strong'
    })
    
    const sessionData = await sessionsStore.getJSON(`${uploadId}.json`) as any
    
    if (!sessionData) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Upload session not found' })
      }
    }

    // Verify ownership
    if (sessionData.tenantId !== auth.tenantId) {
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
      const scansStore = getStore({
        name: 'scans',
        consistency: 'strong'
      })
      
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
    const metaStore = getStore({
      name: 'scans-meta',
      consistency: 'strong'
    })
    
    const metadataKey = `records/${sessionData.tenantId}/${sessionData.key}.json`
    const metadata = {
      tenantId: sessionData.tenantId,
      key: sessionData.key,
      size: sessionData.receivedBytes,
      contentType: sessionData.contentType,
      originalName: sessionData.originalName,
      createdAt: sessionData.createdAt,
      completedAt: new Date().toISOString(),
      overallSha256: sessionData.overallSha256 || null,
      chunks: sessionData.chunks.length,
      uploadId: uploadId,
      userId: auth.userId,
      email: auth.email
    }
    
    await metaStore.setJSON(metadataKey, metadata)

    // Update session status
    sessionData.status = 'complete'
    sessionData.completedAt = new Date().toISOString()
    await sessionsStore.setJSON(`${uploadId}.json`, sessionData)

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