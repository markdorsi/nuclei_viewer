import type { Handler } from '@netlify/functions'
import { getStore, connectLambda } from '@netlify/blobs'
import { db, scans, findings, assets, tenants, companies } from '../../db'
import { eq, and } from 'drizzle-orm'
import crypto from 'crypto'

const META_STORE_NAME = 'scans-meta'
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

// Parse nuclei JSON/JSONL results
function parseNucleiResults(content: string): any[] {
  const results = []
  const trimmedContent = content.trim()
  
  console.log(`🔍 PARSE: Processing scan file (${content.length} characters)`)
  console.log(`🔍 PARSE: First 100 characters:`, trimmedContent.substring(0, 100))
  
  // Check if it's a JSON array format (starts with '[')
  if (trimmedContent.startsWith('[') && trimmedContent.endsWith(']')) {
    console.log(`🔍 PARSE: Detected JSON array format`)
    try {
      const jsonArray = JSON.parse(trimmedContent)
      if (Array.isArray(jsonArray)) {
        console.log(`🔍 PARSE: Successfully parsed JSON array with ${jsonArray.length} items`)
        
        for (let i = 0; i < jsonArray.length; i++) {
          const result = jsonArray[i]
          
          // Log the structure of the first few results for debugging
          if (i < 3) {
            console.log(`🔍 PARSE: Item ${i + 1} structure:`, JSON.stringify(result, null, 2).substring(0, 500))
          }
          
          if (result && typeof result === 'object') {
            // Check for various nuclei result patterns
            const hasInfo = result.info && typeof result.info === 'object'
            const hasTemplate = result.template && typeof result.template === 'string'
            const hasTemplateId = result['template-id'] || result.template_id || result.templateId
            const hasHost = result.host || result.target
            const hasMatched = result.matched_at || result.matchedAt
            
            if (hasInfo || hasTemplate || hasTemplateId || hasHost || hasMatched) {
              results.push(result)
              if (i < 3) {
                console.log(`✅ PARSE: Accepted item ${i + 1} as valid nuclei result`)
              }
            } else {
              if (i < 3) {
                console.log(`❌ PARSE: Rejected item ${i + 1} - doesn't match nuclei patterns`)
                console.log(`❌ PARSE: Item keys:`, Object.keys(result))
              }
            }
          }
        }
        
        console.log(`🔍 PARSE: Found ${results.length} valid nuclei results out of ${jsonArray.length} items in JSON array`)
        return results
      }
    } catch (e) {
      console.log(`⚠️ PARSE: Failed to parse as JSON array:`, e.message)
    }
  }
  
  // Fallback to JSONL format (one JSON object per line)
  console.log(`🔍 PARSE: Falling back to JSONL format parsing`)
  const lines = content.split('\n').filter(line => line.trim())
  console.log(`🔍 PARSE: Processing ${lines.length} lines from scan file`)
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    try {
      const result = JSON.parse(line)
      
      // Log the structure of the first few results for debugging
      if (i < 3) {
        console.log(`🔍 PARSE: Line ${i + 1} structure:`, JSON.stringify(result, null, 2))
      }
      
      // More flexible parsing - accept any object that looks like a nuclei result
      if (result && typeof result === 'object') {
        // Check for various nuclei result patterns
        const hasInfo = result.info && typeof result.info === 'object'
        const hasTemplate = result.template && typeof result.template === 'string'
        const hasTemplateId = result['template-id'] || result.template_id || result.templateId
        const hasHost = result.host || result.target
        const hasMatched = result.matched_at || result.matchedAt
        
        if (hasInfo || hasTemplate || hasTemplateId || hasHost || hasMatched) {
          results.push(result)
          if (i < 3) {
            console.log(`✅ PARSE: Accepted line ${i + 1} as valid nuclei result`)
          }
        } else {
          if (i < 3) {
            console.log(`❌ PARSE: Rejected line ${i + 1} - doesn't match nuclei patterns`)
          }
        }
      }
    } catch (e) {
      console.log(`⚠️ PARSE: Skipping invalid JSON line ${i + 1}:`, line.substring(0, 200))
    }
  }
  
  console.log(`🔍 PARSE: Found ${results.length} valid nuclei results out of ${lines.length} lines`)
  return results
}

// Generate SLA due date based on severity
function generateSlaDueDate(severity: string, detectedAt: Date): Date {
  const sladays = {
    critical: 7,
    high: 30,
    medium: 60,
    low: 120,
    info: 120
  }
  
  const days = sladays[severity as keyof typeof sladays] || 120
  const dueDate = new Date(detectedAt)
  dueDate.setDate(dueDate.getDate() + days)
  return dueDate
}

