import type { Handler } from '@netlify/functions'
import { db, companies, scans, findings, tenants } from '../../db'
import { eq, like, inArray } from 'drizzle-orm'

export const handler: Handler = async (event, context) => {
  console.log('🧹 CLEANUP: Starting cleanup function')
  console.log('🧹 CLEANUP: Method:', event.httpMethod)
  console.log('🧹 CLEANUP: Query params:', event.queryStringParameters)

  try {
    const action = event.queryStringParameters?.action
    const tenantSlug = event.queryStringParameters?.tenant

    if (!tenantSlug) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing tenant parameter' })
      }
    }

    // Look up tenant by slug to get the ID
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantSlug))
      .limit(1)

    if (!tenant || tenant.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Tenant not found: ${tenantSlug}` })
      }
    }

    const tenantId = tenant[0].id

    if (action === 'list') {
      // List all companies and scans for inspection
      const allCompanies = await db
        .select()
        .from(companies)
        .where(eq(companies.tenantId, tenantId))

      const allScans = await db
        .select()
        .from(scans)
        .where(eq(scans.tenantId, tenantId))

      console.log('🧹 CLEANUP: Found companies:', allCompanies.length)
      console.log('🧹 CLEANUP: Found scans:', allScans.length)

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companies: allCompanies,
          scans: allScans,
          summary: {
            totalCompanies: allCompanies.length,
            totalScans: allScans.length,
            companiesByName: allCompanies.reduce((acc, company) => {
              acc[company.name] = (acc[company.name] || 0) + 1
              return acc
            }, {} as Record<string, number>)
          }
        })
      }
    }

    if (action === 'clean') {
      console.log('🧹 CLEANUP: Starting cleanup for tenant:', tenantId)

      // First, let's see what we have
      const allScans = await db
        .select()
        .from(scans)
        .where(eq(scans.tenantId, tenantId))

      const allCompanies = await db
        .select()
        .from(companies)
        .where(eq(companies.tenantId, tenantId))

      console.log('🧹 CLEANUP: Before cleanup - Scans:', allScans.length, 'Companies:', allCompanies.length)

      // Find chunk-related scans (files ending with .chunkXXX)
      const chunkScans = allScans.filter(scan => /\.chunk\d+$/.test(scan.fileName))
      console.log('🧹 CLEANUP: Found chunk scans:', chunkScans.length)

      // Find "Blob" companies and any scans associated with them
      const blobCompanies = allCompanies.filter(company => company.name === 'Blob')
      const blobScanIds = allScans.filter(scan => 
        blobCompanies.some(company => company.id === scan.companyId)
      ).map(scan => scan.id)
      
      // Also find scans with filename "blob" (these are misnamed chunks)
      const blobFilenameScans = allScans.filter(scan => scan.fileName === 'blob')
      const blobFilenameIds = blobFilenameScans.map(scan => scan.id)
      
      console.log('🧹 CLEANUP: Found Blob companies:', blobCompanies.length)
      console.log('🧹 CLEANUP: Found Blob scans by company:', blobScanIds.length)
      console.log('🧹 CLEANUP: Found scans with filename "blob":', blobFilenameIds.length)

      // Combine all scan IDs to delete (chunks + blob scans + blob filename scans)
      const allScansToDelete = [...chunkScans.map(scan => scan.id), ...blobScanIds, ...blobFilenameIds]
      
      // Delete findings for all scans to delete
      if (allScansToDelete.length > 0) {
        await db
          .delete(findings)
          .where(inArray(findings.scanId, allScansToDelete))
        console.log('🧹 CLEANUP: Deleted findings for', allScansToDelete.length, 'scans')
      }

      // Delete all chunk scans and blob scans
      if (allScansToDelete.length > 0) {
        await db
          .delete(scans)
          .where(inArray(scans.id, allScansToDelete))
        console.log('🧹 CLEANUP: Deleted', allScansToDelete.length, 'total scans (chunks + blob scans + blob filename scans)')
      }

      // Delete all Blob companies (they should have no scans now)
      if (blobCompanies.length > 0) {
        const blobCompanyIds = blobCompanies.map(company => company.id)
        await db
          .delete(companies)
          .where(inArray(companies.id, blobCompanyIds))
        console.log('🧹 CLEANUP: Deleted', blobCompanies.length, 'Blob companies')
      }

      // Get final counts
      const finalScans = await db
        .select()
        .from(scans)
        .where(eq(scans.tenantId, tenantId))

      const finalCompanies = await db
        .select()
        .from(companies)
        .where(eq(companies.tenantId, tenantId))

      console.log('🧹 CLEANUP: After cleanup - Scans:', finalScans.length, 'Companies:', finalCompanies.length)

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Cleanup completed',
          removed: {
            chunkScans: chunkScans.length,
            blobScans: blobScanIds.length,
            blobFilenameScans: blobFilenameIds.length,
            blobCompanies: blobCompanies.length,
            totalScans: allScansToDelete.length
          },
          remaining: {
            scans: finalScans.length,
            companies: finalCompanies.length
          }
        })
      }
    }

    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Invalid action. Use ?action=list or ?action=clean&tenant=TENANT_ID' 
      })
    }

  } catch (error: any) {
    console.error('🧹 CLEANUP: Error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Cleanup failed', 
        details: error.message 
      })
    }
  }
}