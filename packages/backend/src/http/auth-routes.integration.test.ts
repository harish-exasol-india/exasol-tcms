import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { createDatabase, createPool } from '../db/client.js';
import * as s from '../db/schema/index.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('auth routes (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  const email = `routes-${stamp}@exasol.com`;
  const password = 'a-strong-password';
  let projectId: string;

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [u] = await db
      .insert(s.users)
      .values({ email, displayName: 'Route User', passwordHash: await hashPassword(password) })
      .returning();
    const [p] = await db
      .insert(s.projects)
      .values({ key: `routes-${stamp}`, name: 'Routes Project' })
      .returning();
    projectId = p!.id;
    await db.insert(s.memberships).values({ userId: u!.id, projectId, role: 'lead' });

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.users).where(eq(s.users.email, email));
    await pool.end();
  });

  const signIn = () =>
    app.inject({ method: 'POST', url: '/api/auth/sign-in', payload: { email, password } });

  it('reports liveness and readiness', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'ready', checks: { database: 'ok' } });
  });

  // Task 3.9 -- full sign-in to authenticated view flow
  it('signs in, sets an httpOnly session cookie, and serves the current user', async () => {
    const response = await signIn();
    expect(response.statusCode).toBe(200);

    const cookie = response.cookies.find((c) => c.name === 'tcms_session');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { tcms_session: cookie!.value },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.email).toBe(email);
    expect(body.provider).toBe('local');
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0].role).toBe('lead');
    // The response must never carry credential material.
    expect(JSON.stringify(body)).not.toContain('passwordHash');
    expect(JSON.stringify(body)).not.toContain(password);
  });

  it('rejects a wrong password and an unknown account identically', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email, password: 'nope' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'ghost@exasol.com', password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('refuses the current user without a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
  });

  it('refuses a tampered session cookie', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { tcms_session: '00000000-0000-0000-0000-000000000000' },
    });
    expect(me.statusCode).toBe(401);
  });

  it('signs out and invalidates the session immediately', async () => {
    const cookie = (await signIn()).cookies.find((c) => c.name === 'tcms_session')!;
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      cookies: { tcms_session: cookie.value },
    });
    expect(out.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { tcms_session: cookie.value },
    });
    expect(after.statusCode).toBe(401);
  });

  it('rejects malformed sign-in input with a validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'not-an-email' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Validation failed');
  });
});
