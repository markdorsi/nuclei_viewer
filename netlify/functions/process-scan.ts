import type { Handler } from '@netlify/functions'
import { getStore } from '@netlify/blobs'
import { db, scans, tenants, findings } from '../../db'
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

// Parse nuclei JSONL content into findings
function parseNucleiFindings(content: string, scanId: string, companyId: string): any[] {
  console.log('🔍 NUCLEI PARSER: Starting nuclei findings parsing...')
  console.log('🔍 NUCLEI PARSER: Content length:', content.length)
  console.log('🔍 NUCLEI PARSER: First 300 chars:', content.substring(0, 300))
  
  const findings = []
  const lines = content.split('\n').filter(line => line.trim())
  
  console.log('🔍 NUCLEI PARSER: Found', lines.length, 'non-empty lines')
  
  if (lines.length > 0) {
    console.log('🔍 NUCLEI PARSER: First line:', lines[0])
    console.log('🔍 NUCLEI PARSER: Last line:', lines[lines.length - 1])
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    console.log('🔍 NUCLEI PARSER: Processing line', i + 1, ':', line.substring(0, 150))
    
    try {
      const nucleiResult = JSON.parse(line)
      console.log('🔍 NUCLEI PARSER: Successfully parsed JSON for line', i + 1)
      console.log('🔍 NUCLEI PARSER: Nuclei result keys:', Object.keys(nucleiResult))
      
      // Extract key information from nuclei result and create proper finding record
      const templateId = nucleiResult.info?.name || nucleiResult.template || 'unknown'
      const host = nucleiResult.host || 'unknown'
      const path = nucleiResult.matched_at || nucleiResult.matched || ''
      const dedupeKey = `${templateId}-${host}-${path}`.toLowerCase()
      
      const finding = {
        tenantId: '', // Will be set by caller
        companyId,
        scanId,
        assetId: null,
        dedupeKey,
        templateId,
        templateName: nucleiResult.info?.name || 'Unknown Template',
        severity: nucleiResult.info?.severity || nucleiResult.info?.classification?.severity || 'info',
        name: nucleiResult.info?.name || templateId,
        description: nucleiResult.info?.description || '',
        matcher: nucleiResult.matcher_name || null,
        extractedResults: nucleiResult.extracted_results || null,
        metadata: {
          type: nucleiResult.type || 'http',
          protocol: nucleiResult.scheme || 'http',
          host: host,
          port: nucleiResult.port || null,
          path: path,
          tags: nucleiResult.info?.tags || [],
          reference: nucleiResult.info?.reference || [],
          classification: nucleiResult.info?.classification || {},
          matcher_status: nucleiResult.matcher_status,
          matcher_name: nucleiResult.matcher_name,
          extracted_results: nucleiResult.extracted_results,
          curl_command: nucleiResult.curl_command,
          response: nucleiResult.response
        },
        tags: nucleiResult.info?.tags || [],
        resolved: false,
        currentStatus: 'detected'
      }
      
      console.log('🔍 NUCLEI PARSER: Created finding:', {
        templateId: finding.templateId,
        templateName: finding.templateName,
        severity: finding.severity,
        host: finding.host
      })
      
      findings.push(finding)
    } catch (parseError: any) {
      console.error('🔍 NUCLEI PARSER: Failed to parse line', i + 1, ':', parseError.message)
      console.error('🔍 NUCLEI PARSER: Problematic line:', line.substring(0, 200))
    }
  }
  
  console.log('🔍 NUCLEI PARSER: Parsing complete - extracted', findings.length, 'nuclei findings')
  return findings
}

