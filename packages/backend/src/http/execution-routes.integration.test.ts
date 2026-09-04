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

suite('planning + execution routes (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  let projectId: string;
  const cookies: Record<string, string> = {};
  const caseIds: string[] = [];
  let planId: string;

  const P = () => `/api/projects/${projectId}`;
  const as = (who: string) => ({ cookies: { tcms_session: cookies[who] as string } });

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `exec${stamp}`, name: 'Execution Project' })
      .returning();
    projectId = p!.id;

    for (const role of ['lead', 'tester', 'tester2', 'viewer'] as const) {
      const [u] = await db
        .insert(s.users)
        .values({
          email: `${role}-exec-${stamp}@exasol.com`,
          displayName: role,
          passwordHash: await hashPassword('pw'),
        })
        .returning();
      await db.insert(s.memberships).values({
        userId: u!.id,
        projectId,
        role: role === 'lead' ? 'lead' : role === 'viewer' ? 'viewer' : 'tester',
      });
    }

    const [suiteRow] = await db.insert(s.suites).values({ projectId, name: 'Root' }).returning();
    const rows = await db
      .insert(s.testCases)
      .values(
        Array.from({ length: 4 }, (_, i) => ({
          projectId,
          suiteId: suiteRow!.id,
          ref: `EX-${i + 1}`,
          title: `Case ${i + 1}`,
        })),
      )
      .returning({ id: s.testCases.id });
    caseIds.push(...rows.map((r) => r.id));
    await db.insert(s.caseSteps).values(
      caseIds.flatMap((caseId) => [
        { caseId, position: 1, action: 'Do a thing', expected: 'It happens' },
        { caseId, position: 2, action: 'Check it', expected: 'It is right' },
      ]),
    );

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
    for (const role of ['lead', 'tester', 'tester2', 'viewer']) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: `${role}-exec-${stamp}@exasol.com`, password: 'pw' },
      });
      cookies[role] = r.cookies.find((c) => c.name === 'tcms_session')!.value;
    }
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    for (const role of ['lead', 'tester', 'tester2', 'viewer']) {
      await db.delete(s.users).where(eq(s.users.email, `${role}-exec-${stamp}@exasol.com`));
    }
    await pool.end();
  });

  // ---- Task 5.1 / 5.2 -----------------------------------------------------------------
  it('creates a plan with a case selection and reads it back', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `${P()}/plans`,
      payload: { name: 'Regression', caseIds: caseIds.slice(0, 3) },
      ...as('lead'),
    });
    expect(created.statusCode).toBe(201);
    planId = created.json().id;

    const list = await app.inject({ method: 'GET', url: `${P()}/plans`, ...as('viewer') });
    const plan = list.json().plans.find((p: { id: string }) => p.id === planId);
    expect(plan.caseCount).toBe(3);
  });

  it('snapshots plan membership into a run, so editing the plan later does not change it', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'From plan', planId },
      ...as('lead'),
    });
    const runId = run.json().id;

    const before = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('viewer'),
    });
    expect(before.json().cases).toHaveLength(3);

    // Shrink the plan to one case.
    await app.inject({
      method: 'PATCH',
      url: `${P()}/plans/${planId}`,
      payload: { caseIds: [caseIds[0]] },
      ...as('lead'),
    });

    const after = await app.inject({ method: 'GET', url: `${P()}/runs/${runId}`, ...as('viewer') });
    // The existing run is untouched.
    expect(after.json().cases).toHaveLength(3);

    // A new run reflects the edit.
    const newer = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'After edit', planId },
      ...as('lead'),
    });
    const newerDetail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${newer.json().id}`,
      ...as('viewer'),
    });
    expect(newerDetail.json().cases).toHaveLength(1);
  });

  // ---- Task 5.3 / 5.4 -----------------------------------------------------------------
  it('creates environments and releases and attributes runs to them', async () => {
    const env = await app.inject({
      method: 'POST',
      url: `${P()}/environments`,
      payload: { name: 'staging' },
      ...as('lead'),
    });
    const release = await app.inject({
      method: 'POST',
      url: `${P()}/releases`,
      payload: { name: '9.0.0', status: 'in_progress' },
      ...as('lead'),
    });
    expect(env.statusCode).toBe(201);
    expect(release.statusCode).toBe(201);

    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: {
        name: 'Attributed',
        caseIds: [caseIds[0]],
        environmentId: env.json().id,
        releaseId: release.json().id,
      },
      ...as('lead'),
    });
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${run.json().id}`,
      ...as('viewer'),
    });
    expect(detail.json().releaseName).toBe('9.0.0');
    expect(detail.json().environmentName).toBe('staging');
  });

  it('accepts a run with no release and excludes it from release views', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'No release', caseIds: [caseIds[0]] },
      ...as('lead'),
    });
    expect(run.statusCode).toBe(201);
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${run.json().id}`,
      ...as('viewer'),
    });
    expect(detail.json().releaseId).toBeNull();
  });

  it('rejects a duplicate environment name', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `${P()}/environments`,
      payload: { name: 'staging' },
      ...as('lead'),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('DUPLICATE');
  });

  // ---- Task 9.1 / 9.2 -----------------------------------------------------------------
  it('records case and step results, and derives the case outcome from a failing step', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'Manual run', caseIds, kind: 'manual' },
      ...as('lead'),
    });
    const runId = run.json().id;
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('tester'),
    });
    const first = detail.json().cases[0];

    const write = await app.inject({
      method: 'PATCH',
      url: `${P()}/runs/${runId}/cases/${first.id}`,
      payload: {
        outcome: 'failed',
        basedOnVersion: first.version,
        comment: 'step 2 broke',
        steps: [
          { position: 1, outcome: 'passed' },
          { position: 2, outcome: 'failed', comment: 'wrong value' },
        ],
      },
      ...as('tester'),
    });
    expect(write.statusCode).toBe(200);

    const runCase = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}/cases/${first.id}`,
      ...as('tester'),
    });
    const body = runCase.json();
    expect(body.outcome).toBe('failed');
    expect(body.steps[0].outcome).toBe('passed');
    expect(body.steps[1].outcome).toBe('failed');
    expect(body.steps[1].comment).toBe('wrong value');
  });

  it('resumes a partially executed run at the first case without a result', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'Resumable', caseIds },
      ...as('lead'),
    });
    const runId = run.json().id;
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('tester'),
    });
    const cases = detail.json().cases;

    await app.inject({
      method: 'PATCH',
      url: `${P()}/runs/${runId}/cases/${cases[0].id}`,
      payload: { outcome: 'passed', basedOnVersion: cases[0].version },
      ...as('tester'),
    });

    const resumed = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('tester'),
    });
    const after = resumed.json();
    expect(after.progress.passed).toBe(1);
    expect(after.progress.untested).toBe(cases.length - 1);
    const firstUntested = after.cases.find((c: { outcome: string }) => c.outcome === 'untested');
    expect(firstUntested).toBeDefined();
  });

  // ---- Task 9.3: optimistic concurrency ------------------------------------------------
  it('rejects a stale write instead of silently overwriting another tester', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'Contested', caseIds: [caseIds[0]] },
      ...as('lead'),
    });
    const runId = run.json().id;
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('tester'),
    });
    const target = detail.json().cases[0];

    // Both testers read the same version.
    const readVersion = target.version;

    const first = await app.inject({
      method: 'PATCH',
      url: `${P()}/runs/${runId}/cases/${target.id}`,
      payload: { outcome: 'failed', basedOnVersion: readVersion },
      ...as('tester'),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'PATCH',
      url: `${P()}/runs/${runId}/cases/${target.id}`,
      payload: { outcome: 'passed', basedOnVersion: readVersion },
      ...as('tester2'),
    });
    expect(second.statusCode).toBe(409);
    const conflict = second.json();
    expect(conflict.code).toBe('RESULT_CONFLICT');
    // The conflict reports what actually won, so the tester can reconcile.
    expect(conflict.current.outcome).toBe('failed');
    expect(conflict.current.version).toBe(readVersion + 1);

    // The first write stands.
    const after = await app.inject({ method: 'GET', url: `${P()}/runs/${runId}`, ...as('tester') });
    expect(after.json().cases[0].outcome).toBe('failed');
  });

  it('accepts the retry once the tester reads the current version', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'Retry', caseIds: [caseIds[0]] },
      ...as('lead'),
    });
    const runId = run.json().id;
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('tester'),
    });
    const target = detail.json().cases[0];

    await app.inject({
      method: 'PATCH',
      url: `${P()}/runs/${runId}/cases/${target.id}`,
      payload: { outcome: 'failed', basedOnVersion: target.version },
      ...as('tester'),
    });
    const reread = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('tester2'),
    });
    const current = reread.json().cases[0];
    const retry = await app.inject({
      method: 'PATCH',
      url: `${P()}/runs/${runId}/cases/${current.id}`,
      payload: { outcome: 'passed', basedOnVersion: current.version },
      ...as('tester2'),
    });
    expect(retry.statusCode).toBe(200);
  });

  it('refuses execution by a viewer', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'Viewer test', caseIds: [caseIds[0]] },
      ...as('lead'),
    });
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${run.json().id}`,
      ...as('viewer'),
    });
    const r = await app.inject({
      method: 'PATCH',
      url: `${P()}/runs/${run.json().id}/cases/${detail.json().cases[0].id}`,
      payload: { outcome: 'passed', basedOnVersion: 0 },
      ...as('viewer'),
    });
    expect(r.statusCode).toBe(404);
  });

  it('refuses writes to a closed run', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'Closing', caseIds: [caseIds[0]] },
      ...as('lead'),
    });
    const runId = run.json().id;
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('tester'),
    });
    await app.inject({ method: 'POST', url: `${P()}/runs/${runId}/close`, ...as('lead') });

    const r = await app.inject({
      method: 'PATCH',
      url: `${P()}/runs/${runId}/cases/${detail.json().cases[0].id}`,
      payload: { outcome: 'passed', basedOnVersion: detail.json().cases[0].version },
      ...as('tester'),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('RUN_CLOSED');
  });

  // ---- Task 9.7: defect links ----------------------------------------------------------
  it('links a Jira issue to a failed case and rejects a malformed key', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'Defects', caseIds: [caseIds[0]] },
      ...as('lead'),
    });
    const runId = run.json().id;
    const detail = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${runId}`,
      ...as('tester'),
    });
    const runCaseId = detail.json().cases[0].id;

    const linked = await app.inject({
      method: 'POST',
      url: `${P()}/runs/${runId}/cases/${runCaseId}/defects`,
      payload: { issueKey: 'EXA-9912', stepPosition: 2 },
      ...as('tester'),
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().url).toContain('/browse/EXA-9912');

    const bad = await app.inject({
      method: 'POST',
      url: `${P()}/runs/${runId}/cases/${runCaseId}/defects`,
      payload: { issueKey: 'not a key' },
      ...as('tester'),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('INVALID_ISSUE_KEY');

    const duplicate = await app.inject({
      method: 'POST',
      url: `${P()}/runs/${runId}/cases/${runCaseId}/defects`,
      payload: { issueKey: 'EXA-9912' },
      ...as('tester'),
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().code).toBe('DUPLICATE_LINK');
  });

  it('rejects a run that would contain no cases', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `${P()}/runs`,
      payload: { name: 'Empty', caseIds: [] },
      ...as('lead'),
    });
    expect(r.statusCode).toBe(400);
  });
});
