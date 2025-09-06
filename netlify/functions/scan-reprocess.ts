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

export const handler: Handler = async (event, context) => {
  console.log('🔄 REPROCESS: Scan reprocess request received')
  
  // Initialize Netlify Blobs for Lambda compatibility mode
  connectLambda(event)

  if (event.httpMethod !== 'POST') {
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
    const body = JSON.parse(event.body || '{}')
    const { scanKey } = body

    if (!scanKey) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'scanKey is required' })
      }
    }

    console.log(`🔄 REPROCESS: Reprocessing scan: ${scanKey}`)

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

    // Find the scan record - try multiple approaches
    let scanRecord = null
    
    console.log(`🔄 REPROCESS: Looking for scan with scanKey: ${scanKey}`)
    console.log(`🔄 REPROCESS: Tenant ID: ${tenant.id}`)
    
    // First try to find by exact filePath match
    const [exactMatch] = await db
      .select()
      .from(scans)
      .where(and(
        eq(scans.tenantId, tenant.id),
        eq(scans.filePath, scanKey)
      ))
      .limit(1)
    
    if (exactMatch) {
      scanRecord = exactMatch
      console.log(`🔄 REPROCESS: Found scan by filePath: ID=${scanRecord.id}, status=${scanRecord.status}`)
    } else {
      console.log(`🔄 REPROCESS: No exact filePath match found for: ${scanKey}`)
      
      // If not found, try by fileName (extract from scanKey)
      const scanKeyParts = scanKey.split('/')
      const fileName = scanKeyParts[scanKeyParts.length - 1]
      console.log(`🔄 REPROCESS: Trying fileName match: ${fileName}`)
      
      const [fileNameMatch] = await db
        .select()
        .from(scans)
        .where(and(
          eq(scans.tenantId, tenant.id),
          eq(scans.fileName, fileName)
        ))
        .limit(1)
      
      if (fileNameMatch) {
        scanRecord = fileNameMatch
        console.log(`🔄 REPROCESS: Found scan by fileName: ID=${scanRecord.id}, status=${scanRecord.status}, filePath=${scanRecord.filePath}`)
      } else {
        console.log(`🔄 REPROCESS: No fileName match found either`)
      }
    }
    
    // Show all scans for this tenant for debugging
    const allScans = await db
      .select({ id: scans.id, fileName: scans.fileName, filePath: scans.filePath, status: scans.status })
      .from(scans)
      .where(eq(scans.tenantId, tenant.id))
    
    console.log(`🔄 REPROCESS: All scans for tenant:`, allScans)

    if (!scanRecord) {
      console.log(`🔄 REPROCESS: Scan record not found for key: ${scanKey}`)
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Scan record not found' })
      }
    }

    // Get the scan data from storage
    const scanStore = getStore(SCANS_STORE_NAME)
    const scanBlob = await scanStore.get(scanKey)
    
    if (!scanBlob) {
      console.log(`🔄 REPROCESS: Scan file not found in storage: ${scanKey}`)
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

    console.log(`🔄 REPROCESS: Scan content length: ${scanContent.length}`)
    
    // Log first 1000 characters of the scan content
    console.log('🔄 REPROCESS: Scan content preview:')
    console.log(scanContent.substring(0, 1000))
    
    // Check if it's JSON or JSONL
    const lines = scanContent.split('\n').filter(line => line.trim())
    console.log(`🔄 REPROCESS: Found ${lines.length} lines in scan file`)
    
    // Try to parse first line as JSON
    if (lines.length > 0) {
      try {
        const firstLine = JSON.parse(lines[0])
        console.log('🔄 REPROCESS: First line parsed as JSON:', JSON.stringify(firstLine, null, 2))
      } catch (e) {
        console.log('🔄 REPROCESS: First line is not valid JSON:', lines[0])
      }
    }

    // Call process-scan endpoint
    const processUrl = `${event.headers.origin || 'https://scanvault.netlify.app'}/api/t/${tenantSlug}/scans/process`
    console.log(`🔄 REPROCESS: Calling process endpoint: ${processUrl}`)
    
    const processResponse = await fetch(processUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': event.headers.authorization || ''
      },
      body: JSON.stringify({ scanKey })
    })

    const processResult = await processResponse.json()
    console.log('🔄 REPROCESS: Process result:', processResult)

    // Verify the scan status was updated in the database
    try {
      const [updatedScan] = await db
        .select({ status: scans.status, processedAt: scans.processedAt })
        .from(scans)
        .where(and(
          eq(scans.tenantId, tenant.id),
          eq(scans.filePath, scanKey)
        ))
        .limit(1)
      
      if (updatedScan) {
        console.log('🔄 REPROCESS: Updated scan status in DB:', updatedScan.status)
        console.log('🔄 REPROCESS: Processed at:', updatedScan.processedAt)
      } else {
        console.log('🔄 REPROCESS: ⚠️ Scan record not found in DB after processing')
      }
    } catch (dbError) {
      console.error('🔄 REPROCESS: Error checking updated scan status:', dbError)
    }

    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      body: JSON.stringify({
        message: 'Scan reprocessing triggered',
        scanKey,
        processResult
      })
    }

  } catch (error) {
    console.error('🔄 REPROCESS: Error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to reprocess scan',
        details: error.message 
      })
    }
  }
}