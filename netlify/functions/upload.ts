import type { Handler } from '@netlify/functions'
import { db, scans, tenants, companies } from '../../db'
import { eq } from 'drizzle-orm'
// File operations removed - use Netlify Blobs or S3 in production

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const pathParts = event.path.split('/')
  const tenantSlug = pathParts[3] // /api/t/{tenant}/upload
  
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
    const boundary = event.headers['content-type']?.split('boundary=')[1]
    if (!boundary) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid content type' })
      }
    }

    // Extract company ID and file data from the body
    // This is a simplified parser - use a proper multipart parser in production
    const body = event.body || ''
    const companyIdMatch = body.match(/name="companyId"\r?\n\r?\n([^\r\n]+)/)
    const companyId = companyIdMatch ? companyIdMatch[1] : null

    if (!companyId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Company ID is required' })
      }
    }

    // Verify company belongs to tenant
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1)

    if (!company || company.tenantId !== tenant.id) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Company not found' })
      }
    }

    // Extract filename
    const filenameMatch = body.match(/filename="([^"]+)"/)
    const fileName = filenameMatch ? filenameMatch[1] : 'upload.jsonl'

    // Determine scan type from filename
    const scanType = fileName.endsWith('.jsonl') ? 'nuclei' : 'nmap'
    
    // Generate file path
    const date = new Date()
    const dateStr = date.toISOString().split('T')[0]
    const filePath = `tenants/${tenant.slug}/companies/${company.slug}/${scanType}/${dateStr}/${fileName}`
    
    // Create scan record
    const [scan] = await db
      .insert(scans)
      .values({
        tenantId: tenant.id,
        companyId: company.id,
        scanType,
        fileName,
        filePath,
        scanDate: date,
        status: 'pending',
        metadata: {
          uploadedBy: context.clientContext?.user?.email || 'unknown',
          originalFilename: fileName
        }
      })
      .returning()

    // TODO: Queue background job to process the file
    // For now, we'll just save it locally (in production, use Netlify Blobs or S3)
    
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: scan.id,
        status: scan.status,
        message: 'File uploaded successfully and queued for processing'
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