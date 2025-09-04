import type { Handler } from '@netlify/functions'
import { db, findings, tenants, companies, externalIssues } from '../../db'
import { eq, and, sql } from 'drizzle-orm'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const pathParts = event.path.split('/')
  const tenantSlug = pathParts[3] // /api/t/{tenant}/findings
  
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
    const params = new URLSearchParams(event.queryStringParameters || {})
    
    let query = db
      .select({
        id: findings.id,
        name: findings.name,
        description: findings.description,
        severity: findings.severity,
        templateId: findings.templateId,
        templateName: findings.templateName,
        dedupeKey: findings.dedupeKey,
        tags: findings.tags,
        firstSeen: findings.firstSeen,
        lastSeen: findings.lastSeen,
        resolved: findings.resolved,
        company: {
          id: companies.id,
          name: companies.name,
          slug: companies.slug
        },
        externalIssues: sql<any>`(
          SELECT json_agg(json_build_object(
            'provider', provider,
            'externalId', external_id,
            'externalUrl', external_url,
            'status', status
          ))
          FROM nuclei_db.external_issues
          WHERE finding_id = ${findings.id}
        )`
      })
      .from(findings)
      .innerJoin(companies, eq(findings.companyId, companies.id))
      .where(and(
        eq(findings.tenantId, tenant.id),
        eq(findings.resolved, false)
      ))
      .orderBy(findings.lastSeen)
      .limit(100)

    // Apply filters
    const conditions = [eq(findings.tenantId, tenant.id), eq(findings.resolved, false)]
    
    if (params.get('severity')) {
      conditions.push(eq(findings.severity, params.get('severity') as any))
    }
    
    if (params.get('company')) {
      conditions.push(eq(findings.companyId, params.get('company')!))
    }
    
    const result = await db
      .select({
        id: findings.id,
        name: findings.name,
        description: findings.description,
        severity: findings.severity,
        templateId: findings.templateId,
        templateName: findings.templateName,
        dedupeKey: findings.dedupeKey,
        tags: findings.tags,
        firstSeen: findings.firstSeen,
        lastSeen: findings.lastSeen,
        resolved: findings.resolved,
        company: {
          id: companies.id,
          name: companies.name,
          slug: companies.slug
        }
      })
      .from(findings)
      .innerJoin(companies, eq(findings.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(findings.lastSeen)
      .limit(100)

    // Get external issues for each finding
    const findingIds = result.map(f => f.id)
    const externalIssuesList = findingIds.length > 0 ? await db
      .select()
      .from(externalIssues)
      .where(sql`${externalIssues.findingId} IN ${sql.raw(`(${findingIds.map(id => `'${id}'`).join(',')})`)}`) : []

    // Map external issues to findings
    const externalIssuesMap = externalIssuesList.reduce((acc: any, issue) => {
      if (!acc[issue.findingId]) acc[issue.findingId] = []
      acc[issue.findingId].push(issue)
      return acc
    }, {})

    const findingsWithIssues = result.map(f => ({
      ...f,
      externalIssues: externalIssuesMap[f.id] || []
    }))

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(findingsWithIssues)
    }
  } catch (error) {
    console.error('Failed to fetch findings:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch findings' })
    }
  }
}