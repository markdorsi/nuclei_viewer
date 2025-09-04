import type { Handler } from '@netlify/functions'
import { googleOAuthClient } from '../lib/auth'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    // Generate Google OAuth URL
    const authUrl = googleOAuthClient.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
      include_granted_scopes: true,
      state: 'security_token_here' // Add CSRF protection
    })

    return {
      statusCode: 302,
      headers: {
        Location: authUrl
      }
    }
  } catch (error) {
    console.error('OAuth URL generation failed:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to generate OAuth URL' })
    }
  }
}