import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore, connectLambda } from '@netlify/blobs'

// Extract tenant from URL path
function getTenantFromPath(event: any) {
  // Try to get tenant from path like /api/t/tenantSlug/scans/abort
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
  console.log('=== SCAN ABORT ===')
  
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

    console.log(`Aborting upload ${uploadId}`)

    // Get session from Netlify Blobs
    const sessionsStore = getStore('uploads-sessions')
    
    const sessionDataText = await sessionsStore.get(`${uploadId}.json`)
    const sessionData = sessionDataText ? JSON.parse(sessionDataText) : null
    
    if (!sessionData) {
      // Already deleted or never existed
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      }
    }

    // Verify ownership (check tenant slug in session matches URL)
    if (sessionData.tenantSlug !== tenantSlug) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Forbidden' })
      }
    }

    // Delete partial blob if it exists
    if (sessionData.key && sessionData.status === 'in_progress') {
      const scansStore = getStore('scans')
      
      try {
        await scansStore.delete(sessionData.key)
        console.log(`Deleted partial blob at ${sessionData.key}`)
      } catch (error) {
        console.warn(`Failed to delete partial blob: ${error}`)
      }
    }

    // Delete session
    await sessionsStore.delete(`${uploadId}.json`)
    console.log(`Aborted upload ${uploadId}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ok: true,
        uploadId,
        deletedBytes: sessionData.receivedBytes || 0
      })
    }
  } catch (error) {
    console.error('Abort upload error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to abort upload',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}