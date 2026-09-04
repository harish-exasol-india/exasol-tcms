import { z } from 'zod';

export const testPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  caseCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export const testPlanListSchema = z.object({ plans: z.array(testPlanSchema) });
export type TestPlan = z.infer<typeof testPlanSchema>;

export const createPlanRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  caseIds: z.array(z.string().uuid()).default([]),
});
export const updatePlanRequestSchema = createPlanRequestSchema.partial();
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;
export type UpdatePlanRequest = z.infer<typeof updatePlanRequestSchema>;

export const environmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  runCount: z.number().int().nonnegative(),
});
export const environmentListSchema = z.object({ environments: z.array(environmentSchema) });
export const createEnvironmentRequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
});
export type CreateEnvironmentRequest = z.infer<typeof createEnvironmentRequestSchema>;

export const releaseStatusSchema = z.enum(['planned', 'in_progress', 'released', 'cancelled']);
export const releaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: releaseStatusSchema,
  targetDate: z.string().nullable(),
  runCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export const releaseListSchema = z.object({ releases: z.array(releaseSchema) });
export const createReleaseRequestSchema = z.object({
  name: z.string().min(1).max(120),
  status: releaseStatusSchema.default('planned'),
  targetDate: z.string().datetime().nullish(),
});
export const updateReleaseRequestSchema = createReleaseRequestSchema.partial();
export type CreateReleaseRequest = z.infer<typeof createReleaseRequestSchema>;
export type UpdateReleaseRequest = z.infer<typeof updateReleaseRequestSchema>;
