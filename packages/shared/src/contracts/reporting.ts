import { z } from 'zod';
import { coverageSummarySchema } from './coverage.js';
import { triageStateSchema } from './triage.js';

export const releaseReadinessSchema = z.object({
  release: z.object({
    id: z.string().uuid(),
    name: z.string(),
    status: z.string(),
    targetDate: z.string().nullable(),
  }),
  /** Null when no run has been attributed to this release: absence of data, not success. */
  execution: z
    .object({
      runs: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      untested: z.number().int().nonnegative(),
      passRate: z.number(),
    })
    .nullable(),
  blocking: z.object({
    count: z.number().int().nonnegative(),
    known: z.number().int().nonnegative(),
    flaky: z.number().int().nonnegative(),
    items: z.array(
      z.object({
        caseRef: z.string(),
        caseTitle: z.string(),
        state: triageStateSchema,
        message: z.string().nullable(),
      }),
    ),
  }),
  defects: z.array(
    z.object({
      issueKey: z.string(),
      url: z.string(),
      caseRef: z.string(),
      linkedAt: z.string(),
      ageDays: z.number().int().nonnegative(),
    }),
  ),
  coverage: coverageSummarySchema,
  uat: z.object({
    total: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
    runs: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        status: z.string(),
        total: z.number().int(),
        passed: z.number().int(),
        failed: z.number().int(),
      }),
    ),
  }),
  gate: z.object({
    signedOff: z.boolean(),
    items: z.array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        approverId: z.string().uuid().nullable(),
        approverName: z.string().nullable(),
        completedByName: z.string().nullable(),
        completedAt: z.string().nullable(),
      }),
    ),
    outstanding: z.array(z.string()),
  }),
});
export type ReleaseReadiness = z.infer<typeof releaseReadinessSchema>;

export const signOffItemRequestSchema = z.object({
  name: z.string().min(1).max(160),
  approverId: z.string().uuid().nullish(),
});

export const metricsQuerySchema = z.object({
  releaseId: z.string().uuid().optional(),
  days: z.coerce.number().int().min(1).max(400).default(90),
});

export const metricsSchema = z.object({
  window: z.object({
    days: z.number().int(),
    from: z.string(),
    to: z.string(),
    retentionMonths: z.number().int(),
  }),
  totals: z.object({
    executions: z.number().int().nonnegative(),
    passRate: z.number(),
    failureRate: z.number(),
    runtimeMsP50: z.number().nullable(),
    runtimeMsP95: z.number().nullable(),
    totalRuntimeMs: z.number(),
  }),
  coverage: coverageSummarySchema,
  trend: z.array(
    z.object({
      day: z.string(),
      executions: z.number().int(),
      passRate: z.number(),
      failureRate: z.number(),
      runtimeMsP50: z.number().nullable(),
    }),
  ),
  /** Truncated by the retention window; stated so a short series is not read as a gap. */
  trendTruncated: z.boolean(),
  flaky: z.array(
    z.object({
      caseRef: z.string(),
      caseTitle: z.string(),
      commitSha: z.string(),
      outcomes: z.array(z.string()),
      changes: z.number().int(),
    }),
  ),
  defectAgeBands: z.array(z.object({ band: z.string(), count: z.number().int() })),
});
export type Metrics = z.infer<typeof metricsSchema>;
