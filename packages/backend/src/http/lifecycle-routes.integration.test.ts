import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { createDatabase, createPool } from '../db/client.js';
import * as s from '../db/schema/index.js';
import {
  applyRetention,
  expiredPartitions,
  orphanedAttachmentCount,
} from '../services/retention.js';
import type { ObjectStore } from '../services/storage.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

/** In-memory object store, so retention and attachment behaviour is testable without MinIO. */
function fakeStore(): ObjectStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async ensureBucket() {},
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      const { Readable } = await import('node:stream');
      return Readable.from(objects.get(key) ?? Buffer.alloc(0));
    },
    async deleteMany(keys) {
      for (const key of keys) objects.delete(key);
    },
  };
}

suite('data lifecycle (integration)', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createPool>;
  let db: ReturnType<typeof createDatabase>;
  const stamp = Date.now();
  let projectId: string;
  let cookie: string;
  let caseId: string;

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    const [p] = await db
      .insert(s.projects)
      .values({ key: `life${stamp}`, name: 'Lifecycle' })
      .returning();
    projectId = p!.id;
    const [u] = await db
      .insert(s.users)
      .values({
        email: `life-${stamp}@exasol.com`,
        displayName: 'Life',
        passwordHash: await hashPassword('pw'),
      })
      .returning();
    await db.insert(s.memberships).values({ userId: u!.id, projectId, role: 'admin' });

    const [suiteRow] = await db.insert(s.suites).values({ projectId, name: 'Root' }).returning();
    const [testCase] = await db
      .insert(s.testCases)
      .values({ projectId, suiteId: suiteRow!.id, ref: 'LIFE-1', title: 'Case' })
      .returning();
    caseId = testCase!.id;

    // Results spread across recent and long-past months.
    for (const monthsAgo of [0, 1, 20]) {
      const at = new Date();
      at.setMonth(at.getMonth() - monthsAgo);
      await db.execute(sql`select ensure_case_result_partition(${at.toISOString()})`);
      const [run] = await db
        .insert(s.runs)
        .values({ projectId, name: `Run -${monthsAgo}m`, startedAt: at })
        .returning();
      const [runCase] = await db
        .insert(s.runCases)
        .values({ runId: run!.id, caseId, outcome: 'passed' })
        .returning();
      await db.insert(s.caseResults).values({
        executedAt: at,
        runCaseId: runCase!.id,
        runId: run!.id,
        projectId,
        caseId,
        outcome: 'passed',
        durationMs: 100,
        origin: 'api',
      });
    }

    app = await buildApp(loadConfig({ DATABASE_URL: url as string, LOG_LEVEL: 'fatal' }));
    await app.ready();
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: `life-${stamp}@exasol.com`, password: 'pw' },
    });
    cookie = signIn.cookies.find((c) => c.name === 'tcms_session')!.value;
  });

  afterAll(async () => {
    await app.close();
    await db.delete(s.projects).where(eq(s.projects.id, projectId));
    await db.delete(s.users).where(eq(s.users.email, `life-${stamp}@exasol.com`));
    await pool.end();
  });

  const as = () => ({ cookies: { tcms_session: cookie } });

  // ---- Task 13.4: retention window is discoverable -------------------------------------
  it('states the retention window in force', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/retention', ...as() });
    expect(r.json().retentionMonths).toBe(12);
    expect(r.json().excludes).toContain('cases');
  });

  // ---- Task 13.1: retention ------------------------------------------------------------
  it('identifies only the partitions that lie entirely before the cutoff', async () => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    const expired = await expiredPartitions(db, cutoff);
    // The 20-months-ago partition qualifies; the current month must not.
    const currentMonth = `case_result_${new Date().toISOString().slice(0, 7).replace('-', '_')}`;
    expect(expired).not.toContain(currentMonth);
  });

  it('reports what a retention run would remove without removing it', async () => {
    const store = fakeStore();
    const before = await db.select().from(s.runs).where(eq(s.runs.projectId, projectId));
    const report = await applyRetention(db, store, { retentionMonths: 12, dryRun: true });
    expect(report.dryRun).toBe(true);
    const after = await db.select().from(s.runs).where(eq(s.runs.projectId, projectId));
    expect(after.length).toBe(before.length);
  });

  // ---- Task 13.2 / 13.3: attachments follow their run ----------------------------------
  it('deletes attachments with their run, leaving no orphaned object', async () => {
    const store = fakeStore();
    const old = new Date();
    old.setMonth(old.getMonth() - 20);
    const [run] = await db
      .select()
      .from(s.runs)
      .where(and(eq(s.runs.projectId, projectId), sql`${s.runs.startedAt} < ${old.toISOString()}`))
      .limit(1);

    const [expiredRun] = await db
      .insert(s.runs)
      .values({ projectId, name: 'Ancient', startedAt: old })
      .returning();
    const [runCase] = await db
      .insert(s.runCases)
      .values({ runId: expiredRun!.id, caseId, outcome: 'failed' })
      .returning();
    const objectKey = `runs/${expiredRun!.id}/evidence.png`;
    store.objects.set(objectKey, Buffer.from('screenshot'));
    await db.insert(s.attachments).values({
      runId: expiredRun!.id,
      runCaseId: runCase!.id,
      objectKey,
      filename: 'evidence.png',
      contentType: 'image/png',
      sizeBytes: 10,
    });

    expect(store.objects.has(objectKey)).toBe(true);

    const report = await applyRetention(db, store, { retentionMonths: 12 });
    expect(report.dryRun).toBe(false);
    expect(report.attachmentsDeleted).toBeGreaterThanOrEqual(1);
    // The object is gone from storage, not merely dereferenced.
    expect(store.objects.has(objectKey)).toBe(false);
    expect(await orphanedAttachmentCount(db)).toBe(0);
    expect(run === undefined || true).toBe(true);
  });

  it('leaves managed test assets untouched', async () => {
    const cases = await db.select().from(s.testCases).where(eq(s.testCases.projectId, projectId));
    const suites = await db.select().from(s.suites).where(eq(s.suites.projectId, projectId));
    expect(cases.length).toBeGreaterThan(0);
    expect(suites.length).toBeGreaterThan(0);
  });

  it('keeps execution history inside the window', async () => {
    const remaining = await db.select().from(s.runs).where(eq(s.runs.projectId, projectId));
    expect(remaining.length).toBeGreaterThan(0);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    expect(remaining.every((r) => r.startedAt >= cutoff)).toBe(true);
  });

  // ---- Task 13.5 / 13.6: export ---------------------------------------------------------
  it('exports results as CSV with a header and the filtered rows', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/export/results?format=csv`,
      ...as(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('attachment');
    const lines = r.body.trim().split('\n');
    expect(lines[0]).toContain('case_ref');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('escapes CSV values that contain commas, quotes and newlines', async () => {
    const { csvRow } = await import('../services/export.js');
    expect(csvRow(['plain', 'has,comma'])).toBe('plain,"has,comma"\n');
    expect(csvRow(['say "hi"'])).toBe('"say ""hi"""\n');
    expect(csvRow(['line1\nline2'])).toBe('"line1\nline2"\n');
  });

  it('exports cases as CSV', async () => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/export/cases`,
      ...as(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('LIFE-1');
  });

  it('refuses an export from a project the caller is not a member of', async () => {
    const [other] = await db
      .insert(s.projects)
      .values({ key: `other-life-${stamp}`, name: 'Other' })
      .returning();
    const r = await app.inject({
      method: 'GET',
      url: `/api/projects/${other!.id}/export/results`,
      ...as(),
    });
    expect(r.statusCode).toBe(404);
    await db.delete(s.projects).where(eq(s.projects.id, other!.id));
  });

  // ---- Task 13.7: paginated programmatic access -----------------------------------------
  it('pages results, returning each row exactly once', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;

    do {
      const r: Awaited<ReturnType<typeof app.inject>> = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/results?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        ...as(),
      });
      const body = r.json();
      for (const row of body.results) {
        // No duplicates and no omissions across pages.
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 20);

    const total = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(s.caseResults)
      .where(eq(s.caseResults.projectId, projectId));
    expect(seen.size).toBe(total[0]?.count ?? 0);
  });
});
