import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore, connectLambda } from '@netlify/blobs'
import { db, companies, tenants, scans } from '../../db'
import { eq, and, inArray } from 'drizzle-orm'

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
  
  // Initialize Netlify Blobs for Lambda compatibility mode
  connectLambda(event)

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

  console.log('Tenant from path:', tenantSlug)

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
    console.log('About to list blobs from store:', STORE_NAME)
    
    const { blobs } = await store.list({ 
      prefix,
      limit: 200 
    })
    
    console.log('Found blobs:', blobs.length)
    console.log('Blob keys:', blobs.map(b => b.key))

    // Get metadata store to retrieve size and upload time
    const metaStore = getStore('scans-meta')
    
    // Transform to expected format with metadata lookup
    const items = []
    const companyIds = new Set<string>()
    
    for (const blob of blobs) {
      try {
        // Try to get metadata for this scan
        const metadataKey = `records/${tenantSlug}/${blob.key}.json`
        console.log(`Looking for metadata: ${metadataKey}`)
        const metadataText = await metaStore.get(metadataKey)
        console.log(`Metadata found: ${!!metadataText}`)
        const metadata = metadataText ? JSON.parse(metadataText) : null
        if (metadata) {
          console.log(`Metadata parsed:`, { size: metadata.size, completedAt: metadata.completedAt })
        }
        
        const item = {
          key: blob.key,
          size: metadata?.size || 0,
          uploadedAt: metadata?.completedAt || new Date().toISOString(),
          companyId: metadata?.companyId || null,
          companyName: metadata?.companyName || null
        }
        
        items.push(item)
        
        // Track company IDs for batch lookup
        if (item.companyId) {
          companyIds.add(item.companyId)
        }
      } catch (err) {
        console.error(`Error getting metadata for ${blob.key}:`, err)
        // Fallback without metadata
        items.push({
          key: blob.key,
          size: 0,
          uploadedAt: new Date().toISOString(),
          companyId: null,
          companyName: null
        })
      }
    }

    // Batch lookup company names and scan status from database
    let tenant = null
    try {
      // Get tenant from database
      const [tenantResult] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, tenantSlug))
        .limit(1)
      
      tenant = tenantResult

      if (tenant) {
        // Lookup company names if needed
        if (companyIds.size > 0) {
          const companyResults = await db
            .select()
            .from(companies)
            .where(and(
              eq(companies.tenantId, tenant.id),
              inArray(companies.id, Array.from(companyIds))
            ))

          // Create lookup map
          const companyMap = new Map()
          companyResults.forEach(company => {
            companyMap.set(company.id, company.name)
          })

          // Update items with company names
          items.forEach(item => {
            if (item.companyId && companyMap.has(item.companyId)) {
              item.companyName = companyMap.get(item.companyId)
            }
          })
        }

        // Lookup scan processing status for files with company associations
        const scanResults = await db
          .select({
            filePath: scans.filePath,
            status: scans.status,
            scanId: scans.id,
            processedAt: scans.processedAt
          })
          .from(scans)
          .where(eq(scans.tenantId, tenant.id))

        // Create scan status lookup map
        const scanStatusMap = new Map()
        scanResults.forEach(scan => {
          scanStatusMap.set(scan.filePath, {
            status: scan.status,
            scanId: scan.scanId,
            processedAt: scan.processedAt
          })
        })

        // Update items with processing status
        items.forEach(item => {
          if (scanStatusMap.has(item.key)) {
            const scanInfo = scanStatusMap.get(item.key)
            item.processingStatus = scanInfo.status
            item.scanId = scanInfo.scanId
            item.processedAt = scanInfo.processedAt
            console.log(`📊 SCAN LIST: ${item.key} -> status: ${scanInfo.status}, processedAt: ${scanInfo.processedAt}`)
          } else if (item.companyId) {
            // If scan has company but no DB record, it means processing hasn't started
            item.processingStatus = 'pending'
            console.log(`📊 SCAN LIST: ${item.key} -> status: pending (no DB record but has company)`)
          } else {
            // No company association - no processing expected
            item.processingStatus = null
            console.log(`📊 SCAN LIST: ${item.key} -> status: null (no company association)`)
          }
        })
      }
    } catch (dbErr) {
      console.error('Error fetching database info:', dbErr)
      // Continue without database info - they'll remain null
    }

    console.log(`Found ${items.length} scans`)

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
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