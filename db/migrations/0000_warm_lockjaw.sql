CREATE SCHEMA "nuclei_db";
--> statement-breakpoint
CREATE TABLE "nuclei_db"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"hostname" text,
	"ip" text,
	"asset_type" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assets_tenant_id_company_id_hostname_ip_unique" UNIQUE("tenant_id","company_id","hostname","ip")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"resource" text,
	"resource_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_tenant_id_slug_unique" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."external_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"status" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_issues_tenant_id_finding_id_provider_unique" UNIQUE("tenant_id","finding_id","provider")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"asset_id" uuid,
	"dedupe_key" text NOT NULL,
	"template_id" text,
	"template_name" text,
	"severity" text,
	"name" text NOT NULL,
	"description" text,
	"matcher" text,
	"extracted_results" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"tags" text[],
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"resolved" boolean DEFAULT false,
	"resolved_at" timestamp,
	CONSTRAINT "findings_tenant_id_company_id_dedupe_key_unique" UNIQUE("tenant_id","company_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_user_id_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"scan_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"port" integer NOT NULL,
	"protocol" text NOT NULL,
	"state" text,
	"service" text,
	"version" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ports_tenant_id_asset_id_port_protocol_unique" UNIQUE("tenant_id","asset_id","port","protocol")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"scan_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"scan_date" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."tenant_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_integrations_tenant_id_provider_unique" UNIQUE("tenant_id","provider")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"google_domain" text,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."user_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"token_metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_integrations_tenant_id_user_id_provider_unique" UNIQUE("tenant_id","user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "nuclei_db"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"avatar" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "nuclei_db"."assets" ADD CONSTRAINT "assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."assets" ADD CONSTRAINT "assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "nuclei_db"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "nuclei_db"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."external_issues" ADD CONSTRAINT "external_issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."external_issues" ADD CONSTRAINT "external_issues_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "nuclei_db"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD CONSTRAINT "findings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD CONSTRAINT "findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "nuclei_db"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD CONSTRAINT "findings_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "nuclei_db"."scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD CONSTRAINT "findings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "nuclei_db"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "nuclei_db"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."ports" ADD CONSTRAINT "ports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."ports" ADD CONSTRAINT "ports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "nuclei_db"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."ports" ADD CONSTRAINT "ports_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "nuclei_db"."scans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."ports" ADD CONSTRAINT "ports_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "nuclei_db"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."scans" ADD CONSTRAINT "scans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."scans" ADD CONSTRAINT "scans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "nuclei_db"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."user_integrations" ADD CONSTRAINT "user_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "nuclei_db"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nuclei_db"."user_integrations" ADD CONSTRAINT "user_integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "nuclei_db"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_tenant_id_index" ON "nuclei_db"."assets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "assets_company_id_index" ON "nuclei_db"."assets" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_id_index" ON "nuclei_db"."audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_index" ON "nuclei_db"."audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_index" ON "nuclei_db"."audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_index" ON "nuclei_db"."audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "companies_tenant_id_index" ON "nuclei_db"."companies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "external_issues_tenant_id_index" ON "nuclei_db"."external_issues" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "external_issues_finding_id_index" ON "nuclei_db"."external_issues" USING btree ("finding_id");--> statement-breakpoint
CREATE INDEX "external_issues_provider_external_id_index" ON "nuclei_db"."external_issues" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "findings_tenant_id_index" ON "nuclei_db"."findings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "findings_company_id_index" ON "nuclei_db"."findings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "findings_scan_id_index" ON "nuclei_db"."findings" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "findings_severity_index" ON "nuclei_db"."findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "findings_dedupe_key_index" ON "nuclei_db"."findings" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "memberships_tenant_id_index" ON "nuclei_db"."memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_index" ON "nuclei_db"."memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ports_tenant_id_index" ON "nuclei_db"."ports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ports_company_id_index" ON "nuclei_db"."ports" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ports_asset_id_index" ON "nuclei_db"."ports" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "scans_tenant_id_index" ON "nuclei_db"."scans" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "scans_company_id_index" ON "nuclei_db"."scans" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "scans_status_index" ON "nuclei_db"."scans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenant_integrations_tenant_id_index" ON "nuclei_db"."tenant_integrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_integrations_tenant_id_index" ON "nuclei_db"."user_integrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_integrations_user_id_index" ON "nuclei_db"."user_integrations" USING btree ("user_id");