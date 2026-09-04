import { z } from 'zod';

/** Metadata accompanying an upload. `release` is what makes AC 4 attribution possible. */
export const ingestMetadataSchema = z.object({
  release: z.string().min(1).max(120).optional(),
  environment: z.string().min(1).max(120).optional(),
  commitSha: z.string().min(1).max(120).optional(),
  branch: z.string().min(1).max(200).optional(),
  runName: z.string().min(1).max(200).optional(),
});
export type IngestMetadata = z.infer<typeof ingestMetadataSchema>;

export const ingestResponseSchema = z.object({
  runId: z.string().uuid(),
  runName: z.string(),
  ingested: z.number().int().nonnegative(),
  bound: z.object({
    byIdentifier: z.number().int().nonnegative(),
    byName: z.number().int().nonnegative(),
  }),
  unbound: z.number().int().nonnegative(),
  counts: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  triage: z.object({
    newFailures: z.number().int().nonnegative(),
    carriedForward: z.number().int().nonnegative(),
    regressions: z.number().int().nonnegative(),
  }),
});
export type IngestResponse = z.infer<typeof ingestResponseSchema>;

export const bindingMethodSchema = z.enum(['identifier', 'name_match']);

export const automationBindingSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  caseRef: z.string(),
  caseTitle: z.string(),
  fqName: z.string(),
  method: bindingMethodSchema,
  lastSeenAt: z.string().nullable(),
  promotedAt: z.string().nullable(),
  isStale: z.boolean(),
});
export type AutomationBinding = z.infer<typeof automationBindingSchema>;

export const bindingReportSchema = z.object({
  bindings: z.array(automationBindingSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    byIdentifier: z.number().int().nonnegative(),
    byName: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    staleThresholdDays: z.number().int().positive(),
  }),
  unboundTests: z.array(z.object({ fqName: z.string(), outcome: z.string(), seenAt: z.string() })),
});
