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

// Extract tenant from URL path
function getTenantFromPath(event: any) {
  // Try to get tenant from path like /api/t/tenantSlug/scans/start
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
  console.log('=== SCAN START ===')
  
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
    const safeTenantSlug = sanitizeName(tenantSlug)
    const date = getCurrentDate()
    const safeName = sanitizeName(scanName)
    const key = `${safeTenantSlug}/${date}/${safeName}`
    const uploadId = crypto.randomUUID()

    console.log('Starting upload session:', {
      uploadId,
      key,
      tenantSlug: safeTenantSlug,
      fileSize,
      contentType
    })

    // Create session in Netlify Blobs
    const sessionsStore = getStore('uploads-sessions')
    
    const sessionData = {
      uploadId,
      tenantSlug: safeTenantSlug,
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
    const scansStore = getStore('scans')
    
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