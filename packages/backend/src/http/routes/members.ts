import {
  assignableUserListSchema,
  assignRoleRequestSchema,
  projectMemberListSchema,
} from '@tcms/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Authorizer } from '../../auth/authorization.js';
import type { Database } from '../../db/client.js';
import * as s from '../../db/schema/index.js';
import { badRequest, notFound, unauthorized } from '../errors.js';

const paramsSchema = z.object({ projectId: z.string().uuid() });

export function registerMemberRoutes(
  app: FastifyInstance,
  deps: { db: Database; authorizer: Authorizer },
): void {
  /** Members of a project. Requires membership itself, so a non-member gets a 404. */
  app.get('/api/projects/:projectId/members', async (request) => {
    const { projectId } = paramsSchema.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await deps.authorizer.authorize(principal, 'case.read', projectId);

    const members = await deps.db
      .select({
        userId: s.memberships.userId,
        email: s.users.email,
        displayName: s.users.displayName,
        role: s.memberships.role,
        grantedAt: s.memberships.grantedAt,
      })
      .from(s.memberships)
      .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
      .where(eq(s.memberships.projectId, projectId));

    return projectMemberListSchema.parse({
      members: members.map((m) => ({ ...m, grantedAt: m.grantedAt.toISOString() })),
    });
  });

  /** Users who could be granted a role. Requires member.manage. */
  app.get('/api/projects/:projectId/assignable-users', async (request) => {
    const { projectId } = paramsSchema.parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await deps.authorizer.authorize(principal, 'member.manage', projectId);

    const users = await deps.db
      .select({ id: s.users.id, email: s.users.email, displayName: s.users.displayName })
      .from(s.users)
      .where(eq(s.users.isActive, 'active'));
    return assignableUserListSchema.parse({ users });
  });

  /** Assigns or changes a role. Idempotent on (user, project). */
  app.put('/api/projects/:projectId/members', async (request) => {
    const { projectId } = paramsSchema.parse(request.params);
    const body = assignRoleRequestSchema.parse(request.body);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await deps.authorizer.authorize(principal, 'member.manage', projectId);

    const [user] = await deps.db.select().from(s.users).where(eq(s.users.id, body.userId));
    if (!user) throw notFound('User not found');

    await deps.db
      .insert(s.memberships)
      .values({
        userId: body.userId,
        projectId,
        role: body.role,
        grantedBy: principal.kind === 'user' ? principal.userId : null,
      })
      .onConflictDoUpdate({
        target: [s.memberships.userId, s.memberships.projectId],
        set: { role: body.role, grantedAt: new Date() },
      });

    return { ok: true };
  });

  /** Revokes a role, removing all access to the project. */
  app.delete('/api/projects/:projectId/members/:userId', async (request) => {
    const { projectId, userId } = paramsSchema
      .extend({ userId: z.string().uuid() })
      .parse(request.params);
    const principal = request.principal;
    if (!principal) throw unauthorized();
    await deps.authorizer.authorize(principal, 'member.manage', projectId);

    // An administrator must not be able to remove the project's last administrator and
    // leave it unadministrable.
    const admins = await deps.db
      .select({ userId: s.memberships.userId })
      .from(s.memberships)
      .where(and(eq(s.memberships.projectId, projectId), eq(s.memberships.role, 'admin')));
    if (admins.length === 1 && admins[0]?.userId === userId) {
      throw badRequest('Cannot revoke the last administrator of a project', 'LAST_ADMIN');
    }

    await deps.db
      .delete(s.memberships)
      .where(and(eq(s.memberships.userId, userId), eq(s.memberships.projectId, projectId)));

    return { ok: true };
  });
}
