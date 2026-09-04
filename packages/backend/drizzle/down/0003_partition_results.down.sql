DROP FUNCTION IF EXISTS ensure_case_result_partition(timestamptz);
DROP TABLE IF EXISTS "case_result";
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
  CONSTRAINT "case_result_pk" PRIMARY KEY ("id", "executed_at")
);
