import type { Handler } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'

const STORE_NAME = 'scans'

function getTenantFromPath(event: any) {
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
  console.log('=== SCAN DELETE ===')
  console.log('Method:', event.httpMethod)
  console.log('Headers:', event.headers)
  console.log('Body:', event.body)
  
  // Initialize Netlify Blobs for Lambda compatibility mode
  connectLambda(event)

  if (event.httpMethod !== 'DELETE') {
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

  console.log('Tenant from path:', tenantSlug)

  // Check authorization header
  const authHeader = event.headers.authorization || event.headers.Authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('Missing or invalid authorization header')
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Authorization required' })
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { scanKeys } = body

    if (!scanKeys || !Array.isArray(scanKeys) || scanKeys.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'scanKeys array is required' })
      }
    }

    console.log('Deleting scans:', scanKeys)

    const scansStore = getStore(STORE_NAME)
    const metaStore = getStore('scans-meta')
    
    const results = []
    
    for (const scanKey of scanKeys) {
      try {
        // Ensure the scan belongs to the tenant (security check)
        if (!scanKey.startsWith(`${tenantSlug}/`)) {
          console.log(`Security check failed: scan ${scanKey} does not belong to tenant ${tenantSlug}`)
          results.push({ key: scanKey, success: false, error: 'Access denied' })
          continue
        }

        // Check if scan blob exists first
        console.log(`Checking if scan blob exists: ${scanKey}`)
        const scanExists = await scansStore.get(scanKey)
        console.log(`Scan blob exists: ${!!scanExists}`)

        // Delete the scan blob
        console.log(`Attempting to delete scan blob: ${scanKey}`)
        const deleteResult = await scansStore.delete(scanKey)
        console.log(`Delete result:`, deleteResult)
        console.log(`✅ Deleted scan blob: ${scanKey}`)

        // Verify deletion
        const scanExistsAfter = await scansStore.get(scanKey)
        console.log(`Scan blob exists after deletion: ${!!scanExistsAfter}`)

        // Delete the metadata
        const metadataKey = `records/${tenantSlug}/${scanKey}.json`
        console.log(`Checking if metadata exists: ${metadataKey}`)
        const metaExists = await metaStore.get(metadataKey)
        console.log(`Metadata exists: ${!!metaExists}`)
        
        console.log(`Attempting to delete scan metadata: ${metadataKey}`)
        const metaDeleteResult = await metaStore.delete(metadataKey)
        console.log(`Metadata delete result:`, metaDeleteResult)
        console.log(`✅ Deleted scan metadata: ${metadataKey}`)

        // Verify metadata deletion
        const metaExistsAfter = await metaStore.get(metadataKey)
        console.log(`Metadata exists after deletion: ${!!metaExistsAfter}`)

        results.push({ key: scanKey, success: true })
      } catch (error) {
        console.error(`Failed to delete scan ${scanKey}:`, error)
        results.push({ 
          key: scanKey, 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failureCount = results.length - successCount

    console.log(`Deletion complete: ${successCount} succeeded, ${failureCount} failed`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Deleted ${successCount} scan(s)`,
        results,
        summary: {
          total: results.length,
          succeeded: successCount,
          failed: failureCount
        }
      })
    }

  } catch (error) {
    console.error('Delete error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}