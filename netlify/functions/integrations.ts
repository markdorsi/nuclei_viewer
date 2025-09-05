import type { Handler } from '@netlify/functions'
import { db, tenantIntegrations, tenants } from '../../db'
import { eq, and } from 'drizzle-orm'

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

  if (event.httpMethod === 'GET') {
    try {
      const integrations = await db
        .select()
        .from(tenantIntegrations)
        .where(eq(tenantIntegrations.tenantId, tenant.id))

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(integrations)
      }
    } catch (error) {
      console.error('Failed to fetch integrations:', error)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch integrations' })
      }
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}')
      
      if (!body.provider || !body.config) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Provider and config are required' })
        }
      }

      // Upsert integration
      const [integration] = await db
        .insert(tenantIntegrations)
        .values({
          tenantId: tenant.id,
          provider: body.provider,
          config: body.config,
          enabled: body.enabled ?? true
        })
        .onConflictDoUpdate({
          target: [tenantIntegrations.tenantId, tenantIntegrations.provider],
          set: {
            config: body.config,
            enabled: body.enabled ?? true,
            updatedAt: new Date()
          }
        })
        .returning()

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(integration)
      }
    } catch (error) {
      console.error('Failed to save integration:', error)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to save integration' })
      }
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' }
}