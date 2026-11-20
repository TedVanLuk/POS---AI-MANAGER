CREATE TABLE "mgmt_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reviewer_role_key" text,
	"reviewer_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"category" integer NOT NULL,
	"suggested_category" integer,
	"results_index" numeric(5, 3),
	"result" text DEFAULT '' NOT NULL,
	"analysis" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mgmt_reviews" ADD CONSTRAINT "mgmt_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mgmt_reviews" ADD CONSTRAINT "mgmt_reviews_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mgmt_reviews" ADD CONSTRAINT "mgmt_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mgmt_reviews_tenant_date" ON "mgmt_reviews" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "mgmt_reviews_employee" ON "mgmt_reviews" USING btree ("employee_id","date");