import type { Handler } from '@netlify/functions'
import { db, findings, tenants, scans } from '../../db'
import { eq, and } from 'drizzle-orm'
import crypto from 'crypto'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { 
      statusCode: 405, 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }) 
    }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { tenantSlug, scanKey, testKey } = body

    if (testKey !== 'test-finding-insert-123') {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid test key' })
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

    // Find scan by key
    const fileName = scanKey.split('/').pop()
    const [scanRecord] = await db
      .select()
      .from(scans)
      .where(and(
        eq(scans.tenantId, tenant.id),
        eq(scans.fileName, fileName)
      ))
      .limit(1)

    if (!scanRecord) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Scan not found' })
      }
    }

    console.log('TEST: Scan record found:', {
      id: scanRecord.id,
      companyId: scanRecord.companyId,
      fileName: scanRecord.fileName,
      tenantId: scanRecord.tenantId,
      status: scanRecord.status
    })

    // Verify the scan record references are valid
    const [tenantCheck] = await db.select().from(tenants).where(eq(tenants.id, scanRecord.tenantId)).limit(1)
    console.log('TEST: Tenant exists:', !!tenantCheck)
    
    // Check if there are any existing findings for this scan
    const existingFindings = await db.select().from(findings).where(eq(findings.scanId, scanRecord.id)).limit(5)
    console.log('TEST: Existing findings count:', existingFindings.length)

    // Validate required fields
    if (!scanRecord.companyId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Scan has no company ID' })
      }
    }

    // Try to insert a test finding
    const dedupeKey = crypto
      .createHash('md5')
      .update(`test-${tenant.id}-${scanRecord.companyId}-${Date.now()}`)
      .digest('hex')

    const testFinding = {
      tenantId: tenant.id,
      companyId: scanRecord.companyId,
      scanId: scanRecord.id,
      assetId: null,
      dedupeKey,
      templateId: 'test-template',
      templateName: 'Test Finding',
      severity: 'info' as const,
      name: 'Test Finding',
      description: 'Test finding for debugging',
      detectedAt: new Date(),
      slaTargetDays: 120,
      slaDueDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
      slaStatus: 'within' as const,
      currentStatus: 'detected' as const
    }

    console.log('TEST: Attempting to insert finding with data:', testFinding)

    const [insertedFinding] = await db
      .insert(findings)
      .values(testFinding)
      .returning({ id: findings.id })

    console.log('TEST: Finding inserted successfully with ID:', insertedFinding.id)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Test finding inserted successfully',
        scanRecord: {
          id: scanRecord.id,
          companyId: scanRecord.companyId,
          fileName: scanRecord.fileName
        },
        findingId: insertedFinding.id,
        testData: testFinding
      })
    }

  } catch (error) {
    console.error('TEST: Error inserting test finding:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Test finding insertion failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      })
    }
  }
}