import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event, context) => {
  console.log('🔍 PROCESS: Scan processing request received')
  console.log('🔍 PROCESS: HTTP Method:', event.httpMethod)

  // Scan processing is disabled since upload functionality was removed
  if (event.httpMethod === 'POST') {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Scan processing is currently disabled',
        message: 'File upload functionality has been removed, so scan processing is no longer available.'
      })
    }
  }

  return { 
    statusCode: 405, 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method not allowed' })
  }
}