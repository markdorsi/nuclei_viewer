import type { Handler } from '@netlify/functions'
import { db, users, memberships, tenants } from '../../db'
import { eq } from 'drizzle-orm'
import { getAuthTokenFromCookies, verifyJWT } from '../lib/auth'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
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

  try {
    // Get user from database
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1)

    if (!dbUser) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'User not found' })
      }
    }

    // Get user's tenant memberships
    const userMemberships = await db
      .select({
        tenant: tenants,
        membership: memberships
      })
      .from(memberships)
      .innerJoin(tenants, eq(memberships.tenantId, tenants.id))
      .where(eq(memberships.userId, dbUser.id))

    // Get current tenant (from JWT or first available)
    let currentTenant = null
    let currentMembership = null
    
    if (payload.tenantId) {
      const membership = userMemberships.find(m => m.tenant.id === payload.tenantId)
      currentTenant = membership?.tenant || null
      currentMembership = membership?.membership || null
    }
    
    // Fallback to first tenant if none specified or not found
    if (!currentTenant && userMemberships.length > 0) {
      currentTenant = userMemberships[0].tenant
      currentMembership = userMemberships[0].membership
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          avatar: dbUser.avatar,
          role: currentMembership?.role
        },
        tenant: currentTenant,
        tenants: userMemberships.map(m => m.tenant)
      })
    }
  } catch (error) {
    console.error('Auth check error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    }
  }
}