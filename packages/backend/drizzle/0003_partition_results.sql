-- Partition case_result by month (design Decision 20).
--
-- Postgres requires the partition key to be part of the primary key, which is why the key
-- is (id, executed_at). Retention (design Decision 11) then becomes a partition DROP rather
-- than a mass DELETE.
--
-- Greenfield: the table is recreated rather than converted in place.

DROP TABLE IF EXISTS "case_result";
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
  CONSTRAINT "case_result_pk" PRIMARY KEY ("id", "executed_at")
) PARTITION BY RANGE ("executed_at");
--> statement-breakpoint

CREATE INDEX "case_result_run_ix" ON "case_result" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "case_result_case_ix" ON "case_result" USING btree ("case_id","executed_at");--> statement-breakpoint
CREATE INDEX "case_result_project_executed_ix" ON "case_result" USING btree ("project_id","executed_at");--> statement-breakpoint
CREATE INDEX "case_result_signature_ix" ON "case_result" USING btree ("failure_signature");--> statement-breakpoint

-- Creates the monthly partition covering `at`, if it does not already exist.
-- Idempotent: safe to call on every ingest and from the scheduled maintenance job.
CREATE OR REPLACE FUNCTION ensure_case_result_partition(at timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  start_ts date := date_trunc('month', at AT TIME ZONE 'UTC')::date;
  end_ts   date := (date_trunc('month', at AT TIME ZONE 'UTC') + interval '1 month')::date;
  part     text := format('case_result_%s', to_char(start_ts, 'YYYY_MM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF case_result FOR VALUES FROM (%L) TO (%L)',
      part, start_ts, end_ts
    );
  END IF;
  RETURN part;
END;
$$;
--> statement-breakpoint

-- A DEFAULT partition means an out-of-range executed_at is never silently rejected.
CREATE TABLE "case_result_default" PARTITION OF "case_result" DEFAULT;
--> statement-breakpoint

SELECT ensure_case_result_partition(now());--> statement-breakpoint
SELECT ensure_case_result_partition(now() - interval '1 month');--> statement-breakpoint
SELECT ensure_case_result_partition(now() + interval '1 month');
