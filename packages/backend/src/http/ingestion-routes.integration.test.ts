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
const fixture = (name: string) =>
  readFileSync(path.join(here, '..', 'ingestion', '__fixtures__', `${name}.xml`), 'utf8');

suite('ingestion routes (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  let projectId: string;
  let otherProjectId: string;
  let leadCookie: string;
  let ciToken: string;
  let readOnlyToken: string;
  let otherProjectToken: string;

  const P = () => `/api/projects/${projectId}`;
  const _withToken = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

  const post = (xml: string, query = '', token = ciToken) =>
    app.inject({
      method: 'POST',
      url: `${P()}/results/junit${query}`,
      payload: xml,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' },
    });

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);

    const [p] = await db
      .insert(s.projects)
      .values({ key: `ing${stamp}`, name: 'Ingest Project' })
      .returning();
    projectId = p!.id;
    const [o] = await db
      .insert(s.projects)
      .values({ key: `ingother${stamp}`, name: 'Other' })
      .returning();
    otherProjectId = o!.id;

    const [lead] = await db
      .insert(s.users)
      .values({
        email: `ing-lead-${stamp}@exasol.com`,
        displayName: 'Ingest Lead',
        passwordHash: await hashPassword('pw'),
      })
      .returning();
    await db.insert(s.memberships).values({ userId: lead!.id, projectId, role: 'lead' });

    // Managed cases the incoming tests will bind to.
    const [suiteRow] = await db.insert(s.suites).values({ projectId, name: 'Root' }).returning();
    await db.insert(s.testCases).values([
      { projectId, suiteId: suiteRow!.id, ref: 'EXA-1000', title: 'Admin SSO' },
      { projectId, suiteId: suiteRow!.id, ref: 'EXA-1001', title: 'User login' },
      { projectId, suiteId: suiteRow!.id, ref: 'EXA-1002', title: 'Broken thing' },
      { projectId, suiteId: suiteRow!.id, ref: 'EXA-2000', title: 'Bound by name' },
    ]);

    const tokens = createTokenService(db);
    ciToken = (await tokens.issue({ projectId, name: 'ci', scopes: ['results:write'] })).secret;
    readOnlyToken = (await tokens.issue({ projectId, name: 'ro', scopes: ['results:read'] }))
      .secret;
    otherProjectToken = (
      await tokens.issue({ projectId: otherProjectId, name: 'other', scopes: ['results:write'] })
    ).secret;

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: `ing-lead-${stamp}@exasol.com`, password: 'pw' },
    });
    leadCookie = signIn.cookies.find((c) => c.name === 'tcms_session')!.value;
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.projects).where(eq(s.projects.id, otherProjectId));
    await db.delete(s.users).where(eq(s.users.email, `ing-lead-${stamp}@exasol.com`));
    await pool.end();
  });

  // ---- Task 6.3: headless upload with scoped token auth -------------------------------
  it('accepts an upload authenticated only by a scoped API token', async () => {
    const response = await post(
      fixture('annotated'),
      '?release=8.0.1&environment=ci&branch=main&commitSha=abc123',
    );
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.ingested).toBe(3);
    expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses an upload with no credentials', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `${P()}/results/junit`,
      payload: fixture('annotated'),
      headers: { 'content-type': 'application/xml' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('refuses a token whose scope does not permit writing results', async () => {
    const r = await post(fixture('annotated'), '', readOnlyToken);
    expect(r.statusCode).toBe(404);
  });

  it('refuses a token scoped to a different project', async () => {
    const r = await post(fixture('annotated'), '', otherProjectToken);
    expect(r.statusCode).toBe(404);
  });

  // ---- Task 6.2 at the HTTP layer: atomic rejection ------------------------------------
  it('rejects a malformed report without persisting anything', async () => {
    const before = await db.select().from(s.runs).where(eq(s.runs.projectId, projectId));
    const r = await post(fixture('pytest').slice(0, 300));
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('INVALID_REPORT');
    const after = await db.select().from(s.runs).where(eq(s.runs.projectId, projectId));
    expect(after.length).toBe(before.length);
  });

  // ---- Task 6.4: run auto-created with metadata, no approval ---------------------------
  it('creates the run automatically and records the supplied metadata', async () => {
    const r = await post(
      fixture('annotated'),
      '?release=8.0.2&environment=staging&branch=release/8.0&commitSha=deadbeef',
    );
    const runId = r.json().runId;

    const [run] = await db.select().from(s.runs).where(eq(s.runs.id, runId));
    expect(run?.kind).toBe('automated');
    expect(run?.branch).toBe('release/8.0');
    expect(run?.commitSha).toBe('deadbeef');
    expect(run?.releaseId).not.toBeNull();
    expect(run?.environmentId).not.toBeNull();
    // Closed on arrival: no approval step gates the results (AC 6).
    expect(run?.status).toBe('closed');
  });

  it('creates the release and environment on first sight rather than failing', async () => {
    await post(fixture('annotated'), '?release=9.9.9-new&environment=brand-new-env');
    const releases = await db
      .select()
      .from(s.releases)
      .where(and(eq(s.releases.projectId, projectId), eq(s.releases.name, '9.9.9-new')));
    const envs = await db
      .select()
      .from(s.environments)
      .where(
        and(eq(s.environments.projectId, projectId), eq(s.environments.name, 'brand-new-env')),
      );
    expect(releases).toHaveLength(1);
    expect(envs).toHaveLength(1);
  });

  it('accepts an upload with no metadata at all', async () => {
    const r = await post(fixture('annotated'));
    expect(r.statusCode).toBe(201);
    const [run] = await db.select().from(s.runs).where(eq(s.runs.id, r.json().runId));
    expect(run?.releaseId).toBeNull();
  });

  // ---- Task 6.5: binding by explicit identifier ----------------------------------------
  it('binds by declared case identifier', async () => {
    const r = await post(fixture('annotated'));
    const body = r.json();
    expect(body.bound.byIdentifier).toBe(3);
    expect(body.unbound).toBe(0);

    const bindings = await db
      .select()
      .from(s.automationBindings)
      .where(eq(s.automationBindings.projectId, projectId));
    expect(bindings.every((b) => b.method === 'identifier')).toBe(true);
    expect(bindings.every((b) => b.promotedAt !== null)).toBe(true);
  });

  it('marks bound cases as automated', async () => {
    await post(fixture('annotated'));
    const [row] = await db
      .select()
      .from(s.testCases)
      .where(and(eq(s.testCases.projectId, projectId), eq(s.testCases.ref, 'EXA-1000')));
    expect(row?.isAutomated).toBe(true);
  });

  // ---- Task 6.6: binding by fully-qualified name ---------------------------------------
  it('binds by fully-qualified name when a binding already exists', async () => {
    const [target] = await db
      .select()
      .from(s.testCases)
      .where(and(eq(s.testCases.projectId, projectId), eq(s.testCases.ref, 'EXA-2000')));
    await db.insert(s.automationBindings).values({
      projectId,
      caseId: target!.id,
      fqName: 'tests.test_sample::test_passes',
      method: 'name_match',
    });

    const r = await post(fixture('pytest'));
    const body = r.json();
    expect(body.bound.byName).toBe(1);

    const results = await db
      .select()
      .from(s.caseResults)
      .where(eq(s.caseResults.runId, body.runId));
    expect(results).toHaveLength(1);
    expect(results[0]?.caseId).toBe(target!.id);
  });

  it('prefers an explicit identifier over an existing name binding', async () => {
    const [wrong] = await db
      .select()
      .from(s.testCases)
      .where(and(eq(s.testCases.projectId, projectId), eq(s.testCases.ref, 'EXA-2000')));
    // A stale name binding pointing at the wrong case.
    await db
      .insert(s.automationBindings)
      .values({
        projectId,
        caseId: wrong!.id,
        fqName: 'tests.test_auth::test_admin_sso',
        method: 'name_match',
      })
      .onConflictDoNothing();

    const r = await post(fixture('annotated'));
    const [correct] = await db
      .select()
      .from(s.testCases)
      .where(and(eq(s.testCases.projectId, projectId), eq(s.testCases.ref, 'EXA-1000')));

    const results = await db
      .select()
      .from(s.caseResults)
      .where(eq(s.caseResults.runId, r.json().runId));
    const sso = results.find((x) => x.caseId === correct!.id);
    expect(sso).toBeDefined();
  });

  // ---- Task 6.7: unbound results retained, never auto-creating cases -------------------
  it('retains unbound tests and creates no case for them', async () => {
    const casesBefore = await db
      .select()
      .from(s.testCases)
      .where(eq(s.testCases.projectId, projectId));

    const r = await post(fixture('playwright'));
    const body = r.json();
    expect(body.unbound).toBeGreaterThan(0);

    const casesAfter = await db
      .select()
      .from(s.testCases)
      .where(eq(s.testCases.projectId, projectId));
    expect(casesAfter.length).toBe(casesBefore.length);

    const unbound = await db
      .select()
      .from(s.unboundResults)
      .where(eq(s.unboundResults.runId, body.runId));
    expect(unbound.length).toBe(body.unbound);
  });

  // ---- Task 6.8: binding method and staleness recorded --------------------------------
  it('records last-seen on every match and promotes a name binding to an identifier', async () => {
    const [target] = await db
      .select()
      .from(s.testCases)
      .where(and(eq(s.testCases.projectId, projectId), eq(s.testCases.ref, 'EXA-1001')));

    // Start as a fragile name binding that has never been seen.
    await db
      .delete(s.automationBindings)
      .where(
        and(
          eq(s.automationBindings.projectId, projectId),
          eq(s.automationBindings.fqName, 'tests.test_auth::test_user_login [EXA-1001]'),
        ),
      );
    await db.insert(s.automationBindings).values({
      projectId,
      caseId: target!.id,
      fqName: 'tests.test_auth::test_user_login [EXA-1001]',
      method: 'name_match',
      lastSeenAt: null,
    });

    await post(fixture('annotated'));

    const [after] = await db
      .select()
      .from(s.automationBindings)
      .where(
        and(
          eq(s.automationBindings.projectId, projectId),
          eq(s.automationBindings.fqName, 'tests.test_auth::test_user_login [EXA-1001]'),
        ),
      );
    // The test now declares an id, so the binding is promoted and its history retained.
    expect(after?.method).toBe('identifier');
    expect(after?.promotedAt).not.toBeNull();
    expect(after?.lastSeenAt).not.toBeNull();
  });

  // ---- Task 6.9: staleness reporting ---------------------------------------------------
  it('reports binding health, distinguishing fragile from stable and flagging stale', async () => {
    const [target] = await db
      .select()
      .from(s.testCases)
      .where(and(eq(s.testCases.projectId, projectId), eq(s.testCases.ref, 'EXA-2000')));
    await db
      .insert(s.automationBindings)
      .values({
        projectId,
        caseId: target!.id,
        fqName: 'tests.legacy::test_forgotten',
        method: 'name_match',
        lastSeenAt: new Date(Date.now() - 90 * 864e5),
      })
      .onConflictDoUpdate({
        target: [s.automationBindings.projectId, s.automationBindings.fqName],
        set: { lastSeenAt: new Date(Date.now() - 90 * 864e5) },
      });

    const r = await app.inject({
      method: 'GET',
      url: `${P()}/automation/bindings`,
      cookies: { tcms_session: leadCookie },
    });
    expect(r.statusCode).toBe(200);
    const report = r.json();

    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.byIdentifier + report.summary.byName).toBe(report.summary.total);
    expect(report.summary.stale).toBeGreaterThanOrEqual(1);
    expect(report.summary.staleThresholdDays).toBe(30);

    const forgotten = report.bindings.find(
      (b: { fqName: string }) => b.fqName === 'tests.legacy::test_forgotten',
    );
    expect(forgotten.isStale).toBe(true);
    expect(forgotten.method).toBe('name_match');

    // Freshly matched identifier bindings are not stale.
    const fresh = report.bindings.find(
      (b: { fqName: string }) => b.fqName === 'tests.test_auth::test_admin_sso',
    );
    expect(fresh.isStale).toBe(false);

    expect(Array.isArray(report.unboundTests)).toBe(true);
  });

  it('refuses the binding report to a caller with no role in the project', async () => {
    const r = await app.inject({ method: 'GET', url: `${P()}/automation/bindings` });
    expect(r.statusCode).toBe(401);
  });
});