export const handler: Handler = async (event, context) => {
  console.log('🔍 PROCESS: Scan processing request received')
  console.log('🔍 PROCESS: HTTP Method:', event.httpMethod)
  
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
    console.log('Tenant slug missing from path')
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Tenant parameter missing', debug: { path: event.path } })
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { scanId, scanKey } = body

    if (!scanId && !scanKey) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'scanId or scanKey is required' })
      }
    }

    console.log(`Processing scan: ${scanId || scanKey}`)

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

    let scanRecord: any = null
    let scanFileKey: string = scanKey

    if (scanId) {
      // Get scan record from database using scanId
      const [dbScan] = await db
        .select()
        .from(scans)
        .where(and(eq(scans.id, scanId), eq(scans.tenantId, tenant.id)))
        .limit(1)

      if (!dbScan) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Scan not found by scanId' })
        }
      }
      
      scanRecord = dbScan
      scanFileKey = dbScan.filePath
      console.log(`🔍 PROCESS: Found scan record by ID: ${scanRecord.fileName}, companyId: ${scanRecord.companyId}`)
    } else if (scanKey) {
      // Try to find scan record by scanKey (filePath or fileName)
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
        console.log(`🔍 PROCESS: Found scan record by filePath: ${scanRecord.fileName}, companyId: ${scanRecord.companyId}`)
      } else {
        // Try by fileName
        const fileName = scanKey.split('/').pop()
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
          console.log(`🔍 PROCESS: Found scan record by fileName: ${scanRecord.fileName}, companyId: ${scanRecord.companyId}`)
        } else {
          console.log(`🔍 PROCESS: No scan record found for scanKey: ${scanKey} or fileName: ${fileName}`)
        }
      }
      
      scanFileKey = scanKey
    }

    // Get scan file content from blob storage
    const scansStore = getStore(SCANS_STORE_NAME)
    const scanBlob = await scansStore.get(scanFileKey)
    
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
    console.log(`Processing scan file with ${scanContent.length} characters`)

    // Parse nuclei results
    const nucleiResults = parseNucleiResults(scanContent)
    console.log(`Parsed ${nucleiResults.length} nuclei results`)
    console.log('🔍 PROCESS: Sample result:', nucleiResults.length > 0 ? JSON.stringify(nucleiResults[0], null, 2) : 'No results')

    if (nucleiResults.length === 0) {
      // Update scan status to completed (no findings)
      if (scanRecord) {
        await db
          .update(scans)
          .set({ 
            status: 'completed',
            processedAt: new Date()
          })
          .where(eq(scans.id, scanRecord.id))
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Scan processed successfully',
          findingsCount: 0,
          assetsCount: 0
        })
      }
    }

    // Process findings and assets
    const processedAssets = new Map<string, string>() // hostname+ip -> assetId
    let findingsInserted = 0

    for (const result of nucleiResults) {
      try {
        // Extract target information with more flexible parsing
        const target = result.host || result.target || result.url || 'unknown'
        let hostname = target
        let ip = null

        console.log(`🔍 PROCESS: Processing target: ${target}`)

        // Try to separate hostname and IP
        if (target.includes('://')) {
          try {
            const url = new URL(target)
            hostname = url.hostname
            console.log(`🔍 PROCESS: Extracted hostname from URL: ${hostname}`)
          } catch (e) {
            console.log(`⚠️ PROCESS: Failed to parse URL: ${target}`)
            hostname = target
          }
        } else if (/^\d+\.\d+\.\d+\.\d+$/.test(target)) {
          ip = target
          hostname = null
          console.log(`🔍 PROCESS: Target is IP: ${ip}`)
        } else {
          hostname = target
          console.log(`🔍 PROCESS: Target is hostname: ${hostname}`)
        }

        // Create or get asset
        let assetId: string | null = null
        const assetKey = `${hostname || 'unknown'}:${ip || 'unknown'}`

        if (!processedAssets.has(assetKey)) {
          // Insert or get existing asset
          const assetWhereConditions = [
            eq(assets.tenantId, tenant.id),
            hostname ? eq(assets.hostname, hostname) : eq(assets.hostname, null),
            ip ? eq(assets.ip, ip) : eq(assets.ip, null)
          ]
          
          // Only add company condition if we have a company
          if (scanRecord?.companyId) {
            assetWhereConditions.push(eq(assets.companyId, scanRecord.companyId))
          }
          
          const [existingAsset] = await db
            .select()
            .from(assets)
            .where(and(...assetWhereConditions))
            .limit(1)

          if (existingAsset) {
            assetId = existingAsset.id
          } else if (scanRecord?.companyId) {
            const [newAsset] = await db
              .insert(assets)
              .values({
                tenantId: tenant.id,
                companyId: scanRecord.companyId,
                hostname,
                ip,
                assetType: 'web',
                metadata: { discoveredBy: 'nuclei' }
              })
              .returning({ id: assets.id })

            assetId = newAsset.id
          }

          processedAssets.set(assetKey, assetId || '')
        } else {
          assetId = processedAssets.get(assetKey) || null
        }

        // Generate dedupe key using the extracted template name
        const dedupeKey = crypto
          .createHash('md5')
          .update(`${tenantSlug}:${scanRecord?.companyId || 'unknown'}:${templateName}:${target}`)
          .digest('hex')

        // Extract finding information with flexible field mapping
        const severity = result.info?.severity || result.severity || 'info'
        const templateId = result.info?.id || result.template_id || result.templateId || result['template-id'] || result.template || 'unknown'
        const templateName = result.info?.name || result.template_name || result.templateName || result['template-name'] || templateId
        const detectedAt = new Date()
        const slaDueDate = generateSlaDueDate(severity, detectedAt)
        const slaTargetDays = {
          critical: 7,
          high: 30,
          medium: 60,
          low: 120,
          info: 120
        }[severity as keyof typeof slaTargetDays] || 120

        console.log(`🔍 PROCESS: Found - severity: ${severity}, template: ${templateName}, templateId: ${templateId}`)

        // Validate required fields before inserting finding
        if (!scanRecord?.companyId) {
          console.log(`⚠️ PROCESS: Skipping finding - no company associated with scan`)
          continue
        }

        if (!scanRecord?.id) {
          console.log(`⚠️ PROCESS: Skipping finding - no scan ID found`)
          continue
        }

        // Insert finding
        console.log(`🔍 PROCESS: Inserting finding - severity: ${severity}, template: ${templateName}, target: ${target}`)
        console.log(`🔍 PROCESS: Using companyId: ${scanRecord.companyId}, scanId: ${scanRecord.id}`)
        
        try {
          await db
            .insert(findings)
            .values({
              tenantId: tenant.id,
              companyId: scanRecord.companyId, // Now guaranteed to exist
              scanId: scanRecord.id, // Now guaranteed to exist
              assetId,
              dedupeKey,
              templateId,
              templateName,
              severity,
              name: templateName || 'Unknown Finding',
              description: result.info?.description || result.description,
              matcher: result.matcher?.name || result.matcher,
              extractedResults: result.extracted_results || result.extractedResults || result.extracted,
              metadata: {
                nuclei_info: result.info,
                curl_command: result.curl_command,
                matcher_status: result.matcher_status,
                matched_at: result.matched_at,
                raw_result: result
              },
              tags: result.info?.tags || result.tags || [],
              detectedAt,
              slaTargetDays,
              slaDueDate,
              slaStatus: 'within',
              currentStatus: 'detected'
            })
            .onConflictDoUpdate({
              target: [findings.dedupeKey],
              set: {
                lastSeen: new Date(),
                metadata: {
                  nuclei_info: result.info,
                  curl_command: result.curl_command,
                  matcher_status: result.matcher_status,
                  matched_at: result.matched_at
                }
              }
            })
          
          findingsInserted++
          console.log(`✅ PROCESS: Finding inserted successfully. Total findings: ${findingsInserted}`)
        } catch (insertError) {
          console.error('❌ PROCESS: Failed to insert finding:', insertError)
          console.error('❌ PROCESS: Finding data:', {
            tenantId: tenant.id,
            companyId: scanRecord?.companyId,
            scanId: scanRecord?.id,
            assetId,
            severity,
            templateName: result.info?.name || result.template
          })
          throw insertError
        }
      } catch (error) {
        console.error('Error processing finding:', error)
        console.error('Result causing error:', JSON.stringify(result, null, 2))
      }
    }

    // Update scan status to completed
    if (scanRecord) {
      await db
        .update(scans)
        .set({ 
          status: 'completed',
          processedAt: new Date()
        })
        .where(eq(scans.id, scanRecord.id))
    }

    console.log(`Scan processing completed: ${findingsInserted} findings, ${processedAssets.size} assets`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Scan processed successfully',
        findingsCount: findingsInserted,
        assetsCount: processedAssets.size
      })
    }

  } catch (error) {
    console.error('Scan processing error:', error)
    
    // Try to update scan status to failed if we have a scan record
    try {
      const body = JSON.parse(event.body || '{}')
      const { scanId } = body
      
      if (scanId) {
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.slug, tenantSlug))
          .limit(1)

        if (tenant) {
          await db
            .update(scans)
            .set({ status: 'failed' })
            .where(and(eq(scans.id, scanId), eq(scans.tenantId, tenant.id)))
        }
      }
    } catch (updateError) {
      console.error('Failed to update scan status:', updateError)
    }

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to process scan',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}