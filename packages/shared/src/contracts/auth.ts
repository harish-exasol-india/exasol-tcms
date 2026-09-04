import { z } from 'zod';
import { projectRoleSchema } from '../roles.js';

export const signInRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const currentUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  provider: z.enum(['local', 'oidc']),
  memberships: z.array(
    z.object({
      projectId: z.string().uuid(),
      projectKey: z.string(),
      projectName: z.string(),
      role: projectRoleSchema,
    }),
  ),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/**
 * Error bodies carry diagnostic fields beyond the message — a result conflict carries the
 * value that actually won, for instance. Passthrough is required: a strict object silently
 * strips those fields, and the caller then cannot act on information the server did send.
 */
export const errorResponseSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    issues: z.unknown().optional(),
  })
  .passthrough();
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
