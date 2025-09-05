import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event, context) => {
  console.log('🔥 SIMPLE TEST: Function called!')
  console.log('🔥 SIMPLE TEST: Method:', event.httpMethod)
  console.log('🔥 SIMPLE TEST: Path:', event.path)
  console.log('🔥 SIMPLE TEST: Headers:', JSON.stringify(event.headers, null, 2))
  
  try {
    console.log('🔥 SIMPLE TEST: Body length:', event.body?.length || 0)
    console.log('🔥 SIMPLE TEST: Is base64:', event.isBase64Encoded)
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        message: 'Test function working',
        receivedMethod: event.httpMethod,
        bodyLength: event.body?.length || 0,
        isBase64: event.isBase64Encoded
      })
    }
  } catch (error: any) {
    console.error('🔥 SIMPLE TEST: Error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    }
  }
}