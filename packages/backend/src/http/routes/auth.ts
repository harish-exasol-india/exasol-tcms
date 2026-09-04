import { currentUserSchema, signInRequestSchema } from '@tcms/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AuthProviderRegistry } from '../../auth/provider.js';
import type { SessionService } from '../../auth/sessions.js';
import type { Database } from '../../db/client.js';
import * as s from '../../db/schema/index.js';
import { SESSION_COOKIE } from '../authenticate.js';
import { unauthorized } from '../errors.js';

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: {
    db: Database;
    sessions: SessionService;
    providers: AuthProviderRegistry;
    secure: boolean;
  },
): void {
  app.post('/api/auth/sign-in', async (request, reply) => {
    const credentials = signInRequestSchema.parse(request.body);
    const provider = deps.providers.get('local');
    if (!provider) throw unauthorized();

    const identity = await provider.authenticate(credentials);
    // One undifferentiated failure for wrong password and unknown account alike.
    if (!identity) throw unauthorized('Invalid email or password');

    const { sessionId, expiresAt } = await deps.sessions.create(
      identity.externalId,
      request.headers['user-agent'],
    );
    await deps.db
      .update(s.users)
      .set({ lastSeenAt: new Date() })
      .where(eq(s.users.id, identity.externalId));

    return reply
      .setCookie(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: deps.secure,
        path: '/',
        expires: expiresAt,
      })
      .send({ ok: true });
  });

  app.post('/api/auth/sign-out', async (request, reply) => {
    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (sessionId) await deps.sessions.revoke(sessionId);
    return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ ok: true });
  });

  app.get('/api/auth/me', async (request) => {
    const principal = request.principal;
    if (principal?.kind !== 'user') throw unauthorized();

    const [user] = await deps.db.select().from(s.users).where(eq(s.users.id, principal.userId));
    if (!user) throw unauthorized();

    const memberships = await deps.db
      .select({
        projectId: s.memberships.projectId,
        projectKey: s.projects.key,
        projectName: s.projects.name,
        role: s.memberships.role,
      })
      .from(s.memberships)
      .innerJoin(s.projects, eq(s.projects.id, s.memberships.projectId))
      .where(eq(s.memberships.userId, principal.userId));

    return currentUserSchema.parse({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      provider: user.provider,
      memberships,
    });
  });
}