// Parse nmap XML content into findings (simplified)
function parseNmapFindings(content: string, scanId: string, companyId: string): any[] {
  const findings = []
  
  console.log('🔍 PROCESS: Parsing nmap XML content, length:', content.length)
  
  // Simple regex-based parsing for open ports
  const hostRegex = /<host[^>]*>.*?<\/host>/gs
  const hostMatches = content.match(hostRegex) || []
  
  console.log('🔍 PROCESS: Found', hostMatches.length, 'hosts in nmap scan')
  
  for (const hostMatch of hostMatches) {
    // Extract IP address
    const ipMatch = hostMatch.match(/<address\s+addr="([^"]+)"\s+addrtype="ipv4"/)
    const ip = ipMatch ? ipMatch[1] : 'unknown'
    
    // Extract open ports
    const portRegex = /<port\s+protocol="([^"]+)"\s+portid="([^"]+)"[^>]*>.*?<state\s+state="open"[^>]*>.*?<service\s+name="([^"]*)"[^>]*>/gs
    let portMatch
    
    while ((portMatch = portRegex.exec(hostMatch)) !== null) {
      const [, protocol, portId, serviceName] = portMatch
      
      const templateId = `nmap-open-port-${protocol}-${portId}`
      const dedupeKey = `${templateId}-${ip}`.toLowerCase()
      
      const finding = {
        tenantId: '', // Will be set by caller
        companyId,
        scanId,
        assetId: null,
        dedupeKey,
        templateId,
        templateName: `Open ${protocol.toUpperCase()} Port ${portId}`,
        severity: 'info', // Default severity for open ports
        name: `Open Port ${portId}`,
        description: `Open ${protocol.toUpperCase()} port ${portId} running ${serviceName || 'unknown service'}`,
        matcher: null,
        extractedResults: null,
        metadata: {
          type: 'port',
          protocol: protocol,
          host: ip,
          port: parseInt(portId),
          path: `${protocol}://${ip}:${portId}`,
          service: serviceName || 'unknown',
          scan_type: 'nmap'
        },
        tags: ['nmap', 'port-scan', protocol],
        resolved: false,
        currentStatus: 'detected'
      }
      
      findings.push(finding)
    }
  }
  
  console.log('🔍 PROCESS: Extracted', findings.length, 'nmap findings')
  return findings
}

