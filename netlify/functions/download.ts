import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event, context) => {
  console.log('📥 DOWNLOAD: Download request received')
  console.log('📥 DOWNLOAD: HTTP Method:', event.httpMethod)

  // File downloads are disabled since upload functionality was removed
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'File downloads are currently disabled',
        message: 'File upload functionality has been removed, so downloads are no longer available.'
      })
    }
  }

  return { 
    statusCode: 405, 
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method not allowed' })
  }
}