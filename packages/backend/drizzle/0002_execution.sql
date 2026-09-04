CREATE TABLE "automation_binding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"fq_name" text NOT NULL,
	"method" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"promoted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unbound_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"fq_name" text NOT NULL,
	"outcome" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_case_id" uuid,
	"step_position" bigint,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defect_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_case_id" uuid NOT NULL,
	"step_position" bigint,
	"issue_key" text NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"signature" text NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"note" text,
	"updated_by" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_result" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_case_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"duration_ms" bigint,
	"failure_message" text,
	"failure_signature" text,
	"triage_state" text,
	"recorded_by" uuid,
	"origin" text NOT NULL,
	CONSTRAINT "case_result_id_executed_at_pk" PRIMARY KEY("id","executed_at")
);
--> statement-breakpoint
CREATE TABLE "run_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"assignee_id" uuid,
	"outcome" text DEFAULT 'untested' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"plan_id" uuid,
	"environment_id" uuid,
	"release_id" uuid,
	"name" text NOT NULL,
	"kind" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"commit_sha" text,
	"branch" text,
	"created_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "step_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_case_id" uuid NOT NULL,
	"step_position" integer NOT NULL,
	"outcome" text NOT NULL,
	"comment" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "release_sign_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_id" uuid NOT NULL,
	"name" text NOT NULL,
	"approver_id" uuid,
	"completed_by" uuid,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"target_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_plan_case" (
	"plan_id" uuid NOT NULL,
	"case_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_binding" ADD CONSTRAINT "automation_binding_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_binding" ADD CONSTRAINT "automation_binding_case_id_test_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."test_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unbound_result" ADD CONSTRAINT "unbound_result_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_run_case_id_run_case_id_fk" FOREIGN KEY ("run_case_id") REFERENCES "public"."run_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_link" ADD CONSTRAINT "defect_link_run_case_id_run_case_id_fk" FOREIGN KEY ("run_case_id") REFERENCES "public"."run_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_link" ADD CONSTRAINT "defect_link_linked_by_app_user_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_triage" ADD CONSTRAINT "failure_triage_case_id_test_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."test_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_triage" ADD CONSTRAINT "failure_triage_updated_by_app_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_case" ADD CONSTRAINT "run_case_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_case" ADD CONSTRAINT "run_case_case_id_test_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."test_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_case" ADD CONSTRAINT "run_case_assignee_id_app_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_plan_id_test_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."test_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_environment_id_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_result" ADD CONSTRAINT "step_result_run_case_id_run_case_id_fk" FOREIGN KEY ("run_case_id") REFERENCES "public"."run_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_result" ADD CONSTRAINT "step_result_recorded_by_app_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_sign_off" ADD CONSTRAINT "release_sign_off_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_sign_off" ADD CONSTRAINT "release_sign_off_approver_id_app_user_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_sign_off" ADD CONSTRAINT "release_sign_off_completed_by_app_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_case" ADD CONSTRAINT "test_plan_case_plan_id_test_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."test_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan_case" ADD CONSTRAINT "test_plan_case_case_id_test_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."test_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan" ADD CONSTRAINT "test_plan_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_plan" ADD CONSTRAINT "test_plan_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_binding_fq_uq" ON "automation_binding" USING btree ("project_id","fq_name");--> statement-breakpoint
CREATE INDEX "automation_binding_case_ix" ON "automation_binding" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "automation_binding_method_ix" ON "automation_binding" USING btree ("project_id","method");--> statement-breakpoint
CREATE INDEX "automation_binding_last_seen_ix" ON "automation_binding" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "unbound_result_project_ix" ON "unbound_result" USING btree ("project_id","seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_object_key_uq" ON "attachment" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "attachment_run_ix" ON "attachment" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "attachment_run_case_ix" ON "attachment" USING btree ("run_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "defect_link_uq" ON "defect_link" USING btree ("run_case_id","issue_key");--> statement-breakpoint
CREATE INDEX "defect_link_issue_ix" ON "defect_link" USING btree ("issue_key");--> statement-breakpoint
CREATE INDEX "defect_link_linked_at_ix" ON "defect_link" USING btree ("linked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "failure_triage_signature_uq" ON "failure_triage" USING btree ("project_id","signature");--> statement-breakpoint
CREATE INDEX "failure_triage_state_ix" ON "failure_triage" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "case_result_run_ix" ON "case_result" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "case_result_case_ix" ON "case_result" USING btree ("case_id","executed_at");--> statement-breakpoint
CREATE INDEX "case_result_project_executed_ix" ON "case_result" USING btree ("project_id","executed_at");--> statement-breakpoint
CREATE INDEX "case_result_signature_ix" ON "case_result" USING btree ("failure_signature");--> statement-breakpoint
CREATE UNIQUE INDEX "run_case_uq" ON "run_case" USING btree ("run_id","case_id");--> statement-breakpoint
CREATE INDEX "run_case_outcome_ix" ON "run_case" USING btree ("run_id","outcome");--> statement-breakpoint
CREATE INDEX "run_project_started_ix" ON "run" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "run_release_ix" ON "run" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "run_kind_ix" ON "run" USING btree ("project_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "step_result_uq" ON "step_result" USING btree ("run_case_id","step_position");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_name_uq" ON "environment" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "release_sign_off_name_uq" ON "release_sign_off" USING btree ("release_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "release_name_uq" ON "release" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "release_status_ix" ON "release" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "test_plan_case_pk" ON "test_plan_case" USING btree ("plan_id","case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_plan_name_uq" ON "test_plan" USING btree ("project_id","name");