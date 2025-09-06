import type { Handler } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'
import { db, scans, companies, tenants } from '../../db'
import { eq, and } from 'drizzle-orm'

const META_STORE_NAME = 'scans-meta'

// Extract tenant from URL path
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
  console.log('=== SCAN ASSOCIATE ===')
  console.log('Method:', event.httpMethod)
  
  // Initialize Netlify Blobs for Lambda compatibility mode
  connectLambda(event)

  if (event.httpMethod !== 'PUT') {
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
    const { scanKey, companyId } = body

    if (!scanKey) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'scanKey is required' })
      }
    }

    console.log('Associating scan:', scanKey, 'with company:', companyId)

    // Get tenant from database
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)

    if (!tenant) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Tenant not found' })
      }
    }

    // Verify company belongs to tenant (if companyId is provided)
    let company = null
    if (companyId && companyId !== '') {
      const [foundCompany] = await db
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenant.id)))
        .limit(1)

      if (!foundCompany) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Company not found' })
        }
      }
      company = foundCompany
    }

    // Get the scan metadata from blob storage
    const metaStore = getStore(META_STORE_NAME)
    const metadataKey = `records/${tenantSlug}/${scanKey}.json`
    
    console.log(`Looking for metadata: ${metadataKey}`)
    const metadataText = await metaStore.get(metadataKey)
    
    if (!metadataText) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Scan not found' })
      }
    }

    // Parse and update metadata
    const metadata = JSON.parse(metadataText)
    metadata.companyId = companyId && companyId !== '' ? companyId : null
    metadata.companyName = company ? company.name : null
    metadata.updatedAt = new Date().toISOString()

    // Save updated metadata back to blob storage
    await metaStore.set(metadataKey, JSON.stringify(metadata))

    console.log(`✅ Updated scan metadata: ${scanKey} -> ${company ? company.name : 'No Company'}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: company ? 'Scan successfully associated with company' : 'Scan association removed',
        scanKey,
        company: company ? {
          id: company.id,
          name: company.name,
          slug: company.slug
        } : null
      })
    }

  } catch (error) {
    console.error('Associate error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}