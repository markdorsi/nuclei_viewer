import type { Handler } from '@netlify/functions'
import { clearAuthCookie } from '../lib/auth'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  return {
    statusCode: 200,
    headers: {
      'Set-Cookie': clearAuthCookie(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: 'Logged out successfully' })
  }
}