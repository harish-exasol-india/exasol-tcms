import { z } from 'zod';
import { projectRoleSchema } from '../roles.js';

export const projectMemberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: projectRoleSchema,
  grantedAt: z.string(),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const projectMemberListSchema = z.object({ members: z.array(projectMemberSchema) });

export const assignRoleRequestSchema = z.object({
  userId: z.string().uuid(),
  role: projectRoleSchema,
});
export type AssignRoleRequest = z.infer<typeof assignRoleRequestSchema>;

export const assignableUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
});
export const assignableUserListSchema = z.object({ users: z.array(assignableUserSchema) });
export type AssignableUser = z.infer<typeof assignableUserSchema>;
