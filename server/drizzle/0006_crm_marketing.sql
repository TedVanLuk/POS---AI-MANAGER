CREATE TABLE "crm_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"channel" text DEFAULT 'sms' NOT NULL,
	"days" integer DEFAULT 0 NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template" text NOT NULL,
	"bonus_points" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'sms' NOT NULL,
	"template" text NOT NULL,
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"holdout_pct" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp with time zone,
	"holdout_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attribution_days" integer DEFAULT 14 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"granted" boolean NOT NULL,
	"source" text NOT NULL,
	"text_version" text,
	"text" text,
	"actor_user_id" uuid,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"first_name" text DEFAULT '' NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"phone" text,
	"email" text,
	"birthday" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"referred_by_employee_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"erased_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"campaign_id" uuid,
	"automation_key" text,
	"channel" text NOT NULL,
	"purpose" text NOT NULL,
	"to" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"error" text,
	"parts" integer DEFAULT 1 NOT NULL,
	"cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"visit_id" uuid,
	"kind" text NOT NULL,
	"points" integer NOT NULL,
	"reward_key" text,
	"note" text,
	"date" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid,
	"date" date NOT NULL,
	"arrival_time" text,
	"party_size" integer DEFAULT 2 NOT NULL,
	"table_area" text,
	"min_spend" numeric(14, 2) DEFAULT 0 NOT NULL,
	"deposit" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"host_employee_id" uuid,
	"promoter_employee_id" uuid,
	"notes" text,
	"actual_spend" numeric(14, 2),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"branch_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"external_ref" text,
	"reservation_id" uuid,
	"order_slip_id" uuid,
	"server_employee_id" uuid,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_automations" ADD CONSTRAINT "crm_automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_consent_events" ADD CONSTRAINT "crm_consent_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_consent_events" ADD CONSTRAINT "crm_consent_events_customer_id_crm_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_consent_events" ADD CONSTRAINT "crm_consent_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_referred_by_employee_id_employees_id_fk" FOREIGN KEY ("referred_by_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_customer_id_crm_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_campaign_id_crm_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."crm_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_points" ADD CONSTRAINT "crm_points_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_points" ADD CONSTRAINT "crm_points_customer_id_crm_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_points" ADD CONSTRAINT "crm_points_visit_id_crm_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."crm_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_points" ADD CONSTRAINT "crm_points_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reservations" ADD CONSTRAINT "crm_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reservations" ADD CONSTRAINT "crm_reservations_customer_id_crm_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reservations" ADD CONSTRAINT "crm_reservations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reservations" ADD CONSTRAINT "crm_reservations_host_employee_id_employees_id_fk" FOREIGN KEY ("host_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reservations" ADD CONSTRAINT "crm_reservations_promoter_employee_id_employees_id_fk" FOREIGN KEY ("promoter_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_reservations" ADD CONSTRAINT "crm_reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_visits" ADD CONSTRAINT "crm_visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_visits" ADD CONSTRAINT "crm_visits_customer_id_crm_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."crm_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_visits" ADD CONSTRAINT "crm_visits_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_visits" ADD CONSTRAINT "crm_visits_order_slip_id_order_slips_id_fk" FOREIGN KEY ("order_slip_id") REFERENCES "public"."order_slips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_visits" ADD CONSTRAINT "crm_visits_server_employee_id_employees_id_fk" FOREIGN KEY ("server_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_visits" ADD CONSTRAINT "crm_visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_automations_key" ON "crm_automations" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "crm_consent_customer" ON "crm_consent_events" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_customers_phone" ON "crm_customers" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE INDEX "crm_customers_tenant" ON "crm_customers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "crm_messages_tenant" ON "crm_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_messages_customer" ON "crm_messages" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "crm_points_customer" ON "crm_points" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "crm_reservations_date" ON "crm_reservations" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_visits_ref" ON "crm_visits" USING btree ("tenant_id","source","external_ref");--> statement-breakpoint
CREATE INDEX "crm_visits_customer" ON "crm_visits" USING btree ("customer_id","date");--> statement-breakpoint
CREATE INDEX "crm_visits_tenant_date" ON "crm_visits" USING btree ("tenant_id","date");