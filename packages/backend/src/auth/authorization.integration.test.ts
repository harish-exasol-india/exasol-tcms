import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { AccessDeniedError, createAuthorizer, type Principal } from './authorization.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('authorization (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof createDatabase>;
  let auth: ReturnType<typeof createAuthorizer>;
  let projectA: string;
  let projectB: string;
  const ids: Record<string, string> = {};
  const stamp = Date.now();

  const user = (key: string): Principal => ({
    kind: 'user',
    userId: ids[key] as string,
    origin: 'ui',
  });

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    auth = createAuthorizer(db);

    const [a] = await db
      .insert(s.projects)
      .values({ key: `authz-a-${stamp}`, name: 'Project A' })
      .returning();
    const [b] = await db
      .insert(s.projects)
      .values({ key: `authz-b-${stamp}`, name: 'Project B' })
      .returning();
    projectA = a!.id;
    projectB = b!.id;

    for (const role of ['admin', 'lead', 'tester', 'viewer'] as const) {
      const [u] = await db
        .insert(s.users)
        .values({ email: `${role}-${stamp}@exasol.com`, displayName: role })
        .returning();
      ids[role] = u!.id;
      await db.insert(s.memberships).values({ userId: u!.id, projectId: projectA, role });
    }
    const [outsider] = await db
      .insert(s.users)
      .values({ email: `outsider-${stamp}@exasol.com`, displayName: 'outsider' })
      .returning();
    ids['outsider'] = outsider!.id;
    // Deliberately a member of B only, to prove cross-project isolation.
    await db
      .insert(s.memberships)
      .values({ userId: outsider!.id, projectId: projectB, role: 'admin' });
  });

  afterAll(async () => {
    await db.delete(s.projects).where(eq(s.projects.id, projectA));
    await db.delete(s.projects).where(eq(s.projects.id, projectB));
    for (const id of Object.values(ids)) await db.delete(s.users).where(eq(s.users.id, id));
    await pool.end();
  });

  it('resolves a user role within a project', async () => {
    expect(await auth.roleIn(ids['lead'] as string, projectA)).toBe('lead');
    expect(await auth.roleIn(ids['outsider'] as string, projectA)).toBeNull();
  });

  // Task 3.7 -- non-member request rejected without disclosing existence
  it('denies a non-member and does not disclose that the project exists', async () => {
    await expect(auth.authorize(user('outsider'), 'case.read', projectA)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    const error = await auth.authorize(user('outsider'), 'case.read', projectA).catch((e) => e);
    // The same undifferentiated 404 as a genuinely missing project.
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('Not found');
  });

  it('excludes non-member projects from the visible list', async () => {
    expect(await auth.visibleProjectIds(ids['outsider'] as string)).toEqual([projectB]);
    expect(await auth.visibleProjectIds(ids['viewer'] as string)).toEqual([projectA]);
  });

  // Task 3.6 -- every decision resolves through the matrix
  it('applies the role matrix per project', async () => {
    await expect(auth.authorize(user('admin'), 'member.manage', projectA)).resolves.toBeUndefined();
    await expect(auth.authorize(user('lead'), 'case.create', projectA)).resolves.toBeUndefined();
    await expect(auth.authorize(user('tester'), 'run.execute', projectA)).resolves.toBeUndefined();
    await expect(auth.authorize(user('viewer'), 'case.read', projectA)).resolves.toBeUndefined();

    await expect(auth.authorize(user('viewer'), 'case.edit', projectA)).rejects.toThrow();
    await expect(auth.authorize(user('tester'), 'case.create', projectA)).rejects.toThrow();
    await expect(auth.authorize(user('lead'), 'member.manage', projectA)).rejects.toThrow();
  });

  it('scopes a role to one project only', async () => {
    // The admin of A holds no role in B, so admin rights do not leak across projects.
    await expect(auth.authorize(user('admin'), 'case.read', projectB)).rejects.toThrow();
    expect(await auth.can(user('admin'), 'case.read', projectB)).toBe(false);
    expect(await auth.can(user('admin'), 'case.read', projectA)).toBe(true);
  });

  it('confines a token to its project and scopes', async () => {
    const token: Principal = {
      kind: 'token',
      tokenId: 'tok-1',
      projectId: projectA,
      scopes: ['results:write'],
      origin: 'api',
    };
    expect(await auth.can(token, 'run.create', projectA)).toBe(true);
    expect(await auth.can(token, 'run.execute', projectA)).toBe(true);
    // Outside its scope
    expect(await auth.can(token, 'case.edit', projectA)).toBe(false);
    expect(await auth.can(token, 'member.manage', projectA)).toBe(false);
    // Outside its project
    expect(await auth.can(token, 'run.create', projectB)).toBe(false);
  });

  it('has no account privileged by identity', async () => {
    // Revoking the membership removes all access, even for the admin: nothing is hardcoded.
    await db.delete(s.memberships).where(eq(s.memberships.userId, ids['admin'] as string));
    expect(await auth.can(user('admin'), 'case.read', projectA)).toBe(false);
    await db
      .insert(s.memberships)
      .values({ userId: ids['admin'] as string, projectId: projectA, role: 'admin' });
  });
});
