import type { Handler } from '@netlify/functions'
import { db, userIntegrations, tenants, users } from '../../db'
import { eq, and } from 'drizzle-orm'
import { createHash, randomBytes } from 'crypto'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'dev-key'

function encryptToken(token: string): string {
  // Simple Base64 encoding for now - use proper AES-256-GCM in production
  const buffer = Buffer.from(token, 'utf8')
  return buffer.toString('base64')
}

function decryptToken(encryptedToken: string): string {
  // Simple Base64 decoding for now - use proper AES-256-GCM in production  
  const buffer = Buffer.from(encryptedToken, 'base64')
  return buffer.toString('utf8')
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
  // Get tenant from query parameter (set by redirect rule) or path
  const tenantSlug = extractTenantSlug(event)
  
  if (!tenantSlug) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Tenant parameter missing' })
    }
  }
  
  // Get user from context (would come from Netlify Identity)
  const { user: identityUser } = context.clientContext || {}
  
  if (!identityUser) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Not authenticated' })
    }
  }

  // Get tenant and user
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

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.googleId, identityUser.sub))
    .limit(1)

  if (!user) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'User not found' })
    }
  }

  if (event.httpMethod === 'GET') {
    try {
      const integrations = await db
        .select({
          id: userIntegrations.id,
          provider: userIntegrations.provider,
          tokenMetadata: userIntegrations.tokenMetadata,
          createdAt: userIntegrations.createdAt,
          updatedAt: userIntegrations.updatedAt
        })
        .from(userIntegrations)
        .where(and(
          eq(userIntegrations.tenantId, tenant.id),
          eq(userIntegrations.userId, user.id)
        ))

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(integrations)
      }
    } catch (error) {
      console.error('Failed to fetch user integrations:', error)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch user integrations' })
      }
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}')
      
      if (!body.provider || !body.token) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Provider and token are required' })
        }
      }

      const encryptedToken = encryptToken(body.token)

      // Upsert user integration
      const [integration] = await db
        .insert(userIntegrations)
        .values({
          tenantId: tenant.id,
          userId: user.id,
          provider: body.provider,
          encryptedToken,
          tokenMetadata: body.metadata || {}
        })
        .onConflictDoUpdate({
          target: [userIntegrations.tenantId, userIntegrations.userId, userIntegrations.provider],
          set: {
            encryptedToken,
            tokenMetadata: body.metadata || {},
            updatedAt: new Date()
          }
        })
        .returning({
          id: userIntegrations.id,
          provider: userIntegrations.provider,
          tokenMetadata: userIntegrations.tokenMetadata,
          createdAt: userIntegrations.createdAt,
          updatedAt: userIntegrations.updatedAt
        })

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(integration)
      }
    } catch (error) {
      console.error('Failed to save user integration:', error)
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to save user integration' })
      }
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' }
}