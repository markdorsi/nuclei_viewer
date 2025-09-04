import type { Handler } from '@netlify/functions'
import { googleOAuthClient, signJWT, setAuthCookie } from '../lib/auth'
import { db, users, memberships, tenants } from '../../db'
import { eq } from 'drizzle-orm'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const { code, state } = event.queryStringParameters || {}

  if (!code) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Authorization code not provided' })
    }
  }

  try {
    // Exchange code for tokens
    const { tokens } = await googleOAuthClient.getToken(code)
    googleOAuthClient.setCredentials(tokens)

    // Get user info from Google
    const userInfoResponse = await fetch(
      `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokens.access_token}`
    )
    
    if (!userInfoResponse.ok) {
      throw new Error('Failed to fetch user info from Google')
    }

    const googleUser = await userInfoResponse.json()

    // Get or create user in database
    let [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.googleId, googleUser.id))
      .limit(1)

    if (!dbUser) {
      // Create new user
      [dbUser] = await db
        .insert(users)
        .values({
          googleId: googleUser.id,
          email: googleUser.email,
          name: googleUser.name,
          avatar: googleUser.picture
        })
        .returning()
    } else {
      // Update existing user info
      [dbUser] = await db
        .update(users)
        .set({
          name: googleUser.name,
          avatar: googleUser.picture,
          updatedAt: new Date()
        })
        .where(eq(users.id, dbUser.id))
        .returning()
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
      .limit(1) // Get first tenant for now

    // For first-time users without tenant membership, we need to handle tenant assignment
    // This could be based on email domain, invitation, or manual admin assignment
    let currentTenant = userMemberships[0]?.tenant || null

    // Create JWT token
    const token = signJWT({
      userId: dbUser.id,
      email: dbUser.email,
      tenantId: currentTenant?.id
    })

    // Redirect to app with auth cookie
    const redirectUrl = process.env.NODE_ENV === 'production' 
      ? 'https://scanvault.netlify.app/dashboard'
      : 'http://localhost:5173/dashboard'

    return {
      statusCode: 302,
      headers: {
        'Set-Cookie': setAuthCookie(token),
        'Location': redirectUrl
      }
    }

  } catch (error) {
    console.error('OAuth callback error:', error)
    
    const errorUrl = process.env.NODE_ENV === 'production'
      ? 'https://scanvault.netlify.app/login?error=oauth_failed'
      : 'http://localhost:5173/login?error=oauth_failed'

    return {
      statusCode: 302,
      headers: {
        'Location': errorUrl
      }
    }
  }
}