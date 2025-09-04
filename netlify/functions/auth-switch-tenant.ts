import type { Handler } from '@netlify/functions'
import { db, users, memberships, tenants } from '../../db'
import { eq, and } from 'drizzle-orm'
import { getAuthTokenFromCookies, verifyJWT, signJWT, setAuthCookie } from '../lib/auth'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // Get JWT token from cookies
  const token = getAuthTokenFromCookies(event.headers.cookie)
  
  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Not authenticated' })
    }
  }

  const payload = verifyJWT(token)
  if (!payload) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid token' })
    }
  }

  const { tenantId } = JSON.parse(event.body || '{}')
  
  if (!tenantId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Tenant ID is required' })
    }
  }

  try {
    // Verify user has access to this tenant
    const [membership] = await db
      .select({
        tenant: tenants,
        membership: memberships
      })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(and(
        eq(memberships.userId, payload.userId),
        eq(memberships.tenantId, tenantId)
      ))
      .limit(1)

    if (!membership) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Access denied to this tenant' })
      }
    }

    // Create new JWT with updated tenant
    const newToken = signJWT({
      userId: payload.userId,
      email: payload.email,
      tenantId: tenantId
    })

    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': setAuthCookie(newToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tenant: membership.tenant,
        message: 'Tenant switched successfully'
      })
    }

  } catch (error) {
    console.error('Tenant switch error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to switch tenant' })
    }
  }
}