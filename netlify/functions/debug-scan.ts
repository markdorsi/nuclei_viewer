import type { Handler } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'
import { db, scans, tenants } from '../../db'
import { eq, and } from 'drizzle-orm'

const SCANS_STORE_NAME = 'scans'

// Extract tenant from URL path
function getTenantFromPath(event: any) {
  if (event.path.includes('/t/')) {
    const pathParts = event.path.split('/')
    const tIndex = pathParts.findIndex(part => part === 't')
    if (tIndex !== -1 && pathParts[tIndex + 1]) {
      return pathParts[tIndex + 1]
    }
  }
  return null
}

// Parse nuclei JSON/JSONL results (simplified version for debugging)
function parseNucleiResults(content: string): { summary: any, samples: any[] } {
  const lines = content.split('\n').filter(line => line.trim())
  const samples = []
  let validResults = 0
  
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i]
    try {
      const result = JSON.parse(line)
      samples.push({
        lineNumber: i + 1,
        parsed: true,
        structure: Object.keys(result),
        hasInfo: !!(result.info && typeof result.info === 'object'),
        hasTemplate: !!(result.template && typeof result.template === 'string'),
        hasTemplateId: !!(result.template_id || result.templateId || result['template-id']),
        hasHost: !!(result.host || result.target),
        severity: result.info?.severity || result.severity,
        templateName: result.info?.name || result.template_name || result.templateName,
        target: result.host || result.target || result.url,
        sample: JSON.stringify(result, null, 2).substring(0, 500)
      })
      
      if (result && typeof result === 'object') {
        const hasInfo = result.info && typeof result.info === 'object'
        const hasTemplate = result.template && typeof result.template === 'string'
        const hasTemplateId = result.template_id || result.templateId || result['template-id']
        const hasHost = result.host || result.target
        
        if (hasInfo || hasTemplate || hasTemplateId || hasHost) {
          validResults++
        }
      }
    } catch (e) {
      samples.push({
        lineNumber: i + 1,
        parsed: false,
        error: e.message,
        content: line.substring(0, 200)
      })
    }
  }
  
  return {
    summary: {
      totalLines: lines.length,
      validResults,
      sampledLines: samples.length
    },
    samples
  }
}

export const handler: Handler = async (event, context) => {
  // Initialize Netlify Blobs for Lambda compatibility mode
  connectLambda(event)

  if (event.httpMethod !== 'GET') {
    return { 
      statusCode: 405, 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }) 
    }
  }

  // Get tenant from path
  const tenantSlug = getTenantFromPath(event)
  if (!tenantSlug) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Tenant parameter missing' })
    }
  }

  try {
    const scanKey = event.queryStringParameters?.scanKey
    if (!scanKey) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'scanKey query parameter required' })
      }
    }

    // Get tenant from database
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)

    if (!tenant) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Tenant not found' })
      }
    }

    // Find scan record
    const fileName = scanKey.split('/').pop()
    const [scanRecord] = await db
      .select()
      .from(scans)
      .where(and(
        eq(scans.tenantId, tenant.id),
        eq(scans.fileName, fileName)
      ))
      .limit(1)

    // Get scan content from storage
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

    // Parse and analyze the content
    const analysis = parseNucleiResults(scanContent)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scanKey,
        tenant: tenantSlug,
        scanRecord: scanRecord ? {
          id: scanRecord.id,
          fileName: scanRecord.fileName,
          companyId: scanRecord.companyId,
          status: scanRecord.status
        } : null,
        fileInfo: {
          contentLength: scanContent.length,
          firstLine: scanContent.split('\n')[0]?.substring(0, 200),
          lastLine: scanContent.split('\n').slice(-1)[0]?.substring(0, 200)
        },
        analysis
      }, null, 2)
    }

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Debug scan failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}