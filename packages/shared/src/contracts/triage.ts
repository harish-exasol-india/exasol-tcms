import { z } from 'zod';

export const triageStateSchema = z.enum([
  'new',
  'investigating',
  'known_issue',
  'flaky',
  'resolved',
  'regression',
]);
export type TriageState = z.infer<typeof triageStateSchema>;

/** States that count as blocking a release: nobody has decided what they are yet. */
export const BLOCKING_TRIAGE_STATES: readonly TriageState[] = [
  'new',
  'investigating',
  'regression',
];

export const triageEntrySchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid(),
  caseRef: z.string(),
  caseTitle: z.string(),
  signature: z.string(),
  state: triageStateSchema,
  note: z.string().nullable(),
  updatedByName: z.string().nullable(),
  firstSeenAt: z.string(),
  updatedAt: z.string(),
  occurrences: z.number().int().nonnegative(),
  lastFailureMessage: z.string().nullable(),
});
export type TriageEntry = z.infer<typeof triageEntrySchema>;

export const triageListSchema = z.object({
  entries: z.array(triageEntrySchema),
  // A partial record: only states actually present are keyed.
  counts: z.record(z.string(), z.number().int()),
});

export const updateTriageRequestSchema = z.object({
  state: triageStateSchema,
  note: z.string().max(4000).nullish(),
});
export type UpdateTriageRequest = z.infer<typeof updateTriageRequestSchema>;

export const runTriageSummarySchema = z.object({
  newFailures: z.number().int().nonnegative(),
  carriedForward: z.number().int().nonnegative(),
  regressions: z.number().int().nonnegative(),
  totalFailures: z.number().int().nonnegative(),
});
