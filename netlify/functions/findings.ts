import type { Handler } from '@netlify/functions'
import { db, findings, tenants, companies, externalIssues } from '../../db'
import { eq, and, sql } from 'drizzle-orm'

// SLA configuration based on severity
const SLA_DAYS = {
  critical: 7,
  high: 30,
  medium: 60,
  low: 120
} as const

function calculateSLADueDate(severity: string, detectedAt: Date): Date {
  const slaTargetDays = SLA_DAYS[severity as keyof typeof SLA_DAYS] || SLA_DAYS.low
  const dueDate = new Date(detectedAt)
  dueDate.setDate(dueDate.getDate() + slaTargetDays)
  return dueDate
}

function calculateSLAStatus(severity: string, detectedAt: Date, currentStatus: string): string {
  if (currentStatus === 'closed') return 'within'
  
  const dueDate = calculateSLADueDate(severity, detectedAt)
  const now = new Date()
  const daysRemaining = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  
  if (daysRemaining < 0) return 'breached'
  if (daysRemaining <= 2) return 'at_risk'
  return 'within'
}

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