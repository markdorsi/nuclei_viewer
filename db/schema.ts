import { pgTable, pgSchema, text, timestamp, uuid, boolean, integer, jsonb, unique, index, primaryKey, varchar } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const nucleiDb = pgSchema('nuclei_db')

export const tenants = nucleiDb.table('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  googleDomain: text('google_domain'),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

export const users = nucleiDb.table('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  googleId: text('google_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatar: text('avatar'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

export const memberships = nucleiDb.table('memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role', { enum: ['owner', 'admin', 'analyst', 'uploader', 'viewer'] }).notNull().default('viewer'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  unique: unique().on(table.tenantId, table.userId),
  tenantIdx: index().on(table.tenantId),
  userIdx: index().on(table.userId)
}))

export const companies = nucleiDb.table('companies', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  unique: unique().on(table.tenantId, table.slug),
  tenantIdx: index().on(table.tenantId)
}))

export const scans = nucleiDb.table('scans', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  scanType: text('scan_type', { enum: ['nuclei', 'nmap'] }).notNull(),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  scanDate: timestamp('scan_date').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'completed', 'failed'] }).notNull().default('pending'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at')
}, (table) => ({
  tenantIdx: index().on(table.tenantId),
  companyIdx: index().on(table.companyId),
  statusIdx: index().on(table.status)
}))

export const assets = nucleiDb.table('assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  hostname: text('hostname'),
  ip: text('ip'),
  assetType: text('asset_type'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  unique: unique().on(table.tenantId, table.companyId, table.hostname, table.ip),
  tenantIdx: index().on(table.tenantId),
  companyIdx: index().on(table.companyId)
}))

export const findings = nucleiDb.table('findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  scanId: uuid('scan_id').notNull().references(() => scans.id),
  assetId: uuid('asset_id').references(() => assets.id),
  dedupeKey: text('dedupe_key').notNull(),
  templateId: text('template_id'),
  templateName: text('template_name'),
  severity: text('severity', { enum: ['info', 'low', 'medium', 'high', 'critical'] }),
  name: text('name').notNull(),
  description: text('description'),
  matcher: text('matcher'),
  extractedResults: jsonb('extracted_results'),
  metadata: jsonb('metadata').default({}),
  tags: text('tags').array(),
  firstSeen: timestamp('first_seen').defaultNow().notNull(),
  lastSeen: timestamp('last_seen').defaultNow().notNull(),
  resolved: boolean('resolved').default(false),
  resolvedAt: timestamp('resolved_at')
}, (table) => ({
  unique: unique().on(table.tenantId, table.companyId, table.dedupeKey),
  tenantIdx: index().on(table.tenantId),
  companyIdx: index().on(table.companyId),
  scanIdx: index().on(table.scanId),
  severityIdx: index().on(table.severity),
  dedupeIdx: index().on(table.dedupeKey)
}))

export const ports = nucleiDb.table('ports', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  scanId: uuid('scan_id').notNull().references(() => scans.id),
  assetId: uuid('asset_id').notNull().references(() => assets.id),
  port: integer('port').notNull(),
  protocol: text('protocol', { enum: ['tcp', 'udp'] }).notNull(),
  state: text('state'),
  service: text('service'),
  version: text('version'),
  metadata: jsonb('metadata').default({}),
  firstSeen: timestamp('first_seen').defaultNow().notNull(),
  lastSeen: timestamp('last_seen').defaultNow().notNull()
}, (table) => ({
  unique: unique().on(table.tenantId, table.assetId, table.port, table.protocol),
  tenantIdx: index().on(table.tenantId),
  companyIdx: index().on(table.companyId),
  assetIdx: index().on(table.assetId)
}))

export const tenantIntegrations = nucleiDb.table('tenant_integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  provider: text('provider', { enum: ['linear', 'jira'] }).notNull(),
  config: jsonb('config').notNull(),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  unique: unique().on(table.tenantId, table.provider),
  tenantIdx: index().on(table.tenantId)
}))

export const userIntegrations = nucleiDb.table('user_integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  provider: text('provider', { enum: ['linear', 'jira'] }).notNull(),
  encryptedToken: text('encrypted_token').notNull(),
  tokenMetadata: jsonb('token_metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  unique: unique().on(table.tenantId, table.userId, table.provider),
  tenantIdx: index().on(table.tenantId),
  userIdx: index().on(table.userId)
}))

export const externalIssues = nucleiDb.table('external_issues', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  findingId: uuid('finding_id').notNull().references(() => findings.id),
  provider: text('provider', { enum: ['linear', 'jira'] }).notNull(),
  externalId: text('external_id').notNull(),
  externalUrl: text('external_url'),
  status: text('status'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  unique: unique().on(table.tenantId, table.findingId, table.provider),
  tenantIdx: index().on(table.tenantId),
  findingIdx: index().on(table.findingId),
  externalIdx: index().on(table.provider, table.externalId)
}))

export const auditLogs = nucleiDb.table('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  resource: text('resource'),
  resourceId: uuid('resource_id'),
  metadata: jsonb('metadata').default({}),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull()
}, (table) => ({
  tenantIdx: index().on(table.tenantId),
  userIdx: index().on(table.userId),
  actionIdx: index().on(table.action),
  createdIdx: index().on(table.createdAt)
}))

// Relations
export const tenantsRelations = relations(tenants, ({ many }) => ({
  memberships: many(memberships),
  companies: many(companies),
  scans: many(scans),
  findings: many(findings),
  tenantIntegrations: many(tenantIntegrations),
  auditLogs: many(auditLogs)
}))

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  userIntegrations: many(userIntegrations),
  auditLogs: many(auditLogs)
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
  tenant: one(tenants, {
    fields: [memberships.tenantId],
    references: [tenants.id]
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id]
  })
}))

export const companiesRelations = relations(companies, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [companies.tenantId],
    references: [tenants.id]
  }),
  scans: many(scans),
  assets: many(assets),
  findings: many(findings)
}))

export const scansRelations = relations(scans, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [scans.tenantId],
    references: [tenants.id]
  }),
  company: one(companies, {
    fields: [scans.companyId],
    references: [companies.id]
  }),
  findings: many(findings)
}))

export const findingsRelations = relations(findings, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [findings.tenantId],
    references: [tenants.id]
  }),
  company: one(companies, {
    fields: [findings.companyId],
    references: [companies.id]
  }),
  scan: one(scans, {
    fields: [findings.scanId],
    references: [scans.id]
  }),
  asset: one(assets, {
    fields: [findings.assetId],
    references: [assets.id]
  }),
  externalIssues: many(externalIssues)
}))