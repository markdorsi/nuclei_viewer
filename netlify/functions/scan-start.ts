import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore } from '@netlify/blobs'
import crypto from 'crypto'

const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 // 5GB
const MAX_CHUNK_SIZE = 4 * 1024 * 1024 // 4MB default

// Sanitize filename to safe characters only
function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '_')
}

// Get current date in YYYY-MM-DD format
function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0]
}

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
  console.log('=== SCAN START ===')
  
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
    const { scanName, contentType, fileSize, overallSha256 } = body

    if (!scanName || !fileSize) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'scanName and fileSize are required' })
      }
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB` 
        })
      }
    }

    // Build storage key with multi-tenant isolation
    const safeTenantId = sanitizeName(auth.tenantId)
    const date = getCurrentDate()
    const safeName = sanitizeName(scanName)
    const key = `${safeTenantId}/${date}/${safeName}`
    const uploadId = crypto.randomUUID()

    console.log('Starting upload session:', {
      uploadId,
      key,
      tenantId: safeTenantId,
      fileSize,
      contentType
    })

    // Create session in Netlify Blobs
    const sessionsStore = getStore({
      name: 'uploads-sessions',
      consistency: 'strong'
    })
    
    const sessionData = {
      uploadId,
      tenantId: safeTenantId,
      key,
      status: 'in_progress',
      receivedBytes: 0,
      expectedBytes: fileSize,
      contentType: contentType || 'application/octet-stream',
      overallSha256: overallSha256 || null,
      originalName: scanName,
      createdAt: new Date().toISOString(),
      chunks: []
    }

    await sessionsStore.setJSON(`${uploadId}.json`, sessionData)

    // Initialize an empty blob at the destination key
    const scansStore = getStore({
      name: 'scans',
      consistency: 'strong'
    })
    
    // Create empty blob as placeholder
    await scansStore.set(key, new Uint8Array(0))

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId,
        key,
        maxChunkBytes: MAX_CHUNK_SIZE
      })
    }
  } catch (error) {
    console.error('Start upload error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to start upload',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}