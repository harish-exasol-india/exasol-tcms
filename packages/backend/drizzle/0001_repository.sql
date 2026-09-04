CREATE TABLE "case_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"actor_id" uuid,
	"origin" text NOT NULL,
	"action" text NOT NULL,
	"changed_fields" jsonb NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_step_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shared_step_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action" text NOT NULL,
	"expected" text
);
--> statement-breakpoint
CREATE TABLE "shared_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"action" text,
	"expected" text,
	"shared_step_id" uuid
);
--> statement-breakpoint
CREATE TABLE "case_tag" (
	"case_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"suite_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"owner_id" uuid,
	"priority" text DEFAULT 'medium' NOT NULL,
	"risk" text DEFAULT 'medium' NOT NULL,
	"preconditions" text,
	"is_automated" boolean DEFAULT false NOT NULL,
	"custom_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "case_history" ADD CONSTRAINT "case_history_case_id_test_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."test_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_history" ADD CONSTRAINT "case_history_actor_id_app_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definition" ADD CONSTRAINT "custom_field_definition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_step_item" ADD CONSTRAINT "shared_step_item_shared_step_id_shared_step_id_fk" FOREIGN KEY ("shared_step_id") REFERENCES "public"."shared_step"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_step" ADD CONSTRAINT "shared_step_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_step" ADD CONSTRAINT "case_step_case_id_test_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."test_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_tag" ADD CONSTRAINT "case_tag_case_id_test_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."test_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_tag" ADD CONSTRAINT "case_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suite" ADD CONSTRAINT "suite_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_suite_id_suite_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."suite"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_case" ADD CONSTRAINT "test_case_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_history_case_ix" ON "case_history" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_key_uq" ON "custom_field_definition" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_step_item_position_uq" ON "shared_step_item" USING btree ("shared_step_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_step_name_uq" ON "shared_step" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "case_step_position_uq" ON "case_step" USING btree ("case_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "case_tag_pk" ON "case_tag" USING btree ("case_id","tag_id");--> statement-breakpoint
CREATE INDEX "case_tag_tag_ix" ON "case_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "suite_project_parent_ix" ON "suite" USING btree ("project_id","parent_id");--> statement-breakpoint
CREATE INDEX "suite_parent_ix" ON "suite" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_project_name_uq" ON "tag" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "test_case_ref_uq" ON "test_case" USING btree ("project_id","ref");--> statement-breakpoint
CREATE INDEX "test_case_suite_ix" ON "test_case" USING btree ("suite_id");--> statement-breakpoint
CREATE INDEX "test_case_project_automated_ix" ON "test_case" USING btree ("project_id","is_automated");