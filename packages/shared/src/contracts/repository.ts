import { z } from 'zod';

export const casePrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const caseRiskSchema = z.enum(['low', 'medium', 'high']);
export type CasePriority = z.infer<typeof casePrioritySchema>;
export type CaseRisk = z.infer<typeof caseRiskSchema>;

/** A step is either literal content or a reference to a shared step, never both. */
export const caseStepInputSchema = z
  .object({
    action: z.string().min(1).max(4000).optional(),
    expected: z.string().max(4000).nullish(),
    sharedStepId: z.string().uuid().optional(),
  })
  .refine((s) => Boolean(s.action) !== Boolean(s.sharedStepId), {
    message: 'A step must have either an action or a sharedStepId, not both',
  });
export type CaseStepInput = z.infer<typeof caseStepInputSchema>;

export const caseStepSchema = z.object({
  position: z.number().int().positive(),
  action: z.string().nullable(),
  expected: z.string().nullable(),
  sharedStepId: z.string().uuid().nullable(),
  sharedStepName: z.string().nullable(),
  /** Resolved content of the referenced shared step, rendered in position. */
  sharedStepItems: z
    .array(
      z.object({ position: z.number().int(), action: z.string(), expected: z.string().nullable() }),
    )
    .nullable(),
});
export type CaseStep = z.infer<typeof caseStepSchema>;

export const customFieldValueSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

export const createCaseRequestSchema = z.object({
  suiteId: z.string().uuid(),
  title: z.string().min(1).max(500),
  ownerId: z.string().uuid().nullish(),
  priority: casePrioritySchema.default('medium'),
  risk: caseRiskSchema.default('medium'),
  preconditions: z.string().max(8000).nullish(),
  // AC 1 requires steps; a case with none is not a test case.
  steps: z.array(caseStepInputSchema).min(1, 'At least one step is required'),
  tags: z.array(z.string().min(1).max(80)).default([]),
  customFields: customFieldValueSchema.optional(),
});
export type CreateCaseRequest = z.infer<typeof createCaseRequestSchema>;

export const updateCaseRequestSchema = createCaseRequestSchema.partial().extend({
  steps: z.array(caseStepInputSchema).min(1).optional(),
});
export type UpdateCaseRequest = z.infer<typeof updateCaseRequestSchema>;

export const testCaseSchema = z.object({
  id: z.string().uuid(),
  ref: z.string(),
  projectId: z.string().uuid(),
  suiteId: z.string().uuid(),
  suitePath: z.array(z.string()),
  title: z.string(),
  ownerId: z.string().uuid().nullable(),
  ownerName: z.string().nullable(),
  priority: casePrioritySchema,
  risk: caseRiskSchema,
  preconditions: z.string().nullable(),
  isAutomated: z.boolean(),
  tags: z.array(z.string()),
  customFields: customFieldValueSchema.nullable(),
  steps: z.array(caseStepSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TestCase = z.infer<typeof testCaseSchema>;

export const caseListItemSchema = testCaseSchema.omit({ steps: true, customFields: true });
export type CaseListItem = z.infer<typeof caseListItemSchema>;

export const caseListResponseSchema = z.object({
  items: z.array(caseListItemSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

export const caseListQuerySchema = z.object({
  suiteId: z.string().uuid().optional(),
  /** Includes the whole subtree beneath suiteId when true. */
  includeDescendants: z.coerce.boolean().default(true),
  tag: z.array(z.string()).or(z.string()).optional(),
  automated: z.enum(['true', 'false']).optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  cursor: z.string().optional(),
});
export type CaseListQuery = z.infer<typeof caseListQuerySchema>;

export const suiteSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  position: z.number().int(),
  caseCount: z.number().int().nonnegative(),
});
export type Suite = z.infer<typeof suiteSchema>;

export const suiteTreeSchema = z.object({ suites: z.array(suiteSchema) });

export const createSuiteRequestSchema = z.object({
  parentId: z.string().uuid().nullish(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
});
export const updateSuiteRequestSchema = createSuiteRequestSchema.partial();
export type CreateSuiteRequest = z.infer<typeof createSuiteRequestSchema>;
export type UpdateSuiteRequest = z.infer<typeof updateSuiteRequestSchema>;

export const caseHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  origin: z.enum(['ui', 'api', 'mcp']),
  action: z.enum(['created', 'updated', 'deleted', 'restored']),
  changedFields: z.array(z.string()),
  occurredAt: z.string(),
});
export const caseHistoryResponseSchema = z.object({
  entries: z.array(caseHistoryEntrySchema),
});
export type CaseHistoryEntry = z.infer<typeof caseHistoryEntrySchema>;
