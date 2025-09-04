import type { Handler } from '@netlify/functions'
import { db, tenantIntegrations, tenants } from '../../db'
import { eq, and } from 'drizzle-orm'

export const handler: Handler = async (event, context) => {
  const pathParts = event.path.split('/')
  const tenantSlug = pathParts[3] // /api/t/{tenant}/integrations
  
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