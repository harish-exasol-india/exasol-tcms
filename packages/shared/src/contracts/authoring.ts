import { z } from 'zod';

export const sharedStepItemInputSchema = z.object({
  action: z.string().min(1).max(4000),
  expected: z.string().max(4000).nullish(),
});

export const sharedStepSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  items: z.array(
    z.object({
      position: z.number().int(),
      action: z.string(),
      expected: z.string().nullable(),
    }),
  ),
  /** How many cases reference this block. */
  referencingCaseCount: z.number().int().nonnegative(),
  /** How many currently-open runs would change content if this block is edited. */
  affectedOpenRunCount: z.number().int().nonnegative(),
});
export type SharedStep = z.infer<typeof sharedStepSchema>;

export const sharedStepListSchema = z.object({ sharedSteps: z.array(sharedStepSchema) });

export const createSharedStepRequestSchema = z.object({
  name: z.string().min(1).max(200),
  items: z.array(sharedStepItemInputSchema).min(1),
});
export const updateSharedStepRequestSchema = createSharedStepRequestSchema.partial();
export type CreateSharedStepRequest = z.infer<typeof createSharedStepRequestSchema>;
export type UpdateSharedStepRequest = z.infer<typeof updateSharedStepRequestSchema>;

export const customFieldTypeSchema = z.enum(['text', 'number', 'boolean', 'select']);

export const customFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  type: customFieldTypeSchema,
  options: z.array(z.string()).nullable(),
  /** Cases carrying a value for this field, so removal can warn about impact. */
  usageCount: z.number().int().nonnegative(),
});
export const customFieldListSchema = z.object({
  customFields: z.array(customFieldDefinitionSchema),
});

export const createCustomFieldRequestSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, 'Key must be lowercase alphanumeric with underscores'),
  label: z.string().min(1).max(120),
  type: customFieldTypeSchema,
  options: z.array(z.string().min(1)).optional(),
});
export type CreateCustomFieldRequest = z.infer<typeof createCustomFieldRequestSchema>;

export const tagSchema = z.object({ name: z.string(), usageCount: z.number().int() });
export const tagListSchema = z.object({ tags: z.array(tagSchema) });
