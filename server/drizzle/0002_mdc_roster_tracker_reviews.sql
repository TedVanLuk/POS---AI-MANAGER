CREATE TABLE "performance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"ratings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weaknesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opportunities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"threats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"assists" integer DEFAULT 0 NOT NULL,
	"employee_of_month" integer DEFAULT 0 NOT NULL,
	"training_completed" integer DEFAULT 0 NOT NULL,
	"cross_trained" integer DEFAULT 0 NOT NULL,
	"skill_level" text,
	"promotion_ready" boolean DEFAULT false NOT NULL,
	"manager_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"code" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"sales_comms" integer DEFAULT 0 NOT NULL,
	"lds" integer DEFAULT 0 NOT NULL,
	"po" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "facebook" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "id_type" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "id_number" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "id_photo_url" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "id_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "id_verified_by" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "week_pattern" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_entries" ADD CONSTRAINT "roster_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_stats" ADD CONSTRAINT "server_stats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_stats" ADD CONSTRAINT "server_stats_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_stats" ADD CONSTRAINT "server_stats_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_emp_date" ON "roster_entries" USING btree ("employee_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "server_stats_emp_date" ON "server_stats" USING btree ("employee_id","date");