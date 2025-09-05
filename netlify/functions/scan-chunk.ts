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
  console.log('=== SCAN CHUNK ===')
  
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
    // Parse query parameters
    const uploadId = event.queryStringParameters?.uploadId
    const index = parseInt(event.queryStringParameters?.index || '0')
    const total = parseInt(event.queryStringParameters?.total || '0')
    
    if (!uploadId || isNaN(index) || isNaN(total)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'uploadId, index, and total are required query parameters' 
        })
      }
    }

    console.log(`Processing chunk ${index}/${total} for upload ${uploadId}`)

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

    // Check session status
    if (sessionData.status !== 'in_progress') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: `Upload session is ${sessionData.status}, cannot accept chunks` 
        })
      }
    }

    // Get chunk data
    let chunkBuffer: Buffer
    if (event.isBase64Encoded) {
      chunkBuffer = Buffer.from(event.body, 'base64')
    } else {
      chunkBuffer = Buffer.from(event.body, 'binary')
    }

    const chunkSize = chunkBuffer.length
    console.log(`Chunk size: ${chunkSize} bytes`)

    // Optional: verify chunk hash if provided
    const expectedHash = event.headers['x-chunk-sha256'] || event.headers['X-Chunk-SHA256']
    if (expectedHash) {
      const actualHash = crypto.createHash('sha256').update(chunkBuffer).digest('hex')
      if (actualHash !== expectedHash) {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            error: 'Chunk hash mismatch',
            expected: expectedHash,
            actual: actualHash
          })
        }
      }
    }

    // Check for duplicate chunk (idempotency)
    const existingChunk = sessionData.chunks.find((c: any) => c.index === index)
    if (existingChunk) {
      console.log(`Chunk ${index} already received, returning success`)
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          receivedBytes: sessionData.receivedBytes,
          index,
          total
        })
      }
    }

    // Verify we won't exceed 5GB
    if (sessionData.receivedBytes + chunkSize > 5 * 1024 * 1024 * 1024) {
      return {
        statusCode: 413,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Upload would exceed 5GB limit' })
      }
    }

    // Append chunk to blob
    const scansStore = getStore({
      name: 'scans',
      consistency: 'strong'
    })
    
    // Get existing blob and append
    const existingBlob = await scansStore.get(sessionData.key)
    let combinedBuffer: Buffer
    
    if (existingBlob) {
      const existingBuffer = Buffer.from(await existingBlob.arrayBuffer())
      combinedBuffer = Buffer.concat([existingBuffer, chunkBuffer])
    } else {
      combinedBuffer = chunkBuffer
    }
    
    await scansStore.set(sessionData.key, combinedBuffer)

    // Update session
    sessionData.receivedBytes += chunkSize
    sessionData.chunks.push({
      index,
      size: chunkSize,
      hash: expectedHash || null,
      receivedAt: new Date().toISOString()
    })
    
    await sessionsStore.setJSON(`${uploadId}.json`, sessionData)

    console.log(`Chunk ${index} processed. Total received: ${sessionData.receivedBytes}/${sessionData.expectedBytes}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        receivedBytes: sessionData.receivedBytes,
        index,
        total
      })
    }
  } catch (error) {
    console.error('Chunk upload error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to process chunk',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}