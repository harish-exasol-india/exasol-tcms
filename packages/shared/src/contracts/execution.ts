import { z } from 'zod';

export const outcomeSchema = z.enum(['passed', 'failed', 'blocked', 'skipped', 'untested']);
export type Outcome = z.infer<typeof outcomeSchema>;

export const runKindSchema = z.enum(['manual', 'automated', 'uat']);
export const runStatusSchema = z.enum(['open', 'closed', 'aborted']);

export const runSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: runKindSchema,
  status: runStatusSchema,
  releaseId: z.string().uuid().nullable(),
  releaseName: z.string().nullable(),
  environmentName: z.string().nullable(),
  branch: z.string().nullable(),
  commitSha: z.string().nullable(),
  startedAt: z.string(),
  closedAt: z.string().nullable(),
  progress: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    untested: z.number().int().nonnegative(),
  }),
});
export type RunSummary = z.infer<typeof runSummarySchema>;
export const runListSchema = z.object({ runs: z.array(runSummarySchema) });

export const runCaseSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  ref: z.string(),
  title: z.string(),
  suiteName: z.string(),
  priority: z.string(),
  outcome: outcomeSchema,
  /** Optimistic concurrency token; a write based on a stale value is rejected. */
  version: z.number().int().nonnegative(),
  assigneeId: z.string().uuid().nullable(),
  assigneeName: z.string().nullable(),
  updatedAt: z.string(),
  steps: z.array(
    z.object({
      position: z.number().int(),
      action: z.string().nullable(),
      expected: z.string().nullable(),
      sharedStepName: z.string().nullable(),
      sharedStepItems: z
        .array(
          z.object({
            position: z.number().int(),
            action: z.string(),
            expected: z.string().nullable(),
          }),
        )
        .nullable(),
      outcome: outcomeSchema.nullable(),
      comment: z.string().nullable(),
    }),
  ),
  attachments: z.array(
    z.object({
      id: z.string().uuid(),
      filename: z.string(),
      contentType: z.string(),
      sizeBytes: z.number().int(),
      stepPosition: z.number().int().nullable(),
      uploadedAt: z.string(),
    }),
  ),
  defects: z.array(
    z.object({
      id: z.string().uuid(),
      issueKey: z.string(),
      stepPosition: z.number().int().nullable(),
      linkedAt: z.string(),
    }),
  ),
});
export type RunCase = z.infer<typeof runCaseSchema>;

export const runDetailSchema = runSummarySchema.extend({
  cases: z.array(runCaseSchema.omit({ steps: true, attachments: true, defects: true })),
});

export const createRunRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: runKindSchema.default('manual'),
    planId: z.string().uuid().nullish(),
    caseIds: z.array(z.string().uuid()).optional(),
    environmentId: z.string().uuid().nullish(),
    releaseId: z.string().uuid().nullish(),
  })
  .refine((r) => Boolean(r.planId) || (r.caseIds?.length ?? 0) > 0, {
    message: 'A run needs either a plan or an explicit case selection',
  });
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const recordResultRequestSchema = z.object({
  outcome: outcomeSchema,
  /** The version the caller read. A mismatch means someone else wrote first. */
  basedOnVersion: z.number().int().nonnegative(),
  comment: z.string().max(4000).nullish(),
  steps: z
    .array(
      z.object({
        position: z.number().int().positive(),
        outcome: outcomeSchema,
        comment: z.string().max(2000).nullish(),
      }),
    )
    .optional(),
});
export type RecordResultRequest = z.infer<typeof recordResultRequestSchema>;

export const resultConflictSchema = z.object({
  error: z.string(),
  code: z.literal('RESULT_CONFLICT'),
  current: z.object({
    outcome: outcomeSchema,
    version: z.number().int(),
    updatedBy: z.string().nullable(),
    updatedAt: z.string(),
  }),
});

export const linkDefectRequestSchema = z.object({
  issueKey: z.string().min(1).max(60),
  stepPosition: z.number().int().positive().nullish(),
});
