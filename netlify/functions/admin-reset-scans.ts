import type { Handler } from '@netlify/functions'
import { db, scans, tenants } from '../../db'
import { eq, and } from 'drizzle-orm'

// Emergency utility to reset stuck scans
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
    const { tenantSlug, adminKey } = body

    // Simple admin check
    if (adminKey !== 'reset-stuck-scans-emergency-2024') {
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Forbidden' })
      }
    }

    if (!tenantSlug) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'tenantSlug is required' })
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

    // Reset all stuck processing scans to pending
    const result = await db
      .update(scans)
      .set({ 
        status: 'pending',
        processedAt: null
      })
      .where(and(
        eq(scans.tenantId, tenant.id),
        eq(scans.status, 'processing')
      ))
      .returning({ id: scans.id, fileName: scans.fileName })

    console.log(`Reset ${result.length} stuck scans for tenant ${tenantSlug}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Reset ${result.length} stuck scans`,
        resetScans: result
      })
    }

  } catch (error) {
    console.error('Admin reset error:', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to reset scans',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}