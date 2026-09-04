import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { createDatabase, createPool } from '../db/client.js';
import * as s from '../db/schema/index.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('member routes (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  const password = 'admin-password';
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let projectId: string;

  const signIn = async (key: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: `${key}-${stamp}@exasol.com`, password },
    });
    cookies[key] = r.cookies.find((c) => c.name === 'tcms_session')!.value;
  };

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `members-${stamp}`, name: 'Members Project' })
      .returning();
    projectId = p!.id;

    for (const key of ['admin', 'lead', 'newcomer']) {
      const [u] = await db
        .insert(s.users)
        .values({
          email: `${key}-${stamp}@exasol.com`,
          displayName: key,
          passwordHash: await hashPassword(password),
        })
        .returning();
      ids[key] = u!.id;
    }
    await db.insert(s.memberships).values([
      { userId: ids['admin'] as string, projectId, role: 'admin' },
      { userId: ids['lead'] as string, projectId, role: 'lead' },
    ]);

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
    await signIn('admin');
    await signIn('lead');
    await signIn('newcomer');
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    for (const id of Object.values(ids)) await db.delete(s.users).where(eq(s.users.id, id));
    await pool.end();
  });

  const as = (key: string) => ({ cookies: { tcms_session: cookies[key] as string } });

  it('lists members to a member', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/members`,
      ...as('lead'),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().members).toHaveLength(2);
  });

  it('hides the project entirely from a non-member', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/members`,
      ...as('newcomer'),
    });
    // 404, not 403: existence is not disclosed.
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'Not found' });
  });

  // Task 3.10 -- an administrator can assign a role
  it('lets an administrator assign a role', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/members`,
      payload: { userId: ids['newcomer'], role: 'tester' },
      ...as('admin'),
    });
    expect(r.statusCode).toBe(200);

    const [row] = await db
      .select()
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.userId, ids['newcomer'] as string),
          eq(s.memberships.projectId, projectId),
        ),
      );
    expect(row?.role).toBe('tester');

    // The newly granted member can now reach the project.
    const list = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/members`,
      ...as('newcomer'),
    });
    expect(list.statusCode).toBe(200);
  });

  it('changes an existing role rather than duplicating it', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/members`,
      payload: { userId: ids['newcomer'], role: 'viewer' },
      ...as('admin'),
    });
    const rows = await db
      .select()
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.userId, ids['newcomer'] as string),
          eq(s.memberships.projectId, projectId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('viewer');
  });

  it('refuses role assignment by a lead', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/members`,
      payload: { userId: ids['newcomer'], role: 'admin' },
      ...as('lead'),
    });
    expect(r.statusCode).toBe(404);
  });

  // Task 3.10 -- an administrator can revoke a role
  it('lets an administrator revoke a role, removing all access', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/members/${ids['newcomer']}`,
      ...as('admin'),
    });
    expect(r.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/members`,
      ...as('newcomer'),
    });
    expect(after.statusCode).toBe(404);
  });

  it('refuses to revoke the last administrator', async () => {
    const r = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/members/${ids['admin']}`,
      ...as('admin'),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('LAST_ADMIN');
  });

  it('rejects an unknown user id', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/members`,
      payload: { userId: '00000000-0000-0000-0000-000000000000', role: 'tester' },
      ...as('admin'),
    });
    expect(r.statusCode).toBe(404);
  });
});
