import type { Handler } from '@netlify/functions'
import { db, findings, companies, scans, assets, tenants } from '../../db'
import { eq, and, sql } from 'drizzle-orm'

export const handler: Handler = async (event, context) => {
  console.log('Stats function called with path:', event.path)
  console.log('Query parameters:', event.queryStringParameters)
  console.log('Full event object:', JSON.stringify(event, null, 2))
  
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // Try to get tenant from query parameter first, then fall back to path parsing
  let tenantSlug = event.queryStringParameters?.tenant
  
  // If no query parameter, try extracting from path
  if (!tenantSlug) {
    // Check if this is a direct call to the function with tenant in path
    if (event.path.includes('/t/')) {
      const pathParts = event.path.split('/')
      const tIndex = pathParts.findIndex(part => part === 't')
      if (tIndex !== -1 && pathParts[tIndex + 1]) {
        tenantSlug = pathParts[tIndex + 1]
        console.log('Extracted tenant from path:', tenantSlug)
      }
    }
  }
  
  console.log('Final tenant slug:', tenantSlug)
  
  if (!tenantSlug) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Tenant parameter missing', debug: { path: event.path, query: event.queryStringParameters } })
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
    // Get statistics for the tenant
    const [stats] = await db
      .select({
        totalFindings: sql<number>`COUNT(DISTINCT ${findings.id})::int`,
        critical: sql<number>`COUNT(DISTINCT CASE WHEN ${findings.severity} = 'critical' AND NOT ${findings.resolved} THEN ${findings.id} END)::int`,
        high: sql<number>`COUNT(DISTINCT CASE WHEN ${findings.severity} = 'high' AND NOT ${findings.resolved} THEN ${findings.id} END)::int`,
        medium: sql<number>`COUNT(DISTINCT CASE WHEN ${findings.severity} = 'medium' AND NOT ${findings.resolved} THEN ${findings.id} END)::int`,
        low: sql<number>`COUNT(DISTINCT CASE WHEN ${findings.severity} = 'low' AND NOT ${findings.resolved} THEN ${findings.id} END)::int`,
        info: sql<number>`COUNT(DISTINCT CASE WHEN ${findings.severity} = 'info' AND NOT ${findings.resolved} THEN ${findings.id} END)::int`,
      })
      .from(findings)
      .where(eq(findings.tenantId, tenant.id))

    const [counts] = await db
      .select({
        companies: sql<number>`COUNT(DISTINCT ${companies.id})::int`,
        scans: sql<number>`COUNT(DISTINCT ${scans.id})::int`,
        assets: sql<number>`COUNT(DISTINCT ${assets.id})::int`
      })
      .from(companies)
      .leftJoin(scans, and(eq(scans.tenantId, tenant.id), eq(scans.companyId, companies.id)))
      .leftJoin(assets, and(eq(assets.tenantId, tenant.id), eq(assets.companyId, companies.id)))
      .where(eq(companies.tenantId, tenant.id))

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...stats,
        ...counts
      })
    }
  } catch (error) {
    console.error('Failed to fetch stats:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch statistics' })
    }
  }
}