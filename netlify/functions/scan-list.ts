import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore } from '@netlify/blobs'

const STORE_NAME = 'scans'

// Extract tenant from URL path
function getTenantFromPath(event: any) {
  // Try to get tenant from path like /api/t/tenantSlug/scans/list
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
  console.log('=== SCAN LIST ===')
  console.log('Method:', event.httpMethod)

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  // Get tenant from path
  const tenantSlug = getTenantFromPath(event)
  if (!tenantSlug) {
    console.log('Tenant slug missing from path')
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Tenant parameter missing', debug: { path: event.path } })
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
    let prefix = `${tenantSlug}/`
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