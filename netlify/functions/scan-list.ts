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
  console.log('=== SCAN LIST ===')
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

  console.log('Authenticated user:', { 
    tenantId: auth.tenantId,
    email: auth.email 
  })

  try {
    // Get optional date filter from query parameters
    const params = new URLSearchParams(event.queryStringParameters || {})
    const date = params.get('date')
    
    // Build prefix for multi-tenant isolation
    let prefix = `${auth.tenantId}/`
    if (date) {
      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/
      if (!dateRegex.test(date)) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Invalid date format. Use YYYY-MM-DD' })
        }
      }
      prefix += `${date}/`
    }

    console.log('Listing with prefix:', prefix)

    // List blobs with tenant isolation
    const store = getStore(STORE_NAME)
    const { blobs } = await store.list({ 
      prefix,
      limit: 200 
    })

    // Transform to expected format
    const items = blobs.map(blob => ({
      key: blob.key,
      size: blob.size,
      uploadedAt: blob.uploaded_at
    }))

    console.log(`Found ${items.length} scans`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items)
    }

  } catch (error) {
    console.error('List error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}