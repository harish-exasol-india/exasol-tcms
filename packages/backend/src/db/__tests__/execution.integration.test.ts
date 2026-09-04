import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool } from '../client.js';
import * as s from '../schema/index.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('execution schema (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof createDatabase>;
  let projectId: string;
  let userId: string;
  let suiteId: string;
  let caseId: string;

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `exec-${Date.now()}`, name: 'Execution Fixture' })
      .returning();
    projectId = p!.id;
    const [u] = await db
      .insert(s.users)
      .values({ email: `exec-${Date.now()}@exasol.com`, displayName: 'Exec User' })
      .returning();
    userId = u!.id;
    const [su] = await db.insert(s.suites).values({ projectId, name: 'Root' }).returning();
    suiteId = su!.id;
    const [c] = await db
      .insert(s.testCases)
      .values({ projectId, suiteId, ref: 'EXEC-1', title: 'Case' })
      .returning();
    caseId = c!.id;
  });

  afterAll(async () => {
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.users).where(eq(s.users.id, userId));
    await pool.end();
  });

  // Task 2.5
  it('stores a plan selecting cases, readable back', async () => {
    const [plan] = await db
      .insert(s.testPlans)
      .values({ projectId, name: 'Regression', createdBy: userId })
      .returning();
    await db.insert(s.testPlanCases).values({ planId: plan!.id, caseId });

    const loaded = await db.query.testPlans.findFirst({
      where: eq(s.testPlans.id, plan!.id),
      with: { planCases: { with: { testCase: true } } },
    });
    expect(loaded?.name).toBe('Regression');
    expect(loaded?.planCases).toHaveLength(1);
    expect(loaded?.planCases[0]?.testCase.ref).toBe('EXEC-1');
  });

  it('stores environments and releases with sign-off items', async () => {
    const [env] = await db
      .insert(s.environments)
      .values({ projectId, name: 'staging' })
      .returning();
    const [rel] = await db
      .insert(s.releases)
      .values({ projectId, name: '8.0.1', status: 'in_progress' })
      .returning();
    await db
      .insert(s.releaseSignOffs)
      .values({ releaseId: rel!.id, name: 'QA lead', approverId: userId });

    const loaded = await db.query.releases.findFirst({
      where: eq(s.releases.id, rel!.id),
      with: { signOffs: true },
    });
    expect(env!.name).toBe('staging');
    expect(loaded?.status).toBe('in_progress');
    expect(loaded?.signOffs[0]?.completedAt).toBeNull();
  });

  // Task 2.6
  it('stores a run with case and step results, queryable together', async () => {
    const [run] = await db
      .insert(s.runs)
      .values({ projectId, name: 'Run 1', kind: 'manual', createdBy: userId })
      .returning();
    const [runCase] = await db
      .insert(s.runCases)
      .values({ runId: run!.id, caseId, assigneeId: userId, outcome: 'failed' })
      .returning();
    await db.insert(s.stepResults).values([
      { runCaseId: runCase!.id, stepPosition: 1, outcome: 'passed', recordedBy: userId },
      { runCaseId: runCase!.id, stepPosition: 2, outcome: 'failed', recordedBy: userId },
    ]);
    await db.insert(s.caseResults).values({
      runCaseId: runCase!.id,
      runId: run!.id,
      projectId,
      caseId,
      outcome: 'failed',
      durationMs: 1234,
      failureMessage: 'assertion failed',
      origin: 'ui',
      recordedBy: userId,
    });

    const loaded = await db.query.runs.findFirst({
      where: eq(s.runs.id, run!.id),
      with: { runCases: { with: { stepResults: true } } },
    });
    expect(loaded?.runCases[0]?.outcome).toBe('failed');
    expect(loaded?.runCases[0]?.stepResults).toHaveLength(2);

    const results = await db.select().from(s.caseResults).where(eq(s.caseResults.runId, run!.id));
    expect(results[0]?.durationMs).toBe(1234);
  });

  it('rejects a second result for the same step position in a run case', async () => {
    const [run] = await db.insert(s.runs).values({ projectId, name: 'Run 2' }).returning();
    const [rc] = await db.insert(s.runCases).values({ runId: run!.id, caseId }).returning();
    await db
      .insert(s.stepResults)
      .values({ runCaseId: rc!.id, stepPosition: 1, outcome: 'passed' });
    await expect(
      db.insert(s.stepResults).values({ runCaseId: rc!.id, stepPosition: 1, outcome: 'failed' }),
    ).rejects.toThrow();
  });

  // Task 2.7
  it('attaches evidence, a defect link, and triage to the right result', async () => {
    const [run] = await db.insert(s.runs).values({ projectId, name: 'Run 3' }).returning();
    const [rc] = await db.insert(s.runCases).values({ runId: run!.id, caseId }).returning();

    await db.insert(s.attachments).values({
      runId: run!.id,
      runCaseId: rc!.id,
      stepPosition: 2,
      objectKey: `runs/${run!.id}/shot-${Date.now()}.png`,
      filename: 'shot.png',
      contentType: 'image/png',
      sizeBytes: 4096,
      uploadedBy: userId,
    });
    await db.insert(s.defectLinks).values({
      runCaseId: rc!.id,
      stepPosition: 2,
      issueKey: 'EXA-9912',
      linkedBy: userId,
    });
    await db.insert(s.failureTriage).values({
      projectId,
      caseId,
      signature: `sig-${Date.now()}`,
      state: 'known_issue',
      updatedBy: userId,
    });

    const att = await db.select().from(s.attachments).where(eq(s.attachments.runCaseId, rc!.id));
    const def = await db.select().from(s.defectLinks).where(eq(s.defectLinks.runCaseId, rc!.id));
    const tri = await db.select().from(s.failureTriage).where(eq(s.failureTriage.caseId, caseId));
    expect(att[0]?.stepPosition).toBe(2);
    expect(att[0]?.sizeBytes).toBe(4096);
    expect(def[0]?.issueKey).toBe('EXA-9912');
    expect(def[0]?.linkedAt).toBeInstanceOf(Date);
    expect(tri[0]?.state).toBe('known_issue');
  });

  it('prevents the same issue being linked twice to one run case', async () => {
    const [run] = await db.insert(s.runs).values({ projectId, name: 'Run 4' }).returning();
    const [rc] = await db.insert(s.runCases).values({ runId: run!.id, caseId }).returning();
    await db.insert(s.defectLinks).values({ runCaseId: rc!.id, issueKey: 'EXA-1' });
    await expect(
      db.insert(s.defectLinks).values({ runCaseId: rc!.id, issueKey: 'EXA-1' }),
    ).rejects.toThrow();
  });

  // Task 2.8
  it('represents both binding methods and records staleness', async () => {
    const [byName] = await db
      .insert(s.automationBindings)
      .values({
        projectId,
        caseId,
        fqName: 'tests/e2e/test_sso.py::test_admin',
        method: 'name_match',
        lastSeenAt: new Date(),
      })
      .returning();
    const [byId] = await db
      .insert(s.automationBindings)
      .values({
        projectId,
        caseId,
        fqName: 'tests/e2e/test_login.py::test_user',
        method: 'identifier',
        promotedAt: new Date(),
      })
      .returning();

    expect(byName!.method).toBe('name_match');
    expect(byName!.lastSeenAt).toBeInstanceOf(Date);
    expect(byId!.method).toBe('identifier');
    expect(byId!.promotedAt).toBeInstanceOf(Date);
  });

  it('retains an unbound result without creating a case', async () => {
    const [run] = await db.insert(s.runs).values({ projectId, name: 'Run 5' }).returning();
    const before = await db.select().from(s.testCases).where(eq(s.testCases.projectId, projectId));
    await db.insert(s.unboundResults).values({
      projectId,
      runId: run!.id,
      fqName: 'tests/new/test_unknown.py::test_thing',
      outcome: 'passed',
    });
    const after = await db.select().from(s.testCases).where(eq(s.testCases.projectId, projectId));
    const unbound = await db
      .select()
      .from(s.unboundResults)
      .where(eq(s.unboundResults.runId, run!.id));
    expect(unbound).toHaveLength(1);
    expect(after.length).toBe(before.length);
  });
});
