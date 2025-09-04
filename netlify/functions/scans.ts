import type { Handler } from '@netlify/functions'
import { db, scans, tenants, companies } from '../../db'
import { eq, and, desc } from 'drizzle-orm'

// Helper function to extract tenant from query params or path
function extractTenantSlug(event: any): string | null {
  // Try query parameter first (from redirect rule)
  let tenantSlug = event.queryStringParameters?.tenant
  
  // If no query parameter, try extracting from path
  if (!tenantSlug && event.path.includes('/t/')) {
    const pathParts = event.path.split('/')
    const tIndex = pathParts.findIndex((part: string) => part === 't')
    if (tIndex !== -1 && pathParts[tIndex + 1]) {
      tenantSlug = pathParts[tIndex + 1]
    }
  }
  
  return tenantSlug
}

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // Get tenant from query parameter (set by redirect rule) or path
  const tenantSlug = extractTenantSlug(event)
  
  if (!tenantSlug) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Tenant parameter missing' })
    }
  }
  
  // Get tenant
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

  try {
    const scanList = await db
      .select({
        id: scans.id,
        fileName: scans.fileName,
        filePath: scans.filePath,
        scanType: scans.scanType,
        scanDate: scans.scanDate,
        status: scans.status,
        metadata: scans.metadata,
        createdAt: scans.createdAt,
        processedAt: scans.processedAt,
        company: {
          id: companies.id,
          name: companies.name,
          slug: companies.slug
        }
      })
      .from(scans)
      .innerJoin(companies, eq(scans.companyId, companies.id))
      .where(eq(scans.tenantId, tenant.id))
      .orderBy(desc(scans.createdAt))
      .limit(50)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scanList)
    }
  } catch (error) {
    console.error('Failed to fetch scans:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch scans' })
    }
  }
}