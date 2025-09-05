import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore, connectLambda } from '@netlify/blobs'
import crypto from 'crypto'

// Extract tenant from URL path
function getTenantFromPath(event: any) {
  // Try to get tenant from path like /api/t/tenantSlug/scans/chunk
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
  console.log('=== SCAN CHUNK ===')
  
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
    const scansStore = getStore('scans')
    
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
    
    await sessionsStore.set(`${uploadId}.json`, JSON.stringify(sessionData))

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