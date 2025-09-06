import type { Handler } from '@netlify/functions'
import { db, findings, tenants, companies } from '../../db'
import { eq, and, sql, gte, lte, isNotNull, desc } from 'drizzle-orm'

// SLA configuration based on severity
const SLA_DAYS = {
  critical: 7,
  high: 30,
  medium: 60,
  low: 120
} as const

interface KPIMetrics {
  timeToDetect: number
  timeToTriage: number
  timeToPrioritize: number
  timeToRemediate: number
  timeToValidate: number
  timeToClose: number
  slaHitRate: number
  totalFindings: number
}

interface CompanyKPIs {
  companyId: string
  companyName: string
  companySlug: string
  kpis: KPIMetrics
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

  const params = new URLSearchParams(event.queryStringParameters || {})
  const startDate = params.get('startDate') 
  const endDate = params.get('endDate')
  const companyId = params.get('companyId')

  try {
    console.log('🟡 REPORTS: Starting reports generation for tenant:', tenantSlug)
    
    // Build the base query
    let whereConditions = [eq(findings.tenantId, tenant.id)]
    
    if (startDate) {
      whereConditions.push(gte(findings.detectedAt, new Date(startDate)))
    }
    if (endDate) {
      whereConditions.push(lte(findings.detectedAt, new Date(endDate)))
    }
    if (companyId) {
      whereConditions.push(eq(findings.companyId, companyId))
    }

    console.log('🟡 REPORTS: Fetching companies for tenant:', tenant.id)
    
    // Get all companies for this tenant
    const companiesList = await db
      .select({
        id: companies.id,
        name: companies.name,
        slug: companies.slug
      })
      .from(companies)
      .where(eq(companies.tenantId, tenant.id))

    console.log('🟡 REPORTS: Found companies:', companiesList.length)

    // Return simplified data for now
    const emptyKPIs: KPIMetrics = {
      timeToDetect: 0,
      timeToTriage: 0,
      timeToPrioritize: 0,
      timeToRemediate: 0,
      timeToValidate: 0,
      timeToClose: 0,
      slaHitRate: 0,
      totalFindings: 0
    }

    const companyKPIs: CompanyKPIs[] = companiesList.map(company => ({
      companyId: company.id,
      companyName: company.name,
      companySlug: company.slug,
      kpis: emptyKPIs
    }))

    // Get simplified trend data
    const trendData = await getTrendData(tenant.id, companyId)

    console.log('🟡 REPORTS: Returning simplified response')

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overall: emptyKPIs,
        companies: companyKPIs,
        trends: trendData,
        slaConfiguration: SLA_DAYS
      })
    }
  } catch (error) {
    console.error('Failed to fetch reports:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch reports data', details: error.message })
    }
  }
}

function calculateKPIs(findings: any[]): KPIMetrics {
  if (findings.length === 0) {
    return {
      timeToDetect: 0,
      timeToTriage: 0,
      timeToPrioritize: 0,
      timeToRemediate: 0,
      timeToValidate: 0,
      timeToClose: 0,
      slaHitRate: 0,
      totalFindings: 0
    }
  }

  const metrics = {
    timeToDetect: [] as number[],
    timeToTriage: [] as number[],
    timeToPrioritize: [] as number[],
    timeToRemediate: [] as number[],
    timeToValidate: [] as number[],
    timeToClose: [] as number[],
    slaHits: 0,
    totalWithSLA: 0
  }

  findings.forEach(finding => {
    const detectedAt = new Date(finding.detectedAt)

    // Time to Triage (detection to triage)
    if (finding.triagedAt) {
      const timeToTriage = (new Date(finding.triagedAt).getTime() - detectedAt.getTime()) / (1000 * 60 * 60 * 24)
      metrics.timeToTriage.push(timeToTriage)
    }

    // Time to Prioritize (detection to prioritization)
    if (finding.prioritizedAt) {
      const timeToPrioritize = (new Date(finding.prioritizedAt).getTime() - detectedAt.getTime()) / (1000 * 60 * 60 * 24)
      metrics.timeToPrioritize.push(timeToPrioritize)
    }

    // Time to Remediate (detection to remediation)
    if (finding.remediatedAt) {
      const timeToRemediate = (new Date(finding.remediatedAt).getTime() - detectedAt.getTime()) / (1000 * 60 * 60 * 24)
      metrics.timeToRemediate.push(timeToRemediate)
    }

    // Time to Validate (detection to validation)
    if (finding.validatedAt) {
      const timeToValidate = (new Date(finding.validatedAt).getTime() - detectedAt.getTime()) / (1000 * 60 * 60 * 24)
      metrics.timeToValidate.push(timeToValidate)
    }

    // Time to Close (detection to closure)
    if (finding.closedAt) {
      const timeToClose = (new Date(finding.closedAt).getTime() - detectedAt.getTime()) / (1000 * 60 * 60 * 24)
      metrics.timeToClose.push(timeToClose)
    }

    // SLA tracking
    if (finding.slaStatus) {
      metrics.totalWithSLA++
      if (finding.slaStatus === 'within') {
        metrics.slaHits++
      }
    }
  })

  return {
    timeToDetect: 0, // Always 0 as detection is the baseline
    timeToTriage: average(metrics.timeToTriage),
    timeToPrioritize: average(metrics.timeToPrioritize),
    timeToRemediate: average(metrics.timeToRemediate),
    timeToValidate: average(metrics.timeToValidate),
    timeToClose: average(metrics.timeToClose),
    slaHitRate: metrics.totalWithSLA > 0 ? (metrics.slaHits / metrics.totalWithSLA) * 100 : 0,
    totalFindings: findings.length
  }
}

function average(numbers: number[]): number {
  if (numbers.length === 0) return 0
  return numbers.reduce((sum, num) => sum + num, 0) / numbers.length
}

async function getTrendData(tenantId: string, companyId?: string | null) {
  // Simplified version - return empty array for now to avoid SQL issues
  return []
}