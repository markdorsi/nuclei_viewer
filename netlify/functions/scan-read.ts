import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore } from '@netlify/blobs'

const STORE_NAME = 'scans'

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

export const handler: Handler = async (event, context) => {
  console.log('=== SCAN READ ===')
  console.log('Method:', event.httpMethod)

  if (event.httpMethod !== 'GET') {
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

  try {
    // Get key from query parameters
    const params = new URLSearchParams(event.queryStringParameters || {})
    const key = params.get('key')
    
    if (!key) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing key parameter' })
      }
    }

    console.log('Reading key:', key)

    // Enforce multi-tenant isolation
    const requiredPrefix = `${auth.tenantId}/`
    if (!key.startsWith(requiredPrefix)) {
      console.log(`Access denied: key "${key}" does not start with "${requiredPrefix}"`)
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Access denied' })
      }
    }

    // Get blob from store
    const store = getStore(STORE_NAME)
    const blob = await store.get(key)
    
    if (!blob) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'File not found' })
      }
    }

    console.log('File found, streaming content')

    // Get content type from metadata or default
    let contentType = 'application/octet-stream'
    if (blob.metadata?.contentType) {
      contentType = blob.metadata.contentType
    }

    // Convert blob to buffer and return
    const buffer = await blob.arrayBuffer()
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.byteLength.toString(),
        'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`
      },
      body: Buffer.from(buffer).toString('base64'),
      isBase64Encoded: true
    }

  } catch (error) {
    console.error('Read error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}