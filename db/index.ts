import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import * as dotenv from 'dotenv'

dotenv.config()

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true, // Neon requires SSL
  max: 1, // Serverless functions work better with fewer connections
  idleTimeoutMillis: 0,
  connectionTimeoutMillis: 10000
})

export const db = drizzle(pool, { schema })

export * from './schema'