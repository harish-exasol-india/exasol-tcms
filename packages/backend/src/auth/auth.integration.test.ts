import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { createSessionService } from './sessions.js';
import { createTokenService } from './token-service.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('sessions and tokens (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof createDatabase>;
  let sessions: ReturnType<typeof createSessionService>;
  let tokens: ReturnType<typeof createTokenService>;
  let userId: string;
  let projectId: string;
  let otherProjectId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    sessions = createSessionService(db);
    tokens = createTokenService(db);
    const [u] = await db
      .insert(s.users)
      .values({ email: `sess-${stamp}@exasol.com`, displayName: 'Session User' })
      .returning();
    userId = u!.id;
    const [p] = await db
      .insert(s.projects)
      .values({ key: `sess-${stamp}`, name: 'Session Project' })
      .returning();
    projectId = p!.id;
    const [o] = await db
      .insert(s.projects)
      .values({ key: `sess-other-${stamp}`, name: 'Other' })
      .returning();
    otherProjectId = o!.id;
  });

  afterAll(async () => {
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.projects).where(eq(s.projects.id, otherProjectId));
    await db.delete(s.users).where(eq(s.users.id, userId));
    await pool.end();
  });

  // Task 3.3
  it('creates a session that resolves to its user', async () => {
    const { sessionId, expiresAt } = await sessions.create(userId, 'vitest');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await sessions.resolve(sessionId)).toEqual({ userId });
  });

  it('refuses a revoked session immediately', async () => {
    const { sessionId } = await sessions.create(userId);
    await sessions.revoke(sessionId);
    expect(await sessions.resolve(sessionId)).toBeNull();
  });

  it('refuses an expired session', async () => {
    const [row] = await db
      .insert(s.sessions)
      .values({ userId, expiresAt: new Date(Date.now() - 1000) })
      .returning({ id: s.sessions.id });
    expect(await sessions.resolve(row!.id)).toBeNull();
  });

  it('refuses a forged session id', async () => {
    expect(await sessions.resolve('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('revokes every session for a user at once', async () => {
    const a = await sessions.create(userId);
    const b = await sessions.create(userId);
    await sessions.revokeAllForUser(userId);
    expect(await sessions.resolve(a.sessionId)).toBeNull();
    expect(await sessions.resolve(b.sessionId)).toBeNull();
  });

  // Task 3.4
  it('shows the token secret once and never returns it again', async () => {
    const issued = await tokens.issue({
      projectId,
      name: 'ci',
      scopes: ['results:write'],
      createdBy: userId,
    });
    expect(issued.secret).toMatch(/^tcms_/);

    const [stored] = await db.select().from(s.apiTokens).where(eq(s.apiTokens.id, issued.id));
    // Nothing recoverable is persisted.
    expect(stored?.tokenHash).not.toBe(issued.secret);
    expect(JSON.stringify(stored)).not.toContain(issued.secret);
    expect(stored?.prefix).toBe(issued.prefix);
  });

  it('verifies a token and records last-used', async () => {
    const issued = await tokens.issue({ projectId, name: 'ci-2', scopes: ['results:write'] });
    const verified = await tokens.verify(issued.secret);
    expect(verified?.projectId).toBe(projectId);
    expect(verified?.scopes).toEqual(['results:write']);

    await new Promise((r) => setTimeout(r, 120));
    const [row] = await db.select().from(s.apiTokens).where(eq(s.apiTokens.id, issued.id));
    expect(row?.lastUsedAt).not.toBeNull();
  });

  // Task 3.5
  it('binds a token to exactly one project', async () => {
    const issued = await tokens.issue({ projectId, name: 'scoped', scopes: ['results:write'] });
    const verified = await tokens.verify(issued.secret);
    expect(verified?.projectId).toBe(projectId);
    expect(verified?.projectId).not.toBe(otherProjectId);
  });

  it('refuses a revoked token', async () => {
    const issued = await tokens.issue({ projectId, name: 'revoked', scopes: ['results:read'] });
    expect(await tokens.verify(issued.secret)).not.toBeNull();
    await tokens.revoke(issued.id);
    expect(await tokens.verify(issued.secret)).toBeNull();
  });

  it('refuses an expired token', async () => {
    const issued = await tokens.issue({
      projectId,
      name: 'expired',
      scopes: ['results:read'],
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await tokens.verify(issued.secret)).toBeNull();
  });

  it('refuses a fabricated token', async () => {
    expect(await tokens.verify('tcms_totally-made-up')).toBeNull();
  });
});
