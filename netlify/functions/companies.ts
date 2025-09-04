import type { Handler } from '@netlify/functions'
import { db, companies, tenants, findings, scans } from '../../db'
import { eq, and, sql } from 'drizzle-orm'

export const handler: Handler = async (event, context) => {
  const pathParts = event.path.split('/')
  const tenantSlug = pathParts[3] // /api/t/{tenant}/companies
  
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
  
  if (event.httpMethod === 'GET') {
    try {
      const companyList = await db
        .select({
          id: companies.id,
          name: companies.name,
          slug: companies.slug,
          metadata: companies.metadata,
          createdAt: companies.createdAt,
          findingsCount: sql<number>`(SELECT COUNT(*) FROM nuclei_db.findings WHERE company_id = ${companies.id})::int`,
          scansCount: sql<number>`(SELECT COUNT(*) FROM nuclei_db.scans WHERE company_id = ${companies.id})::int`
        })
        .from(companies)
        .where(eq(companies.tenantId, tenant.id))
        .orderBy(companies.name)
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(companyList)
      }
    } catch (error) {
      console.error('Failed to fetch companies:', error)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch companies' })
      }
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}')
      
      if (!body.name || !body.slug) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Name and slug are required' })
        }
      }
      
      const [newCompany] = await db
        .insert(companies)
        .values({
          tenantId: tenant.id,
          name: body.name,
          slug: body.slug,
          metadata: body.metadata || {}
        })
        .returning()
      
      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCompany)
      }
    } catch (error: any) {
      if (error.code === '23505') { // Unique constraint violation
        return {
          statusCode: 409,
          body: JSON.stringify({ error: 'Company with this slug already exists' })
        }
      }
      console.error('Failed to create company:', error)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create company' })
      }
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' }
}