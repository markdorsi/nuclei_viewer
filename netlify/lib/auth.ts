import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import cookie from 'cookie'
import type { Handler } from '@netlify/functions'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

export const googleOAuthClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
)

export interface AuthenticatedUser {
  id: string
  googleId: string
  email: string
  name: string
  avatar?: string
  tenantId?: string
  role?: string
}

export interface JWTPayload {
  userId: string
  email: string
  tenantId?: string
  iat?: number
  exp?: number
}

export function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload
  } catch {
    return null
  }
}

export function getAuthTokenFromCookies(cookieHeader?: string): string | null {
  if (!cookieHeader) return null
  
  const cookies = cookie.parse(cookieHeader)
  return cookies.auth_token || null
}

export function setAuthCookie(token: string): string {
  return cookie.serialize('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: '/'
  })
}

export function clearAuthCookie(): string {
  return cookie.serialize('auth_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    expires: new Date(0),
    path: '/'
  })
}

export function withAuth(handler: (event: any, context: any, user: AuthenticatedUser) => Promise<any>): Handler {
  return async (event, context) => {
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

    // Create authenticated user object (would normally fetch from database)
    const user: AuthenticatedUser = {
      id: payload.userId,
      googleId: '', // Would be fetched from DB
      email: payload.email,
      name: '', // Would be fetched from DB
      tenantId: payload.tenantId
    }

    return handler(event, context, user)
  }
}