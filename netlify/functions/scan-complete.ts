import type { Handler } from '@netlify/functions'
import jwt from 'jsonwebtoken'
import { getStore, connectLambda } from '@netlify/blobs'
import crypto from 'crypto'
import { db, scans, tenants, companies } from '../../db'
import { eq, and } from 'drizzle-orm'

// Extract tenant from URL path
function getTenantFromPath(event: any) {
  // Try to get tenant from path like /api/t/tenantSlug/scans/complete
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
  console.log('=== SCAN COMPLETE ===')
  
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
    const { uploadId } = body

    if (!uploadId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'uploadId is required' })
      }
    }

    console.log(`Completing upload ${uploadId}`)

    // Get session from Netlify Blobs
    const sessionsStore = getStore('uploads-sessions')
    
    const sessionDataText = await sessionsStore.get(`${uploadId}.json`)
    const sessionData = sessionDataText ? JSON.parse(sessionDataText) : null
    
    if (!sessionData) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Upload session not found' })
      }
    }

    // Verify ownership
    if (sessionData.tenantSlug !== tenantSlug) {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Forbidden' })
      }
    }

    // Check if already completed (idempotency)
    if (sessionData.status === 'complete') {
      console.log('Upload already completed')
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      }
    }

    // Verify all bytes received (allow small tolerance for encoding differences)
    const byteDifference = Math.abs(sessionData.receivedBytes - sessionData.expectedBytes);
    const tolerance = Math.max(10, Math.floor(sessionData.expectedBytes * 0.01)); // 1% or 10 bytes, whichever is larger
    
    if (byteDifference > tolerance) {
      console.log(`Byte mismatch beyond tolerance: received=${sessionData.receivedBytes}, expected=${sessionData.expectedBytes}, difference=${byteDifference}, tolerance=${tolerance}`);
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Incomplete upload - significant byte mismatch',
          receivedBytes: sessionData.receivedBytes,
          expectedBytes: sessionData.expectedBytes,
          difference: byteDifference,
          tolerance
        })
      }
    }
    
    if (byteDifference > 0) {
      console.log(`Minor byte difference accepted: received=${sessionData.receivedBytes}, expected=${sessionData.expectedBytes}, difference=${byteDifference}`);
    }

    // Optional: Verify overall SHA-256 if provided
    if (sessionData.overallSha256) {
      const scansStore = getStore('scans')
      
      const blob = await scansStore.get(sessionData.key)
      if (blob) {
        const buffer = Buffer.from(await blob.arrayBuffer())
        const actualHash = crypto.createHash('sha256').update(buffer).digest('hex')
        
        if (actualHash !== sessionData.overallSha256) {
          return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              error: 'File hash mismatch',
              expected: sessionData.overallSha256,
              actual: actualHash
            })
          }
        }
      }
    }

    // Write metadata record
    const metaStore = getStore('scans-meta')
    
    const metadataKey = `records/${sessionData.tenantSlug}/${sessionData.key}.json`
    const metadata = {
      tenantSlug: sessionData.tenantSlug,
      key: sessionData.key,
      size: sessionData.receivedBytes,
      contentType: sessionData.contentType,
      originalName: sessionData.originalName,
      createdAt: sessionData.createdAt,
      completedAt: new Date().toISOString(),
      overallSha256: sessionData.overallSha256 || null,
      chunks: sessionData.chunks.length,
      uploadId: uploadId,
      userId: null, // User info not available in tenant-aware routing
      email: null,
      companyId: sessionData.companyId || null,
      companyName: null // Will be populated by scan-list when needed
    }
    
    await metaStore.set(metadataKey, JSON.stringify(metadata))

    // Create database scan record if company is associated
    let scanId: string | null = null
    if (sessionData.companyId) {
      try {
        // Get tenant from database
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.slug, sessionData.tenantSlug))
          .limit(1)

        if (tenant) {
          // Verify company exists and belongs to tenant
          const [company] = await db
            .select()
            .from(companies)
            .where(and(eq(companies.id, sessionData.companyId), eq(companies.tenantId, tenant.id)))
            .limit(1)

          if (company) {
            // Determine scan type from file extension
            const fileName = sessionData.originalName.toLowerCase()
            let scanType = 'nuclei'
            if (fileName.includes('nmap') || fileName.includes('xml')) {
              scanType = 'nmap'
            } else if (fileName.includes('masscan')) {
              scanType = 'masscan'
            }

            // Create scan record
            const [newScan] = await db
              .insert(scans)
              .values({
                tenantId: tenant.id,
                companyId: sessionData.companyId,
                scanType,
                fileName: sessionData.originalName,
                filePath: sessionData.key,
                scanDate: new Date(sessionData.createdAt),
                status: 'pending',
                metadata: {
                  uploadId,
                  size: sessionData.receivedBytes,
                  contentType: sessionData.contentType,
                  overallSha256: sessionData.overallSha256
                }
              })
              .returning({ id: scans.id })

            scanId = newScan.id
            console.log(`✅ Created scan record: ${scanId}`)

            // Update scan status to processing and trigger automatic processing
            await db
              .update(scans)
              .set({ status: 'processing' })
              .where(eq(scans.id, scanId))

            // Trigger automatic processing with better error handling
            const baseUrl = process.env.URL || `https://${process.env.SITE_NAME || 'scanvault'}.netlify.app`
            const processUrl = `${baseUrl}/api/t/${sessionData.tenantSlug}/scans/process`
            
            console.log(`🚀 Triggering automatic processing: ${processUrl}`)
            
            try {
              const processResponse = await fetch(processUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  scanId
                }),
                signal: AbortSignal.timeout(30000) // 30 second timeout
              })

              if (processResponse.ok) {
                const processResult = await processResponse.json()
                console.log(`✅ Automatic processing triggered successfully:`, processResult)
              } else {
                const errorText = await processResponse.text()
                console.error(`❌ Processing trigger failed with status ${processResponse.status}:`, errorText)
                
                // Update scan status to failed
                await db.update(scans)
                  .set({ status: 'failed' })
                  .where(eq(scans.id, scanId))
              }
            } catch (error) {
              console.error('❌ Failed to trigger scan processing:', error)
              
              // Update scan status to failed
              await db.update(scans)
                .set({ status: 'failed' })
                .where(eq(scans.id, scanId))
            }

            console.log(`🚀 Triggered automatic processing for scan: ${scanId}`)
          } else {
            console.warn(`Company ${sessionData.companyId} not found for tenant ${sessionData.tenantSlug}`)
          }
        } else {
          console.warn(`Tenant ${sessionData.tenantSlug} not found`)
        }
      } catch (dbError) {
        console.error('Error creating scan database record:', dbError)
        // Continue anyway - the file upload was successful
      }
    }

    // Update session status
    sessionData.status = 'complete'
    sessionData.completedAt = new Date().toISOString()
    sessionData.scanId = scanId || undefined
    await sessionsStore.set(`${uploadId}.json`, JSON.stringify(sessionData))

    console.log(`Upload ${uploadId} completed successfully`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ok: true,
        key: sessionData.key,
        size: sessionData.receivedBytes,
        chunks: sessionData.chunks.length
      })
    }
  } catch (error) {
    console.error('Complete upload error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to complete upload',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}