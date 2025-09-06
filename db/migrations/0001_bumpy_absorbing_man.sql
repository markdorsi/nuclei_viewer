ALTER TABLE "nuclei_db"."findings" ADD COLUMN "detected_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "triaged_at" timestamp;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "prioritized_at" timestamp;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "remediated_at" timestamp;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "validated_at" timestamp;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "sla_target_days" integer;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "sla_due_date" timestamp;--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "sla_status" text DEFAULT 'within';--> statement-breakpoint
ALTER TABLE "nuclei_db"."findings" ADD COLUMN "current_status" text DEFAULT 'detected';