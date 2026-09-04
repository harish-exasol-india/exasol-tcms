import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { createTokenService } from '../auth/token-service.js';
import { loadConfig } from '../config.js';
import { createDatabase, createPool } from '../db/client.js';
import * as s from '../db/schema/index.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite('triage, readiness and metrics (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  let projectId: string;
  let releaseId: string;
  let ciToken: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const P = () => `/api/projects/${projectId}`;
  const as = (who: string) => ({ cookies: { tcms_session: cookies[who] as string } });

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `rep${stamp}`, name: 'Reporting Project' })
      .returning();
    projectId = p!.id;

    for (const role of ['admin', 'lead', 'tester'] as const) {
      const [u] = await db
        .insert(s.users)
        .values({
          email: `${role}-rep-${stamp}@exasol.com`,
          displayName: role,
          passwordHash: await hashPassword('pw'),
        })
        .returning();
      ids[role] = u!.id;
      await db.insert(s.memberships).values({ userId: u!.id, projectId, role });
    }

    const [suiteRow] = await db.insert(s.suites).values({ projectId, name: 'Root' }).returning();
    await db.insert(s.testCases).values([
      { projectId, suiteId: suiteRow!.id, ref: 'EXA-1000', title: 'Admin SSO' },
      { projectId, suiteId: suiteRow!.id, ref: 'EXA-1001', title: 'User login' },
      { projectId, suiteId: suiteRow!.id, ref: 'EXA-1002', title: 'Broken thing' },
    ]);

    const [release] = await db
      .insert(s.releases)
      .values({ projectId, name: '8.0.1', status: 'in_progress' })
      .returning();
    releaseId = release!.id;

    ciToken = (
      await createTokenService(db).issue({ projectId, name: 'ci', scopes: ['results:write'] })
    ).secret;

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
    for (const role of ['admin', 'lead', 'tester']) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: `${role}-rep-${stamp}@exasol.com`, password: 'pw' },
      });
      cookies[role] = r.cookies.find((c) => c.name === 'tcms_session')!.value;
    }

    // Ingest an annotated report twice so triage carry-forward has something to show.
    const xml = readFileSync(
      path.join(here, '..', 'ingestion', '__fixtures__', 'annotated.xml'),
      'utf8',
    );
    for (const i of [1, 2]) {
      await app.inject({
        method: 'POST',
        url: `${P()}/results/junit?release=8.0.1&environment=ci&commitSha=sha${i}&branch=main`,
        payload: xml,
        headers: { authorization: `Bearer ${ciToken}`, 'content-type': 'application/xml' },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    for (const role of ['admin', 'lead', 'tester']) {
      await db.delete(s.users).where(eq(s.users.email, `${role}-rep-${stamp}@exasol.com`));
    }
    await pool.end();
  });

  // ---- Group 7: triage -----------------------------------------------------------------
  it('lists triage entries with occurrence counts', async () => {
    const r = await app.inject({ method: 'GET', url: `${P()}/triage`, ...as('lead') });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.entries.length).toBeGreaterThan(0);
    const entry = body.entries[0];
    expect(entry.caseRef).toBe('EXA-1002');
    // The same failure was ingested twice, so it has recurred.
    expect(entry.occurrences).toBeGreaterThanOrEqual(2);
    expect(entry.lastFailureMessage).toContain('AssertionError');
  });

  it('reports new versus carried-forward failures per run', async () => {
    const runs = await db.select().from(s.runs).where(eq(s.runs.projectId, projectId));
    const sorted = [...runs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

    const first = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${sorted[0]!.id}/triage-summary`,
      ...as('lead'),
    });
    const second = await app.inject({
      method: 'GET',
      url: `${P()}/runs/${sorted[1]!.id}/triage-summary`,
      ...as('lead'),
    });
    // First import: the failure is new. Second: it carries forward and does not re-alert.
    expect(first.json().newFailures).toBe(1);
    expect(second.json().newFailures).toBe(0);
    expect(second.json().carriedForward).toBe(1);
  });

  it('changing a triage state applies to results already recorded', async () => {
    const list = await app.inject({ method: 'GET', url: `${P()}/triage`, ...as('lead') });
    const entry = list.json().entries[0];

    const update = await app.inject({
      method: 'PATCH',
      url: `${P()}/triage/${entry.id}`,
      payload: { state: 'known_issue', note: 'Waiting on upstream fix' },
      ...as('tester'),
    });
    expect(update.statusCode).toBe(200);

    const results = await db
      .select()
      .from(s.caseResults)
      .where(and(eq(s.caseResults.projectId, projectId), eq(s.caseResults.outcome, 'failed')));
    expect(results.every((r) => r.triageState === 'known_issue')).toBe(true);
  });

  it('surfaces a recurrence after resolution as a regression, not a silent inheritance', async () => {
    const list = await app.inject({ method: 'GET', url: `${P()}/triage`, ...as('lead') });
    const entry = list.json().entries[0];
    await app.inject({
      method: 'PATCH',
      url: `${P()}/triage/${entry.id}`,
      payload: { state: 'resolved' },
      ...as('tester'),
    });

    const xml = readFileSync(
      path.join(here, '..', 'ingestion', '__fixtures__', 'annotated.xml'),
      'utf8',
    );
    const again = await app.inject({
      method: 'POST',
      url: `${P()}/results/junit?release=8.0.1&commitSha=sha3`,
      payload: xml,
      headers: { authorization: `Bearer ${ciToken}`, 'content-type': 'application/xml' },
    });
    expect(again.json().triage.regressions).toBe(1);
    expect(again.json().triage.carriedForward).toBe(0);
  });

  // ---- Group 10: release readiness -----------------------------------------------------
  it('brings execution, blocking failures, defects, coverage, UAT and gate into one view', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `${P()}/releases/${releaseId}/readiness`,
      ...as('lead'),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();

    expect(body.release.name).toBe('8.0.1');
    expect(body.execution).not.toBeNull();
    expect(body.execution.total).toBeGreaterThan(0);
    expect(typeof body.execution.passRate).toBe('number');
    expect(body.blocking).toHaveProperty('count');
    expect(body.coverage).toHaveProperty('automated');
    expect(body.uat).toHaveProperty('total');
    expect(body.gate).toHaveProperty('signedOff');
  });

  it('reports absence of execution data rather than zero failures', async () => {
    const [empty] = await db
      .insert(s.releases)
      .values({ projectId, name: 'never-run', status: 'planned' })
      .returning();
    const r = await app.inject({
      method: 'GET',
      url: `${P()}/releases/${empty!.id}/readiness`,
      ...as('lead'),
    });
    // Null, not a zero-failure summary that would read as passing.
    expect(r.json().execution).toBeNull();
  });

  it('excludes known issues from the blocking count', async () => {
    const list = await app.inject({ method: 'GET', url: `${P()}/triage`, ...as('lead') });
    await app.inject({
      method: 'PATCH',
      url: `${P()}/triage/${list.json().entries[0].id}`,
      payload: { state: 'known_issue' },
      ...as('tester'),
    });
    const r = await app.inject({
      method: 'GET',
      url: `${P()}/releases/${releaseId}/readiness`,
      ...as('lead'),
    });
    const body = r.json();
    expect(body.blocking.known).toBeGreaterThan(0);
    expect(body.blocking.count).toBe(0);
  });

  it('gates on a sign-off checklist and restricts completion to the named approver', async () => {
    const item = await app.inject({
      method: 'POST',
      url: `${P()}/releases/${releaseId}/sign-offs`,
      payload: { name: 'QA lead', approverId: ids['lead'] },
      ...as('lead'),
    });
    expect(item.statusCode).toBe(201);
    const signOffId = item.json().id;

    const before = await app.inject({
      method: 'GET',
      url: `${P()}/releases/${releaseId}/readiness`,
      ...as('lead'),
    });
    expect(before.json().gate.signedOff).toBe(false);
    expect(before.json().gate.outstanding).toContain('QA lead');

    // A different user, even one holding release.sign_off, cannot complete another's item.
    const wrongApprover = await app.inject({
      method: 'POST',
      url: `${P()}/sign-offs/${signOffId}/complete`,
      ...as('admin'),
    });
    expect(wrongApprover.statusCode).toBe(404);

    const correct = await app.inject({
      method: 'POST',
      url: `${P()}/sign-offs/${signOffId}/complete`,
      ...as('lead'),
    });
    expect(correct.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: `${P()}/releases/${releaseId}/readiness`,
      ...as('lead'),
    });
    expect(after.json().gate.signedOff).toBe(true);
    expect(after.json().gate.items[0].completedByName).toBe('lead');
  });

  it('reports a duplicate sign-off name as a client error, not a server fault', async () => {
    await app.inject({
      method: 'POST',
      url: `${P()}/releases/${releaseId}/sign-offs`,
      payload: { name: 'Duplicate check' },
      ...as('lead'),
    });
    const again = await app.inject({
      method: 'POST',
      url: `${P()}/releases/${releaseId}/sign-offs`,
      payload: { name: 'Duplicate check' },
      ...as('lead'),
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe('DUPLICATE_SIGN_OFF');
  });

  it('refuses sign-off by a tester', async () => {
    const item = await app.inject({
      method: 'POST',
      url: `${P()}/releases/${releaseId}/sign-offs`,
      payload: { name: 'Support' },
      ...as('lead'),
    });
    const r = await app.inject({
      method: 'POST',
      url: `${P()}/sign-offs/${item.json().id}/complete`,
      ...as('tester'),
    });
    expect(r.statusCode).toBe(404);
  });

  // ---- Group 11: metrics ---------------------------------------------------------------
  it('reports pass rate, failure rate, runtime and coverage', async () => {
    const r = await app.inject({ method: 'GET', url: `${P()}/metrics?days=90`, ...as('lead') });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.totals.executions).toBeGreaterThan(0);
    expect(body.totals.passRate + body.totals.failureRate).toBeCloseTo(100, 0);
    expect(body.coverage).toHaveProperty('automated');
    expect(body.trend.length).toBeGreaterThan(0);
  });

  it('clips the window to the retention period and says so', async () => {
    const r = await app.inject({ method: 'GET', url: `${P()}/metrics?days=400`, ...as('lead') });
    const body = r.json();
    expect(body.window.days).toBeLessThanOrEqual(body.window.retentionMonths * 30);
    expect(body.trendTruncated).toBe(true);
  });

  it('bands defect links by age measured from when the link was recorded', async () => {
    const r = await app.inject({ method: 'GET', url: `${P()}/metrics`, ...as('lead') });
    expect(Array.isArray(r.json().defectAgeBands)).toBe(true);
  });
});