suite('concurrent ingestion (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  let projectId: string;
  let token: string;

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `conc${stamp}`, name: 'Concurrent' })
      .returning();
    projectId = p!.id;
    token = (
      await createTokenService(db).issue({
        projectId,
        name: 'ci',
        scopes: ['results:write'],
      })
    ).secret;
    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await pool.end();
  });

  it('survives concurrent first uploads for the same new release', async () => {
    // Several CI jobs finishing at once all see the release as missing. A check-then-insert
    // would race here: every writer but one fails on the unique constraint.
    const releaseName = `concurrent-${stamp}`;
    const uploads = Array.from({ length: 8 }, (_, i) =>
      app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/results/junit?release=${releaseName}&environment=shared-env`,
        payload: `<testsuite name="s"><testcase classname="c" name="t${i}"/></testsuite>`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' },
      }),
    );
    const responses = await Promise.all(uploads);

    expect(responses.map((r) => r.statusCode)).toEqual(Array(8).fill(201));

    // Exactly one release and one environment, shared by every upload.
    const releases = await db
      .select()
      .from(s.releases)
      .where(and(eq(s.releases.projectId, projectId), eq(s.releases.name, releaseName)));
    const envs = await db
      .select()
      .from(s.environments)
      .where(and(eq(s.environments.projectId, projectId), eq(s.environments.name, 'shared-env')));
    expect(releases).toHaveLength(1);
    expect(envs).toHaveLength(1);

    // And every run is attributed to it, so no upload silently lost its release.
    const runs = await db.select().from(s.runs).where(eq(s.runs.projectId, projectId));
    expect(runs).toHaveLength(8);
    expect(runs.every((r) => r.releaseId === releases[0]!.id)).toBe(true);
  });
});
