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

suite('coverage routes (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  let projectId: string;
  let cookie: string;
  let rootSuite: string;
  let childSuite: string;
  const caseIds: Record<string, string> = {};

  const P = () => `/api/projects/${projectId}`;
  const as = () => ({ cookies: { tcms_session: cookie } });
  const get = async (path: string) => {
    const r = await app.inject({ method: 'GET', url: `${P()}${path}`, ...as() });
    expect(r.statusCode).toBe(200);
    return r.json();
  };

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `cov${stamp}`, name: 'Coverage Project' })
      .returning();
    projectId = p!.id;

    const [u] = await db
      .insert(s.users)
      .values({
        email: `cov-${stamp}@exasol.com`,
        displayName: 'Cov User',
        passwordHash: await hashPassword('pw'),
      })
      .returning();
    await db.insert(s.memberships).values({ userId: u!.id, projectId, role: 'lead' });

    const [root] = await db.insert(s.suites).values({ projectId, name: 'Root' }).returning();
    rootSuite = root!.id;
    const [child] = await db
      .insert(s.suites)
      .values({ projectId, parentId: rootSuite, name: 'Child' })
      .returning();
    childSuite = child!.id;

    // A deliberately shaped fixture:
    //   automated-1, automated-2   bound to automation           -> automated
    //   manual-1                   executed manually, no binding -> manual
    //   never-1, never-2           never executed, no binding    -> neverExecuted
    //   untagged-1                 no tag at all                 -> the untagged group
    const rows = await db
      .insert(s.testCases)
      .values([
        { projectId, suiteId: rootSuite, ref: 'COV-1', title: 'automated-1' },
        { projectId, suiteId: rootSuite, ref: 'COV-2', title: 'automated-2' },
        { projectId, suiteId: rootSuite, ref: 'COV-3', title: 'manual-1' },
        { projectId, suiteId: childSuite, ref: 'COV-4', title: 'never-1' },
        { projectId, suiteId: childSuite, ref: 'COV-5', title: 'never-2' },
        { projectId, suiteId: childSuite, ref: 'COV-6', title: 'untagged-1' },
      ])
      .returning({ id: s.testCases.id, title: s.testCases.title });
    for (const row of rows) caseIds[row.title] = row.id;

    const tagRows = await db
      .insert(s.tags)
      .values([
        { projectId, name: 'e2e' },
        { projectId, name: 'security' },
      ])
      .returning();
    const e2e = tagRows.find((t) => t.name === 'e2e')!;
    const security = tagRows.find((t) => t.name === 'security')!;
    await db.insert(s.caseTags).values([
      { caseId: caseIds['automated-1']!, tagId: e2e.id },
      { caseId: caseIds['automated-2']!, tagId: e2e.id },
      { caseId: caseIds['manual-1']!, tagId: e2e.id },
      { caseId: caseIds['never-1']!, tagId: security.id },
      { caseId: caseIds['never-2']!, tagId: security.id },
    ]);

    // Two automated cases have bindings.
    await db.insert(s.automationBindings).values([
      { projectId, caseId: caseIds['automated-1']!, fqName: 'a::1', method: 'identifier' },
      { projectId, caseId: caseIds['automated-2']!, fqName: 'a::2', method: 'name_match' },
    ]);

    // A release, with runs that executed automated-1 and manual-1.
    const [release] = await db.insert(s.releases).values({ projectId, name: '8.0.1' }).returning();
    const [runInRelease] = await db
      .insert(s.runs)
      .values({ projectId, name: 'r1', releaseId: release!.id })
      .returning();
    const [runNoRelease] = await db.insert(s.runs).values({ projectId, name: 'r2' }).returning();
    await db.insert(s.runCases).values([
      { runId: runInRelease!.id, caseId: caseIds['automated-1']!, outcome: 'passed' },
      { runId: runInRelease!.id, caseId: caseIds['manual-1']!, outcome: 'failed' },
      { runId: runNoRelease!.id, caseId: caseIds['automated-2']!, outcome: 'passed' },
    ]);

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: `cov-${stamp}@exasol.com`, password: 'pw' },
    });
    cookie = signIn.cookies.find((c) => c.name === 'tcms_session')!.value;
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.users).where(eq(s.users.email, `cov-${stamp}@exasol.com`));
    await pool.end();
  });

  // ---- Task 8.1 -------------------------------------------------------------------------
  it('reports automated, manual, and never-executed counts', async () => {
    const { summary } = await get('/coverage');
    expect(summary).toEqual({ total: 6, automated: 2, manual: 1, neverExecuted: 3 });
  });

  it('the three buckets always sum to the total', async () => {
    const { summary } = await get('/coverage');
    expect(summary.automated + summary.manual + summary.neverExecuted).toBe(summary.total);
  });

  it('counts a case once regardless of how many bindings it has', async () => {
    // A second binding for the same case must not inflate the automated count.
    await db.insert(s.automationBindings).values({
      projectId,
      caseId: caseIds['automated-1']!,
      fqName: 'a::1::duplicate',
      method: 'name_match',
    });
    const { summary } = await get('/coverage');
    expect(summary.automated).toBe(2);
    expect(summary.total).toBe(6);
  });

  it('counts a case once regardless of how many times it has been executed', async () => {
    const [extra] = await db.insert(s.runs).values({ projectId, name: 'r3' }).returning();
    await db
      .insert(s.runCases)
      .values({ runId: extra!.id, caseId: caseIds['manual-1']!, outcome: 'passed' });
    const { summary } = await get('/coverage');
    expect(summary.manual).toBe(1);
    expect(summary.total).toBe(6);
  });

  // ---- Task 8.4: drill-through --------------------------------------------------------
  it('drills through to exactly the cases counted as not automated', async () => {
    const { cases, total } = await get('/coverage/uncovered');
    const { summary } = await get('/coverage');
    expect(total).toBe(summary.manual + summary.neverExecuted);
    expect(cases.map((c: { title: string }) => c.title).sort()).toEqual([
      'manual-1',
      'never-1',
      'never-2',
      'untagged-1',
    ]);
    const manual = cases.find((c: { title: string }) => c.title === 'manual-1');
    const never = cases.find((c: { title: string }) => c.title === 'never-1');
    expect(manual.everExecuted).toBe(true);
    expect(never.everExecuted).toBe(false);
  });

  // ---- Task 8.2: filtering ------------------------------------------------------------
  it('filters by suite subtree', async () => {
    const root = await get(`/coverage?suiteId=${rootSuite}`);
    expect(root.summary.total).toBe(6); // includes the child subtree

    const child = await get(`/coverage?suiteId=${childSuite}`);
    expect(child.summary.total).toBe(3);
    expect(child.summary.automated).toBe(0);
    expect(child.summary.neverExecuted).toBe(3);
  });

  it('filters by tag', async () => {
    const e2e = await get('/coverage?tag=e2e');
    expect(e2e.summary.total).toBe(3);
    expect(e2e.summary.automated).toBe(2);
    expect(e2e.summary.manual).toBe(1);
  });

  it('narrows further when suite and tag are combined', async () => {
    const combined = await get(`/coverage?suiteId=${childSuite}&tag=security`);
    expect(combined.summary.total).toBe(2);
  });

  it('filters by release, counting only cases executed in that release', async () => {
    const release = await get('/coverage?release=8.0.1');
    // automated-1 and manual-1 ran in 8.0.1; automated-2 ran in a run with no release.
    expect(release.summary.total).toBe(2);
    expect(release.summary.automated).toBe(1);
    expect(release.summary.manual).toBe(1);
  });

  it('returns empty rather than failing for an unknown release', async () => {
    const unknown = await get('/coverage?release=does-not-exist');
    expect(unknown.summary.total).toBe(0);
  });

  // ---- Task 8.3: grouping -------------------------------------------------------------
  it('groups by tag with per-tag buckets', async () => {
    const { groups } = await get('/coverage?groupBy=tag');
    const e2e = groups.find((g: { key: string }) => g.key === 'e2e');
    const security = groups.find((g: { key: string }) => g.key === 'security');
    expect(e2e).toMatchObject({ total: 3, automated: 2, manual: 1, neverExecuted: 0 });
    expect(security).toMatchObject({ total: 2, automated: 0, neverExecuted: 2 });
  });

  it('reports untagged cases in an explicit group rather than omitting them', async () => {
    const { groups } = await get('/coverage?groupBy=tag');
    const untagged = groups.find((g: { key: string }) => g.key === '__untagged__');
    expect(untagged).toBeDefined();
    expect(untagged.total).toBe(1);
    expect(untagged.label).toBe('(no tag)');
  });

  it('groups by suite', async () => {
    const { groups } = await get('/coverage?groupBy=suite');
    const root = groups.find((g: { label: string }) => g.label === 'Root');
    const child = groups.find((g: { label: string }) => g.label === 'Child');
    expect(root.total).toBe(3);
    expect(child.total).toBe(3);
    expect(root.total + child.total).toBe(6);
  });

  it('refuses coverage to a caller with no role in the project', async () => {
    const r = await app.inject({ method: 'GET', url: `${P()}/coverage` });
    expect(r.statusCode).toBe(401);
  });
});