export const handler: Handler = async (event, context) => {
  console.log('🔍🔍🔍 PROCESS: Starting scan processing handler 🔍🔍🔍')
  console.log('🔍 PROCESS: HTTP Method:', event.httpMethod)
  console.log('🔍 PROCESS: Path:', event.path)
  console.log('🔍 PROCESS: Query params:', JSON.stringify(event.queryStringParameters))
  console.log('🔍 PROCESS: Body:', event.body)
  
  if (event.httpMethod !== 'POST') {
    console.log('🔍 PROCESS: Method not allowed:', event.httpMethod)
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const tenantSlug = extractTenantSlug(event)
    console.log('🔍 PROCESS: Extracted tenant slug:', tenantSlug)
    
    if (!tenantSlug) {
      console.log('🔍 PROCESS: ERROR - No tenant slug found')
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Tenant parameter missing' })
      }
    }

    console.log('🔍 PROCESS: Looking up tenant in database...')
    // Get tenant
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)
    
    console.log('🔍 PROCESS: Tenant lookup result:', tenant ? 'FOUND' : 'NOT FOUND')
    if (tenant) {
      console.log('🔍 PROCESS: Tenant details:', { id: tenant.id, name: tenant.name, slug: tenant.slug })
    }
    
    if (!tenant) {
      console.log('🔍 PROCESS: ERROR - Tenant not found for slug:', tenantSlug)
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Tenant not found' })
      }
    }

    // Get scan ID from request body
    console.log('🔍 PROCESS: Parsing request body...')
    const body = JSON.parse(event.body || '{}')
    const { scanId } = body
    console.log('🔍 PROCESS: Request body:', body)
    console.log('🔍 PROCESS: Extracted scanId:', scanId)
    
    if (!scanId) {
      console.log('🔍 PROCESS: ERROR - No scan ID provided')
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Scan ID required' })
      }
    }

    console.log('🔍 PROCESS: Processing scan:', scanId)

    console.log('🔍 PROCESS: Looking up scan record in database...')
    // Get scan record
    let [scan] = await db
      .select()
      .from(scans)
      .where(and(
        eq(scans.id, scanId),
        eq(scans.tenantId, tenant.id)
      ))
      .limit(1)

    console.log('🔍 PROCESS: Scan lookup result:', scan ? 'FOUND' : 'NOT FOUND')
    
    if (!scan) {
      console.log('🔍 PROCESS: ERROR - Scan not found for ID:', scanId)
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Scan not found' })
      }
    }

    console.log('🔍 PROCESS: Found scan details:', {
      id: scan.id,
      fileName: scan.fileName,
      scanType: scan.scanType,
      status: scan.status,
      hasContent: !!scan.content,
      contentLength: scan.content?.length || 0,
      metadata: scan.metadata
    })
    console.log('🔍 PROCESS: Environment check:', {
      NETLIFY_SITE_ID: !!process.env.NETLIFY_SITE_ID,
      NETLIFY_FUNCTIONS_TOKEN: !!process.env.NETLIFY_FUNCTIONS_TOKEN,
      NETLIFY_BLOBS_TOKEN: !!process.env.NETLIFY_BLOBS_TOKEN,
      NODE_ENV: process.env.NODE_ENV,
      URL: !!process.env.URL,
      clientContext: !!context.clientContext,
      clientContextSiteUrl: context.clientContext?.custom?.netlify?.siteUrl,
      allEnvKeys: Object.keys(process.env).filter(k => k.includes('NETLIFY') || k.includes('BLOB'))
    })

    // Check if this is a chunk file that needs assembly first
    if (scan.fileName.includes('.chunk')) {
      console.log('🔍 PROCESS: This is a chunk file, assembling from database storage...')
      
      try {
        // Extract base filename and uploadId from metadata
        const uploadId = scan.metadata?.uploadId
        const baseFileName = scan.metadata?.originalFileName || scan.fileName.split('.chunk')[0]
        
        console.log('🔍 PROCESS: Chunk processing details:', {
          uploadId,
          baseFileName,
          isChunk: scan.metadata?.isChunk,
          chunkIndex: scan.metadata?.chunkIndex,
          totalChunks: scan.metadata?.totalChunks
        })
        
        if (!uploadId) {
          console.log('🔍 PROCESS: ERROR - No uploadId in metadata, cannot assemble chunks')
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid chunk - no uploadId in metadata' })
          }
        }
        
        console.log('🔍 PROCESS: Searching for all chunks with same uploadId...')
        // Find all chunks for this uploadId from the database
        const allChunks = await db
          .select()
          .from(scans)
          .where(and(
            eq(scans.tenantId, tenant.id),
            eq(scans.companyId, scan.companyId)
          ))
        
        console.log('🔍 PROCESS: Found', allChunks.length, 'total scans for this company')
        console.log('🔍 PROCESS: Scan details:', allChunks.map(s => ({
          id: s.id,
          fileName: s.fileName,
          uploadId: s.metadata?.uploadId,
          isChunk: s.metadata?.isChunk,
          chunkIndex: s.metadata?.chunkIndex
        })))
        
        // Filter chunks that belong to the same upload
        const relatedChunks = allChunks.filter(s => {
          const chunkUploadId = s.metadata?.uploadId
          const isChunk = s.metadata?.isChunk
          return chunkUploadId === uploadId && isChunk
        })
        
        console.log('🔍 PROCESS: Found', relatedChunks.length, 'related chunks for uploadId:', uploadId)
        console.log('🔍 PROCESS: Related chunks:', relatedChunks.map(c => ({
          id: c.id,
          fileName: c.fileName,
          chunkIndex: c.metadata?.chunkIndex,
          hasContent: !!c.content,
          contentLength: c.content?.length || 0
        })))
        
        if (relatedChunks.length === 0) {
          return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'No chunks found for assembly' })
          }
        }
        
        // Sort chunks by chunk index
        relatedChunks.sort((a, b) => {
          const aChunk = (a.metadata?.chunkIndex as number) || 0
          const bChunk = (b.metadata?.chunkIndex as number) || 0
          return aChunk - bChunk
        })
        
        console.log('🔍 PROCESS: Sorted chunks by index:', relatedChunks.map(c => ({ 
          fileName: c.fileName, 
          chunkIndex: c.metadata?.chunkIndex,
          hasContent: !!c.content
        })))
        
        // Assemble content from all chunks using database content field
        console.log('🔍 PROCESS: Starting content assembly...')
        let assembledContent = ''
        
        for (const chunk of relatedChunks) {
          console.log('🔍 PROCESS: Processing chunk:', {
            id: chunk.id,
            fileName: chunk.fileName,
            chunkIndex: chunk.metadata?.chunkIndex,
            hasContent: !!chunk.content,
            contentLength: chunk.content?.length || 0
          })
          
          if (chunk.content) {
            const beforeLength = assembledContent.length
            assembledContent += chunk.content
            const afterLength = assembledContent.length
            console.log('🔍 PROCESS: Added chunk data - before:', beforeLength, 'after:', afterLength, 'added:', afterLength - beforeLength)
          } else {
            console.warn('🔍 PROCESS: WARNING - No content found for chunk:', chunk.fileName, 'ID:', chunk.id)
          }
        }
        
        console.log('🔍 PROCESS: Content assembly complete - total length:', assembledContent.length)
        console.log('🔍 PROCESS: First 200 chars of assembled content:', assembledContent.substring(0, 200))
        
        if (assembledContent.length === 0) {
          return {
            statusCode: 404,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'No content found in chunks' })
          }
        }
        
        // Use the assembled content to parse findings
        const scanType = baseFileName.endsWith('.jsonl') ? 'nuclei' : 'nmap'
        console.log('🔍 PROCESS: Determined scan type:', scanType, 'from filename:', baseFileName)
        
        let parsedFindings = []
        
        if (scanType === 'nuclei') {
          console.log('🔍 PROCESS: Parsing nuclei findings...')
          parsedFindings = parseNucleiFindings(assembledContent, scan.id, scan.companyId)
          // Set tenantId for all findings
          parsedFindings = parsedFindings.map(finding => ({
            ...finding,
            tenantId: tenant.id
          }))
        } else if (scanType === 'nmap') {
          console.log('🔍 PROCESS: Parsing nmap findings...')
          parsedFindings = parseNmapFindings(assembledContent, scan.id, scan.companyId)
          // Set tenantId for all findings
          parsedFindings = parsedFindings.map(finding => ({
            ...finding,
            tenantId: tenant.id
          }))
        } else {
          console.log('🔍 PROCESS: WARNING - Unknown scan type:', scanType)
        }

        console.log('🔍 PROCESS: Parsing complete - found', parsedFindings.length, 'findings')
        if (parsedFindings.length > 0) {
          console.log('🔍 PROCESS: Sample finding:', parsedFindings[0])
        }

        // Insert findings into database
        console.log('🔍 PROCESS: Preparing to insert findings into database...')
        if (parsedFindings.length > 0) {
          console.log('🔍 PROCESS: Inserting', parsedFindings.length, 'findings into database...')
          await db
            .insert(findings)
            .values(parsedFindings)
          console.log('🔍 PROCESS: Successfully inserted', parsedFindings.length, 'findings')
        } else {
          console.log('🔍 PROCESS: No findings to insert')
        }

        console.log('🔍 PROCESS: Updating scan status to completed...')
        // Update scan status to completed
        await db
          .update(scans)
          .set({
            status: 'completed',
            processedAt: new Date()
          })
          .where(eq(scans.id, scan.id))

        console.log('🔍 PROCESS: Successfully updated scan status to completed')

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Chunked scan processed successfully from database',
            scanId: scan.id,
            findingsCount: parsedFindings.length,
            status: 'completed',
            assembledFrom: relatedChunks.length + ' chunks'
          })
        }
        
      } catch (assemblyError: any) {
        console.error('🔍🔍🔍 PROCESS: CHUNK ASSEMBLY ERROR 🔍🔍🔍')
        console.error('🔍 PROCESS: Assembly error name:', assemblyError.name)
        console.error('🔍 PROCESS: Assembly error message:', assemblyError.message)
        console.error('🔍 PROCESS: Assembly error stack:', assemblyError.stack)
        return {
          statusCode: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            error: 'Failed to assemble chunks from database', 
            message: assemblyError.message,
            stack: assemblyError.stack
          })
        }
      }
    }

    // Get file content from blob storage
    const store = getStore({
      name: 'scan-files',
      consistency: 'strong'
    })

    const blobKey = scan.metadata?.blobKey || scan.filePath
    console.log('🔍 PROCESS: Reading from blob key:', blobKey)
    
    const fileContent = await store.get(blobKey, { type: 'text' })
    
    if (!fileContent) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'File content not found in blob storage' })
      }
    }

    console.log('🔍 PROCESS: Retrieved file content, length:', fileContent.length)

    // Parse content based on scan type
    let parsedFindings = []
    
    if (scan.scanType === 'nuclei') {
      parsedFindings = parseNucleiFindings(fileContent, scan.id, scan.companyId)
    } else if (scan.scanType === 'nmap') {
      parsedFindings = parseNmapFindings(fileContent, scan.id, scan.companyId)
    } else {
      console.log('🔍 PROCESS: Unknown scan type:', scan.scanType)
    }

    console.log('🔍 PROCESS: Total findings to insert:', parsedFindings.length)

    // Insert findings into database
    if (parsedFindings.length > 0) {
      await db
        .insert(findings)
        .values(parsedFindings)
      console.log('🔍 PROCESS: Inserted', parsedFindings.length, 'findings')
    }

    // Update scan status to completed
    await db
      .update(scans)
      .set({
        status: 'completed',
        processedAt: new Date()
      })
      .where(eq(scans.id, scan.id))

    console.log('🔍 PROCESS: Updated scan status to completed')

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Scan processed successfully',
        scanId: scan.id,
        findingsCount: parsedFindings.length,
        status: 'completed'
      })
    }

  } catch (error: any) {
    console.error('🔍🔍🔍 PROCESS: FATAL PROCESSING ERROR 🔍🔍🔍')
    console.error('🔍 PROCESS: Error name:', error.name)
    console.error('🔍 PROCESS: Error message:', error.message)
    console.error('🔍 PROCESS: Error stack:', error.stack)
    console.error('🔍 PROCESS: Full error object:', error)
    
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to process scan',
        message: error.message,
        stack: error.stack,
        errorName: error.name
      })
    }
  }
}