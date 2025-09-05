import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore } from '@netlify/blobs'

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
  console.log('=== SCAN ABORT ===')
  
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

    console.log(`Aborting upload ${uploadId}`)

    // Get session from Netlify Blobs
    const sessionsStore = getStore({
      name: 'uploads-sessions',
      consistency: 'strong'
    })
    
    const sessionData = await sessionsStore.getJSON(`${uploadId}.json`) as any
    
    if (!sessionData) {
      // Already deleted or never existed
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
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

    // Delete partial blob if it exists
    if (sessionData.key && sessionData.status === 'in_progress') {
      const scansStore = getStore({
        name: 'scans',
        consistency: 'strong'
      })
      
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