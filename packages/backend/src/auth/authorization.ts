/**
 * The single authorisation funnel (design Decision 6).
 *
 * Every guarded operation — web, REST, and MCP alike — resolves through `authorize`. There
 * is deliberately no second path: MCP calls this same function, which is what makes the
 * mcp-integration spec's "permission rules not duplicated" requirement hold by construction
 * rather than by discipline.
 */
import { type Permission, type ProjectRole, roleGrants } from '@tcms/shared';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';

export type Principal =
  | { kind: 'user'; userId: string; origin: 'ui' | 'api' | 'mcp' }
  | { kind: 'token'; tokenId: string; projectId: string; scopes: string[]; origin: 'api' };

/**
 * Denials are undifferentiated on purpose: a caller with no role in a project must not be
 * able to distinguish "forbidden" from "does not exist" (auth-and-access spec).
 */
export class AccessDeniedError extends Error {
  readonly statusCode = 404;
  constructor(message = 'Not found') {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export type Authorizer = {
  roleIn(userId: string, projectId: string): Promise<ProjectRole | null>;
  authorize(principal: Principal, permission: Permission, projectId: string): Promise<void>;
  can(principal: Principal, permission: Permission, projectId: string): Promise<boolean>;
  visibleProjectIds(userId: string): Promise<string[]>;
};

/** Maps a token scope onto the permissions it confers. Tokens are machine-only and coarse. */
const SCOPE_PERMISSIONS: Record<string, readonly Permission[]> = {
  'results:write': ['run.create', 'run.execute', 'run.read'],
  'results:read': ['run.read', 'report.read', 'export.perform'],
  'cases:read': ['case.read'],
  'cases:write': ['case.read', 'case.create', 'case.edit'],
};

export function createAuthorizer(db: Database): Authorizer {
  async function roleIn(userId: string, projectId: string): Promise<ProjectRole | null> {
    const [row] = await db
      .select({ role: s.memberships.role })
      .from(s.memberships)
      .where(and(eq(s.memberships.userId, userId), eq(s.memberships.projectId, projectId)))
      .limit(1);
    return row?.role ?? null;
  }

  async function can(
    principal: Principal,
    permission: Permission,
    projectId: string,
  ): Promise<boolean> {
    if (principal.kind === 'token') {
      // A token is bound to exactly one project; it can never reach another.
      if (principal.projectId !== projectId) return false;
      return principal.scopes.some((scope) =>
        (SCOPE_PERMISSIONS[scope] ?? []).includes(permission),
      );
    }
    const role = await roleIn(principal.userId, projectId);
    return role !== null && roleGrants(role, permission);
  }

  return {
    roleIn,
    can,
    async authorize(principal, permission, projectId) {
      if (!(await can(principal, permission, projectId))) {
        throw new AccessDeniedError();
      }
    },
    async visibleProjectIds(userId) {
      const rows = await db
        .select({ projectId: s.memberships.projectId })
        .from(s.memberships)
        .where(eq(s.memberships.userId, userId));
      return rows.map((r) => r.projectId);
    },
  };
}
