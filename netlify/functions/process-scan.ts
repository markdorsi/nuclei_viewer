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
  const lines = content.split('\n').filter(line => line.trim())
  
  for (const line of lines) {
    try {
      const result = JSON.parse(line)
      if (result && (result.info || result.template)) {
        results.push(result)
      }
    } catch (e) {
      console.log('Skipping invalid JSON line:', line.substring(0, 100))
    }
  }
  
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
      // Get scan record from database
      const [dbScan] = await db
        .select()
        .from(scans)
        .where(and(eq(scans.id, scanId), eq(scans.tenantId, tenant.id)))
        .limit(1)

      if (!dbScan) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Scan not found' })
        }
      }
      
      scanRecord = dbScan
      scanFileKey = dbScan.filePath
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
        // Extract target information
        const target = result.host || result.target || 'unknown'
        let hostname = target
        let ip = null

        // Try to separate hostname and IP
        if (target.includes('://')) {
          const url = new URL(target)
          hostname = url.hostname
        } else if (/^\d+\.\d+\.\d+\.\d+$/.test(target)) {
          ip = target
          hostname = null
        } else {
          hostname = target
        }

        // Create or get asset
        let assetId: string | null = null
        const assetKey = `${hostname || 'unknown'}:${ip || 'unknown'}`

        if (!processedAssets.has(assetKey)) {
          // Insert or get existing asset
          const [existingAsset] = await db
            .select()
            .from(assets)
            .where(and(
              eq(assets.tenantId, tenant.id),
              eq(assets.companyId, scanRecord?.companyId || ''),
              hostname ? eq(assets.hostname, hostname) : eq(assets.hostname, null),
              ip ? eq(assets.ip, ip) : eq(assets.ip, null)
            ))
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

        // Generate dedupe key
        const dedupeKey = crypto
          .createHash('md5')
          .update(`${tenantSlug}:${scanRecord?.companyId || 'unknown'}:${result.info?.name || result.template}:${target}`)
          .digest('hex')

        // Extract finding information
        const severity = result.info?.severity || 'info'
        const detectedAt = new Date()
        const slaDueDate = generateSlaDueDate(severity, detectedAt)
        const slaTargetDays = {
          critical: 7,
          high: 30,
          medium: 60,
          low: 120,
          info: 120
        }[severity as keyof typeof slaTargetDays] || 120

        // Insert finding
        console.log(`🔍 PROCESS: Inserting finding - severity: ${severity}, template: ${result.info?.name || result.template}, target: ${target}`)
        try {
          await db
            .insert(findings)
            .values({
              tenantId: tenant.id,
              companyId: scanRecord?.companyId || null,
              scanId: scanRecord?.id || null,
              assetId,
              dedupeKey,
              templateId: result.info?.id || result.template,
              templateName: result.info?.name || result.template,
              severity,
              name: result.info?.name || result.template || 'Unknown Finding',
              description: result.info?.description,
              matcher: result.matcher?.name,
              extractedResults: result.extracted_results || result.extractedResults,
              metadata: {
                nuclei_info: result.info,
                curl_command: result.curl_command,
                matcher_status: result.matcher_status,
                matched_at: result.matched_at
              },
              tags: result.info?.tags || [],
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