import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
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
  console.log('🟢 ASSEMBLE UPLOAD: Starting file assembly handler')
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const tenantSlug = extractTenantSlug(event)
    
    if (!tenantSlug) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Tenant not found' })
      }
    }

    const requestBody = JSON.parse(event.body || '{}')
    const { uploadId, fileName, totalChunks, companyId, companyName } = requestBody

    if (!uploadId || !fileName || !totalChunks) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required parameters: uploadId, fileName, totalChunks' })
      }
    }

    console.log('🟢 ASSEMBLE UPLOAD: Assembling file', {
      uploadId,
      fileName,
      totalChunks,
      companyId,
      companyName
    })

    // Get chunk storage
    const chunkStore = getStore({
      name: 'chunk-storage',
      consistency: 'strong'
    })

    // Retrieve and assemble all chunks
    let assembledContent = ''
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const chunkKey = `uploads/${uploadId}/chunk_${chunkIndex}`
      
      try {
        const chunkData = await chunkStore.get(chunkKey, { type: 'text' })
        
        if (!chunkData) {
          throw new Error(`Chunk ${chunkIndex} not found`)
        }
        
        assembledContent += chunkData
        console.log(`🟢 ASSEMBLE UPLOAD: Retrieved chunk ${chunkIndex + 1}/${totalChunks}, size: ${chunkData.length}`)
      } catch (chunkError) {
        console.error(`🟢 ASSEMBLE UPLOAD: Error retrieving chunk ${chunkIndex}:`, chunkError)
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            error: `Failed to retrieve chunk ${chunkIndex}`,
            message: chunkError instanceof Error ? chunkError.message : 'Unknown error'
          })
        }
      }
    }

    console.log(`🟢 ASSEMBLE UPLOAD: File assembled successfully, total size: ${assembledContent.length} bytes`)

    // Handle company creation/lookup (same logic as original upload function)
    let company
    
    if (companyId) {
      // Use existing company
      ;[company] = await db
        .select()
        .from(companies)
        .where(and(
          eq(companies.tenantId, tenant.id),
          eq(companies.id, companyId)
        ))
        .limit(1)
      
      if (!company) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Company not found' })
        }
      }
    } else if (companyName) {
      // Create new company
      const companySlug = companyName.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      
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
            name: companyName,
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

    // Determine scan type and create final blob storage
    const scanType = fileName.endsWith('.jsonl') ? 'nuclei' : 'nmap'
    const date = new Date()
    const dateStr = date.toISOString().split('T')[0]
    const timestamp = date.getTime()
    const finalBlobKey = `tenants/${tenant.slug}/companies/${company.slug}/${scanType}/${dateStr}/${timestamp}_${fileName}`

    // Store assembled file in final location
    const finalStore = getStore({
      name: 'scan-files',
      consistency: 'strong'
    })

    await finalStore.set(finalBlobKey, assembledContent, {
      metadata: {
        originalName: fileName,
        contentType: scanType === 'nuclei' ? 'application/jsonl' : 'text/plain',
        uploadedBy: context.clientContext?.user?.email || 'unknown',
        uploadedAt: date.toISOString(),
        assembledFromChunks: totalChunks
      }
    })

    // Create scan record
    const [scan] = await db
      .insert(scans)
      .values({
        tenantId: tenant.id,
        companyId: company.id,
        scanType,
        fileName,
        filePath: finalBlobKey,
        scanDate: date,
        status: 'pending',
        metadata: {
          uploadedBy: context.clientContext?.user?.email || 'unknown',
          originalFilename: fileName,
          blobKey: finalBlobKey,
          fileSize: assembledContent.length,
          assembledFromChunks: totalChunks,
          uploadId
        }
      })
      .returning()

    // Clean up chunk files
    console.log('🟢 ASSEMBLE UPLOAD: Cleaning up chunks...')
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const chunkKey = `uploads/${uploadId}/chunk_${chunkIndex}`
      try {
        await chunkStore.delete(chunkKey)
      } catch (cleanupError) {
        console.warn(`🟢 ASSEMBLE UPLOAD: Failed to delete chunk ${chunkKey}:`, cleanupError)
        // Continue cleanup even if some chunks fail to delete
      }
    }

    console.log('🟢 ASSEMBLE UPLOAD: File assembled successfully:', {
      scanId: scan.id,
      fileName,
      fileSize: assembledContent.length,
      totalChunks,
      finalBlobKey
    })

    // Trigger scan processing
    console.log('🟢 ASSEMBLE UPLOAD: Triggering scan processing...')
    try {
      const processResponse = await fetch(`${event.headers.origin || 'https://scanvault.netlify.app'}/.netlify/functions/process-scan?tenant=${tenantSlug}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scanId: scan.id
        })
      })

      if (!processResponse.ok) {
        console.error('🟢 ASSEMBLE UPLOAD: Processing failed:', await processResponse.text())
      } else {
        const processResult = await processResponse.json()
        console.log('🟢 ASSEMBLE UPLOAD: Processing completed:', processResult)
      }
    } catch (processError) {
      console.error('🟢 ASSEMBLE UPLOAD: Processing error:', processError)
    }

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: scan.id,
        status: scan.status,
        fileName,
        fileSize: assembledContent.length,
        blobKey: finalBlobKey,
        message: `File assembled successfully from ${totalChunks} chunks`
      })
    }

  } catch (error: any) {
    console.error('🟢 ASSEMBLE UPLOAD: Error:', error)
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to assemble file',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    }
  }
}