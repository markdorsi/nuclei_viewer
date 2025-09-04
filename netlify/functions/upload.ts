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
  console.log('🔴 UPLOAD FUNCTION: Starting upload handler')
  console.log('🔴 UPLOAD FUNCTION: HTTP Method:', event.httpMethod)
  console.log('🔴 UPLOAD FUNCTION: Event path:', event.path)
  console.log('🔴 UPLOAD FUNCTION: Query params:', event.queryStringParameters)
  console.log('🔴 UPLOAD FUNCTION: Headers:', event.headers)
  console.log('🔴 UPLOAD FUNCTION: Content-Type:', event.headers['content-type'])
  console.log('🔴 UPLOAD FUNCTION: Body length:', event.body?.length || 0)
  console.log('🔴 UPLOAD FUNCTION: Is base64 encoded:', event.isBase64Encoded)

  if (event.httpMethod !== 'POST') {
    console.log('🔴 UPLOAD FUNCTION: Method not allowed')
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  // Get tenant from query parameter (set by redirect rule) or path
  const tenantSlug = extractTenantSlug(event)
  console.log('🔴 UPLOAD FUNCTION: Extracted tenant slug:', tenantSlug)
  
  if (!tenantSlug) {
    console.log('🔴 UPLOAD FUNCTION: No tenant slug found')
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Tenant parameter missing' })
    }
  }
  
  console.log('🔴 UPLOAD FUNCTION: Looking up tenant in database...')
  // Get tenant
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .limit(1)
  
  console.log('🔴 UPLOAD FUNCTION: Found tenant:', tenant)
  
  if (!tenant) {
    console.log('🔴 UPLOAD FUNCTION: Tenant not found in database')
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Tenant not found' })
    }
  }

  try {
    console.log('🔴 UPLOAD FUNCTION: Starting file processing...')
    
    // Parse form data (simplified - in production use busboy or similar)
    const contentType = event.headers['content-type'] || ''
    console.log('🔴 UPLOAD FUNCTION: Content-Type header:', contentType)
    
    const boundary = contentType.split('boundary=')[1]
    console.log('🔴 UPLOAD FUNCTION: Boundary:', boundary)
    
    if (!boundary) {
      console.log('🔴 UPLOAD FUNCTION: No boundary found in content-type')
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid content type - multipart/form-data required' })
      }
    }

    // Extract filename and file content from the body  
    const body = event.body || ''
    const isBase64 = event.isBase64Encoded
    
    console.log('🔴 UPLOAD FUNCTION: Body length:', body.length)
    console.log('🔴 UPLOAD FUNCTION: Is base64:', isBase64)
    
    // Decode body if base64 encoded
    const decodedBody = isBase64 ? Buffer.from(body, 'base64').toString('binary') : body
    console.log('🔴 UPLOAD FUNCTION: Decoded body length:', decodedBody.length)
    console.log('🔴 UPLOAD FUNCTION: First 500 chars of decoded body:', decodedBody.substring(0, 500))
    
    const filenameMatch = decodedBody.match(/filename="([^"]+)"/)
    const fileName = filenameMatch ? filenameMatch[1] : 'upload.jsonl'
    console.log('🔴 UPLOAD FUNCTION: Extracted filename:', fileName)
    
    // Extract file content (everything between the headers and boundary)
    const fileContentMatch = decodedBody.match(/Content-Type: [^\r\n]+\r?\n\r?\n([\s\S]*?)\r?\n--/)
    console.log('🔴 UPLOAD FUNCTION: File content match found:', !!fileContentMatch)
    
    if (!fileContentMatch) {
      console.log('🔴 UPLOAD FUNCTION: Could not extract file content from form data')
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Could not extract file content' })
      }
    }
    
    const fileContent = fileContentMatch[1]
    console.log('🔴 UPLOAD FUNCTION: File content length:', fileContent.length)
    
    // Extract company name from filename (assume format: company_scan.jsonl or company-scan.jsonl)
    const companyName = fileName.split(/[_.-]/)[0] || 'unknown-company'
    const companySlug = companyName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
    
    console.log('🔴 UPLOAD FUNCTION: Extracted company name:', companyName)
    console.log('🔴 UPLOAD FUNCTION: Company slug:', companySlug)
    console.log('🔴 UPLOAD FUNCTION: Looking for existing company...')
    
    // Find or create company
    let [company] = await db
      .select()
      .from(companies)
      .where(and(
        eq(companies.tenantId, tenant.id),
        eq(companies.slug, companySlug)
      ))
      .limit(1)
    
    console.log('🔴 UPLOAD FUNCTION: Found existing company:', company)
    
    if (!company) {
      console.log('🔴 UPLOAD FUNCTION: Creating new company:', companyName)
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
      console.log('🔴 UPLOAD FUNCTION: Created company:', company)
    }

    // Determine scan type from filename
    const scanType = fileName.endsWith('.jsonl') ? 'nuclei' : 'nmap'
    console.log('🔴 UPLOAD FUNCTION: Scan type:', scanType)
    
    // Generate file path for blob storage
    const date = new Date()
    const dateStr = date.toISOString().split('T')[0]
    const timestamp = date.getTime()
    const blobKey = `tenants/${tenant.slug}/companies/${company.slug}/${scanType}/${dateStr}/${timestamp}_${fileName}`
    
    console.log('🔴 UPLOAD FUNCTION: Generated blob key:', blobKey)
    console.log('🔴 UPLOAD FUNCTION: Storing file in Netlify Blobs...')
    
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
    
    console.log('🔴 UPLOAD FUNCTION: File stored in Netlify Blobs successfully')
    console.log('🔴 UPLOAD FUNCTION: Creating scan record in database...')
    
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

    console.log('🔴 UPLOAD FUNCTION: Created scan record:', scan)
    console.log(`🔴 UPLOAD FUNCTION: File uploaded successfully: ${blobKey} (${fileContent.length} bytes)`)
    
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
    console.error('🔴 UPLOAD FUNCTION: Upload error:', error)
    console.error('🔴 UPLOAD FUNCTION: Error name:', error.name)
    console.error('🔴 UPLOAD FUNCTION: Error message:', error.message)
    console.error('🔴 UPLOAD FUNCTION: Error stack:', error.stack)
    
    if (error instanceof Error) {
      console.error('🔴 UPLOAD FUNCTION: Detailed error:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause
      })
    }
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to process upload',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    }
  }
}