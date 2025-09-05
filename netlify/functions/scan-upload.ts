import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore } from '@netlify/blobs'

const MAX_BYTES = 10 * 1024 * 1024 // 10MB
const STORE_NAME = 'scans'

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
      tenantId: decodedToken.tenantId,
      userId: decodedToken.userId,
      email: decodedToken.email,
      tenantSlug: decodedToken.tenantSlug
    }
  } catch (error) {
    console.error('JWT verification failed:', error)
    return null
  }
}

// Simple multipart form parser for Netlify Functions
async function parseMultipartForm(event: any) {
  console.log('=== MULTIPART PARSING START ===')
  
  const requestContentType = event.headers['content-type'] || event.headers['Content-Type']
  console.log('Request Content-Type:', requestContentType)
  
  if (!requestContentType?.includes('multipart/form-data')) {
    console.error('Invalid content type:', requestContentType)
    throw new Error('Content-Type must be multipart/form-data')
  }

  const boundary = requestContentType.match(/boundary=([^;]+)/)?.[1]
  console.log('Boundary extracted:', boundary)
  
  if (!boundary) {
    console.error('No boundary found in content type')
    throw new Error('No boundary found in Content-Type')
  }

  // Get raw body
  let bodyBuffer: Buffer
  console.log('Event body type:', typeof event.body)
  console.log('Is base64 encoded:', event.isBase64Encoded)
  console.log('Body length (string):', event.body ? event.body.length : 'null')
  
  try {
    if (event.isBase64Encoded) {
      bodyBuffer = Buffer.from(event.body, 'base64')
      console.log('Decoded from base64, buffer size:', bodyBuffer.length)
    } else {
      bodyBuffer = Buffer.from(event.body, 'utf8') // Try UTF-8 instead of binary
      console.log('Decoded from UTF-8, buffer size:', bodyBuffer.length)
    }
  } catch (decodeError) {
    console.error('Failed to decode body:', decodeError)
    throw new Error('Failed to decode request body')
  }

  console.log('Body buffer size:', bodyBuffer.length, 'bytes')
  console.log('First 200 chars of body:', bodyBuffer.toString('utf8', 0, 200))
  
  // Check size before parsing
  if (bodyBuffer.length > MAX_BYTES + 10000) { // Add some buffer for form data overhead
    console.error('Body too large:', bodyBuffer.length)
    throw new Error(`Request too large. Maximum size is ${MAX_BYTES} bytes`)
  }

  const boundaryBuffer = Buffer.from(`--${boundary}`)
  console.log('Looking for boundary:', `--${boundary}`)
  
  const parts = []
  let start = 0
  let partCount = 0
  
  while (true) {
    const boundaryIndex = bodyBuffer.indexOf(boundaryBuffer, start)
    console.log(`Looking for boundary at position ${start}, found at:`, boundaryIndex)
    
    if (boundaryIndex === -1) break
    
    if (start > 0) {
      const part = bodyBuffer.slice(start, boundaryIndex)
      parts.push(part)
      partCount++
      console.log(`Part ${partCount} size:`, part.length)
    }
    start = boundaryIndex + boundaryBuffer.length
  }

  console.log(`Total parts found: ${parts.length}`)

  let name = ''
  let fileBuffer: Buffer | null = null
  let filename = 'upload'
  let contentType = 'application/octet-stream'

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    console.log(`\n=== Processing Part ${i + 1} ===`)
    console.log('Part size:', part.length)
    
    // Look for the header/body separator (double CRLF)
    const separatorIndex = part.indexOf('\r\n\r\n')
    if (separatorIndex === -1) {
      console.log('No header separator found in part', i + 1)
      continue
    }

    const headerPart = part.slice(0, separatorIndex).toString('utf8')
    const dataPart = part.slice(separatorIndex + 4)
    
    console.log('Header part:', headerPart)
    console.log('Data part size:', dataPart.length)
    
    if (headerPart.includes('Content-Disposition: form-data')) {
      const lines = headerPart.split('\r\n')
      const dispositionLine = lines.find(line => line.includes('Content-Disposition'))
      
      console.log('Disposition line:', dispositionLine)
      
      if (!dispositionLine) continue
      
      if (dispositionLine.includes('name="name"')) {
        name = dataPart.toString('utf8').trim()
        console.log('Found name field:', name)
      } else if (dispositionLine.includes('name="file"')) {
        // Extract filename
        const filenameMatch = dispositionLine.match(/filename="([^"]*)"/)
        if (filenameMatch) {
          filename = filenameMatch[1] || 'upload'
          console.log('Found filename:', filename)
        }
        
        // Find content type
        const contentTypeLine = lines.find(line => line.startsWith('Content-Type:'))
        if (contentTypeLine) {
          contentType = contentTypeLine.split('Content-Type:')[1].trim()
          console.log('Found content type:', contentType)
        }
        
        fileBuffer = dataPart
        console.log('File buffer size:', fileBuffer.length)
      }
    }
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    console.error('No file data found after parsing')
    console.log('Debug: name =', name, 'filename =', filename, 'fileBuffer =', fileBuffer?.length || 'null')
    throw new Error('No file data found')
  }

  if (fileBuffer.length > MAX_BYTES) {
    console.error('File too large after parsing:', fileBuffer.length)
    throw new Error(`File too large. Maximum size is ${MAX_BYTES} bytes`)
  }

  console.log('=== PARSING SUCCESS ===')
  console.log('Final parsed result:', {
    name: name || filename,
    filename,
    size: fileBuffer.length,
    contentType
  })

  return {
    name: name || filename || 'upload',
    fileBuffer,
    filename,
    contentType,
    size: fileBuffer.length
  }
}

export const handler: Handler = async (event, context) => {
  console.log('=== SCAN UPLOAD ===')
  console.log('Method:', event.httpMethod)
  console.log('Content-Type:', event.headers['content-type'])
  console.log('Headers:', JSON.stringify(event.headers))
  console.log('Body length:', event.body ? event.body.length : 'No body')
  console.log('Is base64 encoded:', event.isBase64Encoded)

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  // Get auth context
  const auth = getAuthContext(event)
  if (!auth) {
    console.log('Authentication failed')
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    }
  }

  console.log('Authenticated user:', { 
    tenantId: auth.tenantId, 
    userId: auth.userId,
    email: auth.email 
  })

  try {
    // Parse multipart form data
    const { name, fileBuffer, filename, contentType, size } = await parseMultipartForm(event)
    
    console.log('Parsed form data:', {
      name,
      filename,
      contentType,
      size
    })

    // Build storage key with multi-tenant isolation
    const safeTenantId = sanitizeName(auth.tenantId)
    const date = getCurrentDate()
    const safeName = sanitizeName(name)
    const key = `${safeTenantId}/${date}/${safeName}`

    console.log('Storage key:', key)

    // Store in Netlify Blobs
    const store = getStore(STORE_NAME)
    await store.set(key, fileBuffer, {
      metadata: {
        tenantId: auth.tenantId,
        originalName: name,
        filename,
        contentType,
        size: size.toString(),
        uploadedAt: new Date().toISOString(),
        userId: auth.userId,
        email: auth.email,
        kind: 'scan'
      }
    })

    console.log('File stored successfully')

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        key,
        bytes: size,
        contentType
      })
    }

  } catch (error) {
    console.error('Upload error:', error)
    console.error('Error details:', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    })
    
    if (error instanceof Error && error.message.includes('too large')) {
      return {
        statusCode: 413,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'File too large. Maximum size is 10MB' })
      }
    }

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Bad request',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}