import type { Handler } from '@netlify/functions'
import { db, tenants } from '../../db'
import { eq } from 'drizzle-orm'

export const handler: Handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    console.log('Bootstrap: Creating default tenant...')
    
    // Create the cloudsecurityprogram tenant
    const [tenant] = await db
      .insert(tenants)
      .values({
        name: 'Cloud Security Program',
        slug: 'cloudsecurityprogram',
        googleDomain: 'example.com' // placeholder domain
      })
      .onConflictDoNothing()
      .returning()
    
    console.log('Bootstrap: Created tenant:', tenant)
    
    // Check if tenant already existed
    if (!tenant) {
      const existingTenant = await db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, 'cloudsecurityprogram'))
        .limit(1)
      
      if (existingTenant.length > 0) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: 'Tenant already exists',
            tenant: existingTenant[0]
          })
        }
      }
    }
    
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Bootstrap completed successfully',
        tenant: tenant
      })
    }
  } catch (error) {
    console.error('Bootstrap error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Bootstrap failed', details: error.message })
    }
  }
}