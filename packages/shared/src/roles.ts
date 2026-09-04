import { z } from 'zod';

/**
 * The fixed per-project role set (design Decision 6). Roles are data consulted by a
 * single authorisation function; no account is privileged by identity.
 */
export const projectRoleSchema = z.enum(['admin', 'lead', 'tester', 'viewer']);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

/** The interface a write originated from, recorded on every mutation (design Decision 10). */
export const originSchema = z.enum(['ui', 'api', 'mcp']);
export type Origin = z.infer<typeof originSchema>;
