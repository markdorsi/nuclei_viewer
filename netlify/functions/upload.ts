import type { Handler } from '@netlify/functions'
import { db, scans, tenants, companies } from '../../db'
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
  if (event.httpMethod !== 'POST') {
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
    // Parse form data (simplified - in production use busboy or similar)
    const contentType = event.headers['content-type'] || ''
    const boundary = contentType.split('boundary=')[1]
    if (!boundary) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid content type - multipart/form-data required' })
      }
    }

    // Extract filename and file content from the body  
    const body = event.body || ''
    const isBase64 = event.isBase64Encoded
    
    // Decode body if base64 encoded
    const decodedBody = isBase64 ? Buffer.from(body, 'base64').toString('binary') : body
    
    const filenameMatch = decodedBody.match(/filename="([^"]+)"/)
    const fileName = filenameMatch ? filenameMatch[1] : 'upload.jsonl'
    
    // Extract file content (everything between the headers and boundary)
    const fileContentMatch = decodedBody.match(/Content-Type: [^\r\n]+\r?\n\r?\n([\s\S]*?)\r?\n--/)
    if (!fileContentMatch) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Could not extract file content' })
      }
    }
    
    const fileContent = fileContentMatch[1]
    
    // Extract company name from filename (assume format: company_scan.jsonl or company-scan.jsonl)
    const companyName = fileName.split(/[_.-]/)[0] || 'unknown-company'
    const companySlug = companyName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    
    // Find or create company
    let [company] = await db
      .select()
      .from(companies)
      .where(and(
        eq(companies.tenantId, tenant.id),
        eq(companies.slug, companySlug)
      ))
      .limit(1)
    
    if (!company) {
      console.log('Creating new company:', companyName)
      [company] = await db
        .insert(companies)
        .values({
          tenantId: tenant.id,
          name: companyName.charAt(0).toUpperCase() + companyName.slice(1),
          slug: companySlug,
          metadata: {
            createdFromUpload: true,
            originalFilename: fileName
          }
        })
        .returning()
    }

    // Determine scan type from filename
    const scanType = fileName.endsWith('.jsonl') ? 'nuclei' : 'nmap'
    
    // Generate file path for blob storage
    const date = new Date()
    const dateStr = date.toISOString().split('T')[0]
    const timestamp = date.getTime()
    const blobKey = `tenants/${tenant.slug}/companies/${company.slug}/${scanType}/${dateStr}/${timestamp}_${fileName}`
    
    // Store file in Netlify Blobs
    const store = getStore('scan-files')
    await store.set(blobKey, fileContent, {
      metadata: {
        originalName: fileName,
        contentType: scanType === 'nuclei' ? 'application/jsonl' : 'text/plain',
        uploadedBy: context.clientContext?.user?.email || 'unknown',
        uploadedAt: date.toISOString()
      }
    })
    
    // Create scan record with blob key
    const [scan] = await db
      .insert(scans)
      .values({
        tenantId: tenant.id,
        companyId: company.id,
        scanType,
        fileName,
        filePath: blobKey, // Store the blob key as the file path
        scanDate: date,
        status: 'uploaded',
        metadata: {
          uploadedBy: context.clientContext?.user?.email || 'unknown',
          originalFilename: fileName,
          blobKey,
          fileSize: fileContent.length
        }
      })
      .returning()

    // TODO: Queue background job to process the file content
    console.log(`File uploaded successfully: ${blobKey} (${fileContent.length} bytes)`)
    
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: scan.id,
        status: scan.status,
        fileName: fileName,
        fileSize: fileContent.length,
        blobKey: blobKey,
        message: 'File uploaded successfully to Netlify Blobs'
      })
    }
  } catch (error) {
    console.error('Upload error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process upload' })
    }
  }
}