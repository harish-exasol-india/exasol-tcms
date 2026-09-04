import { z } from 'zod';

/**
 * Coverage means automation coverage only (design Decision 3): which managed cases have an
 * automation binding. There is no Requirement entity, so "a feature with no cases at all"
 * is deliberately not answerable here.
 */
export const coverageSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  automated: z.number().int().nonnegative(),
  manual: z.number().int().nonnegative(),
  neverExecuted: z.number().int().nonnegative(),
});
export type CoverageSummary = z.infer<typeof coverageSummarySchema>;

export const coverageGroupSchema = coverageSummarySchema.extend({
  key: z.string(),
  label: z.string(),
});
export type CoverageGroup = z.infer<typeof coverageGroupSchema>;

export const coverageResponseSchema = z.object({
  summary: coverageSummarySchema,
  groups: z.array(coverageGroupSchema),
  groupBy: z.enum(['tag', 'suite', 'none']),
});
export type CoverageResponse = z.infer<typeof coverageResponseSchema>;

export const coverageQuerySchema = z.object({
  suiteId: z.string().uuid().optional(),
  tag: z.array(z.string()).or(z.string()).optional(),
  release: z.string().optional(),
  customField: z.string().optional(),
  customFieldValue: z.string().optional(),
  groupBy: z.enum(['tag', 'suite', 'none']).default('none'),
});
export type CoverageQuery = z.infer<typeof coverageQuerySchema>;

/** The cases behind a coverage figure, so a number can always be drilled into. */
export const uncoveredCaseSchema = z.object({
  id: z.string().uuid(),
  ref: z.string(),
  title: z.string(),
  suiteName: z.string(),
  priority: z.string(),
  tags: z.array(z.string()),
  everExecuted: z.boolean(),
});
export const uncoveredResponseSchema = z.object({
  cases: z.array(uncoveredCaseSchema),
  total: z.number().int().nonnegative(),
});
