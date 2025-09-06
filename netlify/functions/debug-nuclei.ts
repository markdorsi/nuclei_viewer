import type { Handler } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'

const SCANS_STORE_NAME = 'scans'

export const handler: Handler = async (event, context) => {
  // Initialize Netlify Blobs for Lambda compatibility mode
  connectLambda(event)

  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { scanKey } = body

    if (!scanKey) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'scanKey is required' })
      }
    }

    console.log(`🐛 DEBUG: Getting scan content for key: ${scanKey}`)

    // Get the scan data from storage
    const scanStore = getStore(SCANS_STORE_NAME)
    const scanBlob = await scanStore.get(scanKey)
    
    if (!scanBlob) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Scan file not found in storage' })
      }
    }

    // Handle different blob response types
    let scanContent: string
    if (typeof scanBlob === 'string') {
      scanContent = scanBlob
    } else if (scanBlob && typeof scanBlob.text === 'function') {
      scanContent = await scanBlob.text()
    } else if (scanBlob && typeof scanBlob.toString === 'function') {
      scanContent = scanBlob.toString()
    } else {
      scanContent = String(scanBlob)
    }

    console.log(`🐛 DEBUG: Scan content length: ${scanContent.length}`)

    const trimmedContent = scanContent.trim()
    
    // Basic content analysis
    const analysis = {
      length: scanContent.length,
      trimmedLength: trimmedContent.length,
      startsWithArray: trimmedContent.startsWith('['),
      endsWithArray: trimmedContent.endsWith(']'),
      first200Chars: trimmedContent.substring(0, 200),
      last200Chars: trimmedContent.substring(Math.max(0, trimmedContent.length - 200)),
      lineCount: scanContent.split('\n').length,
      isValidJSON: false,
      jsonParseError: null,
      arrayLength: 0
    }

    // Try to parse as JSON
    try {
      const parsed = JSON.parse(trimmedContent)
      analysis.isValidJSON = true
      if (Array.isArray(parsed)) {
        analysis.arrayLength = parsed.length
      }
    } catch (e) {
      analysis.jsonParseError = e.message
    }

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      },
      body: JSON.stringify({
        scanKey,
        analysis
      })
    }

  } catch (error) {
    console.error('🐛 DEBUG: Error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to debug scan',
        details: error.message 
      })
    }
  }
}