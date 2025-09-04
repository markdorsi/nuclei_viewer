import type { Handler } from '@netlify/functions'
import { db, findings, companies, scans, assets, tenants } from '../../db'
import { eq, and, sql } from 'drizzle-orm'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const pathParts = event.path.split('/')
  const tenantSlug = pathParts[3] // /api/t/{tenant}/stats
  
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