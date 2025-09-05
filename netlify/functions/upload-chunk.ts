import type { Handler } from '@netlify/functions'
import { db, scans, tenants, companies } from '../../db'
import { eq, and } from 'drizzle-orm'

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
  console.log('🟡🟡🟡 CHUNK UPLOAD: Starting chunk upload handler (database storage) 🟡🟡🟡')
  console.log('🟡 CHUNK UPLOAD: HTTP Method:', event.httpMethod)
  console.log('🟡 CHUNK UPLOAD: Path:', event.path)
  console.log('🟡 CHUNK UPLOAD: Query params:', JSON.stringify(event.queryStringParameters))
  console.log('🟡 CHUNK UPLOAD: Headers:', JSON.stringify(event.headers))
  console.log('🟡 CHUNK UPLOAD: Body exists:', !!event.body)
  console.log('🟡 CHUNK UPLOAD: Body length:', event.body?.length || 0)
  console.log('🟡 CHUNK UPLOAD: Is base64:', event.isBase64Encoded)
  
  if (event.httpMethod !== 'POST') {
    console.log('🟡 CHUNK UPLOAD: Method not allowed:', event.httpMethod)
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const tenantSlug = extractTenantSlug(event)
    console.log('🟡 CHUNK UPLOAD: Extracted tenant slug:', tenantSlug)
    
    if (!tenantSlug) {
      console.log('🟡 CHUNK UPLOAD: ERROR - No tenant slug found')
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Tenant parameter missing' })
      }
    }

    console.log('🟡 CHUNK UPLOAD: Looking up tenant in database...')
    // Get tenant
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
    
    console.log('🟡 CHUNK UPLOAD: Database tenant query result:', tenant ? 'FOUND' : 'NOT FOUND')
    if (tenant) {
      console.log('🟡 CHUNK UPLOAD: Tenant details:', { id: tenant.id, name: tenant.name, slug: tenant.slug })
    }
    
    if (!tenant) {
      console.log('🟡 CHUNK UPLOAD: ERROR - Tenant not found in database for slug:', tenantSlug)
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Tenant not found' })
      }
    }

    const contentType = event.headers['content-type'] || ''
    console.log('🟡 CHUNK UPLOAD: Content-Type:', contentType)
    const boundary = contentType.split('boundary=')[1]
    console.log('🟡 CHUNK UPLOAD: Boundary:', boundary)
    
    if (!boundary) {
      console.log('🟡 CHUNK UPLOAD: ERROR - No boundary found in content-type')
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid content type - multipart/form-data required' })
      }
    }

    const body = event.body || ''
    const isBase64 = event.isBase64Encoded
    console.log('🟡 CHUNK UPLOAD: Raw body length:', body.length, 'Is base64:', isBase64)
    
    const decodedBody = isBase64 ? Buffer.from(body, 'base64').toString('binary') : body
    console.log('🟡 CHUNK UPLOAD: Decoded body length:', decodedBody.length)
    console.log('🟡 CHUNK UPLOAD: First 300 chars of decoded body:', decodedBody.substring(0, 300))

    // Extract metadata from form data
    console.log('🟡 CHUNK UPLOAD: Extracting form data...')
    const uploadIdMatch = decodedBody.match(/name="uploadId"\r?\n\r?\n([^\r\n]+)/)
    const chunkIndexMatch = decodedBody.match(/name="chunkIndex"\r?\n\r?\n([^\r\n]+)/)
    const totalChunksMatch = decodedBody.match(/name="totalChunks"\r?\n\r?\n([^\r\n]+)/)
    const fileNameMatch = decodedBody.match(/name="fileName"\r?\n\r?\n([^\r\n]+)/)
    
    // Extract company info
    const companyIdMatch = decodedBody.match(/name="companyId"\r?\n\r?\n([^\r\n]+)/)
    const companyNameMatch = decodedBody.match(/name="companyName"\r?\n\r?\n([^\r\n]+)/)
    
    console.log('🟡 CHUNK UPLOAD: Form data matches:', {
      uploadIdMatch: !!uploadIdMatch,
      chunkIndexMatch: !!chunkIndexMatch,
      totalChunksMatch: !!totalChunksMatch,
      fileNameMatch: !!fileNameMatch,
      companyIdMatch: !!companyIdMatch,
      companyNameMatch: !!companyNameMatch
    })
    
    // Extract chunk data
    let chunkDataMatch = decodedBody.match(/name="chunk"[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n--/)
    if (!chunkDataMatch) {
      console.log('🟡 CHUNK UPLOAD: First chunk pattern failed, trying alternative...')
      chunkDataMatch = decodedBody.match(/Content-Type: [^\r\n]+\r?\n\r?\n([\s\S]*?)\r?\n--/)
    }
    
    console.log('🟡 CHUNK UPLOAD: Chunk data match found:', !!chunkDataMatch)

    if (!uploadIdMatch || !chunkIndexMatch || !totalChunksMatch || !fileNameMatch || !chunkDataMatch) {
      console.log('🟡 CHUNK UPLOAD: ERROR - Missing required form data:', {
        uploadIdMatch: !!uploadIdMatch,
        chunkIndexMatch: !!chunkIndexMatch,
        totalChunksMatch: !!totalChunksMatch,
        fileNameMatch: !!fileNameMatch,
        chunkDataMatch: !!chunkDataMatch
      })
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Missing required chunk data',
          debug: {
            uploadIdMatch: !!uploadIdMatch,
            chunkIndexMatch: !!chunkIndexMatch,
            totalChunksMatch: !!totalChunksMatch,
            fileNameMatch: !!fileNameMatch,
            chunkDataMatch: !!chunkDataMatch,
            bodyPreview: decodedBody.substring(0, 500)
          }
        })
      }
    }

    const uploadId = uploadIdMatch[1]
    const chunkIndex = parseInt(chunkIndexMatch[1])
    const totalChunks = parseInt(totalChunksMatch[1])
    const fileName = fileNameMatch[1]
    const chunkData = chunkDataMatch[1]
    const providedCompanyId = companyIdMatch ? companyIdMatch[1] : null
    const providedCompanyName = companyNameMatch ? companyNameMatch[1] : null

    console.log('🟡 CHUNK UPLOAD: Extracted values:', {
      uploadId,
      chunkIndex,
      totalChunks,
      fileName,
      chunkSize: chunkData.length,
      providedCompanyId,
      providedCompanyName
    })
    
    console.log('🟡 CHUNK UPLOAD: First 100 chars of chunk data:', chunkData.substring(0, 100))

    // Handle company lookup/creation
    console.log('🟡 CHUNK UPLOAD: Starting company lookup/creation...')
    let company
    
    if (providedCompanyId) {
      console.log('🟡 CHUNK UPLOAD: Looking up company by ID:', providedCompanyId)
      ;[company] = await db
        .select()
        .from(companies)
        .where(and(
          eq(companies.tenantId, tenant.id),
          eq(companies.id, providedCompanyId)
        ))
        .limit(1)
      
      console.log('🟡 CHUNK UPLOAD: Company lookup result:', company ? 'FOUND' : 'NOT FOUND')
      
      if (!company) {
        console.log('🟡 CHUNK UPLOAD: ERROR - Company not found for ID:', providedCompanyId)
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Company not found' })
        }
      }
    } else if (providedCompanyName) {
      const companySlug = providedCompanyName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      
      ;[company] = await db
        .select()
        .from(companies)
        .where(and(
          eq(companies.tenantId, tenant.id),
          eq(companies.slug, companySlug)
        ))
        .limit(1)
      
      if (!company) {
        ;[company] = await db
          .insert(companies)
          .values({
            tenantId: tenant.id,
            name: providedCompanyName,
            slug: companySlug,
            metadata: {
              createdFromUpload: true,
              createdManually: true
            }
          })
          .returning()
      }
    } else {
      // Extract from filename
      const extractedCompanyName = fileName.split(/[_.-]/)[0] || 'unknown-company'
      const companySlug = extractedCompanyName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      
      ;[company] = await db
        .select()
        .from(companies)
        .where(and(
          eq(companies.tenantId, tenant.id),
          eq(companies.slug, companySlug)
        ))
        .limit(1)
      
      if (!company) {
        ;[company] = await db
          .insert(companies)
          .values({
            tenantId: tenant.id,
            name: extractedCompanyName.charAt(0).toUpperCase() + extractedCompanyName.slice(1),
            slug: companySlug,
            metadata: {
              createdFromUpload: true,
              originalFilename: fileName
            }
          })
          .returning()
      }
    }

    // Create chunk filename and store in database
    const scanType = fileName.endsWith('.jsonl') ? 'nuclei' : 'nmap'
    const date = new Date()
    const chunkFileName = `${fileName}.chunk${chunkIndex.toString().padStart(3, '0')}`
    const chunkPath = `chunks/${uploadId}/${chunkFileName}`

    console.log('🟡 CHUNK UPLOAD: About to insert chunk into database...')
    console.log('🟡 CHUNK UPLOAD: Insert values:', {
      tenantId: tenant.id,
      companyId: company.id,
      scanType,
      fileName: chunkFileName,
      filePath: chunkPath,
      contentLength: chunkData.length,
      status: 'pending'
    })

    // Store chunk as a scan record with content in database
    const [chunkScan] = await db
      .insert(scans)
      .values({
        tenantId: tenant.id,
        companyId: company.id,
        scanType,
        fileName: chunkFileName,
        filePath: chunkPath,
        content: chunkData, // Store content directly in database
        scanDate: date,
        status: 'pending',
        metadata: {
          uploadId,
          chunkIndex,
          totalChunks,
          originalFileName: fileName,
          isChunk: true,
          uploadedBy: context.clientContext?.user?.email || 'unknown',
          chunkSize: chunkData.length
        }
      })
      .returning()

    console.log('🟡 CHUNK UPLOAD: Successfully stored chunk in database:', {
      scanId: chunkScan.id,
      fileName: chunkScan.fileName,
      contentLength: chunkScan.content?.length || 0
    })

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        uploadId,
        chunkIndex,
        scanId: chunkScan.id,
        message: `Chunk ${chunkIndex + 1}/${totalChunks} stored in database`
      })
    }

  } catch (error: any) {
    console.error('🟡🟡🟡 CHUNK UPLOAD: FATAL ERROR 🟡🟡🟡')
    console.error('🟡 CHUNK UPLOAD: Error name:', error.name)
    console.error('🟡 CHUNK UPLOAD: Error message:', error.message)
    console.error('🟡 CHUNK UPLOAD: Error stack:', error.stack)
    console.error('🟡 CHUNK UPLOAD: Full error object:', error)
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to process chunk', 
        message: error.message,
        details: error.stack,
        errorName: error.name
      })
    }
  }
}