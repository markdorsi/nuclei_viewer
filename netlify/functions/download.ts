import type { Handler } from '@netlify/functions'
import { db, scans, tenants } from '../../db'
import { eq, and } from 'drizzle-orm'
import { getStore } from '@netlify/blobs'

// Helper function to extract tenant from query params or path
function extractTenantSlug(event: any): string | null {
  // Try query parameter first (from redirect rule)
  let tenantSlug = event.queryStringParameters?.tenant
  
  // If no query parameter, try extracting from path
  if (!tenantSlug && event.path.includes('/t/')) {
    const pathParts = event.path.split('/')
    const tIndex = pathParts.findIndex((part: string) => part === 't')
    if (tIndex !== -1 && pathParts[tIndex + 1]) {
      tenantSlug = pathParts[tIndex + 1]
    }
  }
  
  return tenantSlug
}

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // Get tenant from query parameter (set by redirect rule) or path
  const tenantSlug = extractTenantSlug(event)
  
  if (!tenantSlug) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Tenant parameter missing' })
    }
  }
  
  // Get scan ID from query parameters
  const scanId = event.queryStringParameters?.scanId
  
  if (!scanId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Scan ID parameter missing' })
    }
  }
  
  // Get tenant
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .limit(1)
  
  if (!tenant) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Tenant not found' })
    }
  }

  try {
    // Get scan record
    const [scan] = await db
      .select()
      .from(scans)
      .where(and(
        eq(scans.tenantId, tenant.id),
        eq(scans.id, scanId)
      ))
      .limit(1)
    
    if (!scan) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Scan not found' })
      }
    }
    
    // Retrieve file from Netlify Blobs
    const store = getStore('scan-files')
    const blobKey = scan.filePath // This is the blob key we stored
    
    const fileContent = await store.get(blobKey, { type: 'text' })
    
    if (!fileContent) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'File not found in storage' })
      }
    }
    
    // Return the file content with appropriate headers
    const contentType = scan.scanType === 'nuclei' ? 'application/jsonl' : 'text/plain'
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${scan.fileName}"`
      },
      body: fileContent
    }
  } catch (error) {
    console.error('Download error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to download file' })
    }
  }
}