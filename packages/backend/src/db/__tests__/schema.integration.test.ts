/**
 * Integration tests against a live Postgres. Skipped when TEST_DATABASE_URL is unset so
 * that the unit suite still runs without a database.
 */
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool } from '../client.js';
import * as s from '../schema/index.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('schema (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof createDatabase>;
  let projectId: string;
  let userId: string;

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [project] = await db
      .insert(s.projects)
      .values({ key: `p-${Date.now()}`, name: 'Schema Fixture' })
      .returning();
    const [user] = await db
      .insert(s.users)
      .values({ email: `u-${Date.now()}@exasol.com`, displayName: 'Fixture User' })
      .returning();
    projectId = project!.id;
    userId = user!.id;
  });

  afterAll(async () => {
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.users).where(eq(s.users.id, userId));
    await pool.end();
  });

  // Task 2.2
  it('stores a nested suite tree and queries cases through it', async () => {
    const [product] = await db
      .insert(s.suites)
      .values({ projectId, name: 'Product A' })
      .returning();
    const [component] = await db
      .insert(s.suites)
      .values({ projectId, parentId: product!.id, name: 'Component X' })
      .returning();
    const [module] = await db
      .insert(s.suites)
      .values({ projectId, parentId: component!.id, name: 'Module M' })
      .returning();

    await db.insert(s.testCases).values({
      projectId,
      suiteId: module!.id,
      ref: 'EXA-1',
      title: 'Nested case',
      priority: 'high',
      risk: 'high',
      ownerId: userId,
    });

    const found = await db.query.suites.findFirst({
      where: eq(s.suites.id, module!.id),
      with: { testCases: true, parent: true },
    });

    expect(found?.name).toBe('Module M');
    expect(found?.parent?.name).toBe('Component X');
    expect(found?.testCases).toHaveLength(1);
    expect(found?.testCases[0]?.title).toBe('Nested case');
    expect(found?.testCases[0]?.priority).toBe('high');
  });

  // Task 2.3
  it('links a case to a shared step and carries a custom field value', async () => {
    const [suiteRow] = await db.insert(s.suites).values({ projectId, name: 'S' }).returning();
    const [shared] = await db
      .insert(s.sharedSteps)
      .values({ projectId, name: 'Log in as admin' })
      .returning();
    await db
      .insert(s.sharedStepItems)
      .values({ sharedStepId: shared!.id, position: 1, action: 'Open /login', expected: 'Form' });

    await db.insert(s.customFieldDefinitions).values({
      projectId,
      key: 'component_owner',
      label: 'Component Owner',
      type: 'text',
    });

    const [testCase] = await db
      .insert(s.testCases)
      .values({
        projectId,
        suiteId: suiteRow!.id,
        ref: 'EXA-2',
        title: 'Case with shared step',
        customFields: { component_owner: 'team-storage', reviewed: true, order: 3 },
      })
      .returning();

    await db.insert(s.caseSteps).values([
      { caseId: testCase!.id, position: 1, sharedStepId: shared!.id },
      { caseId: testCase!.id, position: 2, action: 'Open cases', expected: 'List renders' },
    ]);

    const loaded = await db.query.testCases.findFirst({
      where: eq(s.testCases.id, testCase!.id),
      with: { steps: { orderBy: (st, { asc }) => [asc(st.position)] } },
    });

    expect(loaded?.customFields).toEqual({
      component_owner: 'team-storage',
      reviewed: true,
      order: 3,
    });
    expect(loaded?.steps).toHaveLength(2);
    expect(loaded?.steps[0]?.sharedStepId).toBe(shared!.id);
    expect(loaded?.steps[0]?.action).toBeNull();
    expect(loaded?.steps[1]?.action).toBe('Open cases');
  });

  // Task 2.4
  it('records actor, timestamp, changed fields and origin on a history entry', async () => {
    const [suiteRow] = await db.insert(s.suites).values({ projectId, name: 'H' }).returning();
    const [testCase] = await db
      .insert(s.testCases)
      .values({ projectId, suiteId: suiteRow!.id, ref: 'EXA-3', title: 'Original' })
      .returning();

    const before = new Date();
    await db.insert(s.caseHistory).values({
      caseId: testCase!.id,
      actorId: userId,
      origin: 'mcp',
      action: 'updated',
      changedFields: ['title', 'priority'],
      before: { title: 'Original' },
      after: { title: 'Renamed' },
    });

    const [entry] = await db
      .select()
      .from(s.caseHistory)
      .where(eq(s.caseHistory.caseId, testCase!.id));

    expect(entry?.actorId).toBe(userId);
    expect(entry?.origin).toBe('mcp');
    expect(entry?.changedFields).toEqual(['title', 'priority']);
    expect(entry?.occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('enforces the per-project case reference uniqueness constraint', async () => {
    const [suiteRow] = await db.insert(s.suites).values({ projectId, name: 'U' }).returning();
    await db
      .insert(s.testCases)
      .values({ projectId, suiteId: suiteRow!.id, ref: 'EXA-DUP', title: 'First' });
    await expect(
      db
        .insert(s.testCases)
        .values({ projectId, suiteId: suiteRow!.id, ref: 'EXA-DUP', title: 'Second' }),
    ).rejects.toThrow();
  });

  it('converges duplicate tag names within a project', async () => {
    await db.insert(s.tags).values({ projectId, name: 'end-to-end' });
    await expect(db.insert(s.tags).values({ projectId, name: 'end-to-end' })).rejects.toThrow();
    const rows = await db
      .select()
      .from(s.tags)
      .where(and(eq(s.tags.projectId, projectId), eq(s.tags.name, 'end-to-end')));
    expect(rows).toHaveLength(1);
  });
});
