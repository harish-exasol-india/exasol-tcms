/**
 * Automated result ingestion (AC 2, AC 6; design Decision 8).
 *
 * One call takes a JUnit XML document plus metadata and lands a complete run: no approval
 * step, no reconciliation queue. Everything either commits or nothing does — a partially
 * ingested report would leave coverage and release views quietly wrong.
 */
import type { IngestMetadata, IngestResponse } from '@tcms/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { badRequest } from '../http/errors.js';
import type { RequestContext } from '../services/context.js';
import { type ParsedTest, parseJUnitXml } from './junit.js';
import { failureSignature } from './signature.js';

type BindingRow = {
  id: string;
  caseId: string;
  fqName: string;
  method: 'identifier' | 'name_match';
};

/** `excluded.<column>` reference for an upsert. */
function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}

/** Every bound case must have produced a run_case row; a miss is a bug, not a fallback. */
function mustHave(map: Map<string, string>, key: string): string {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`No run_case row was created for case ${key}`);
  }
  return value;
}

/**
 * Resolves a named row, creating it if absent.
 *
 * Check-then-insert races under concurrency: several CI jobs pushing the first results for
 * a new release all find it missing and all try to create it, and every one but the winner
 * fails on the unique constraint. The insert is therefore an idempotent upsert, and the id
 * is read back afterwards so the losing writers still get the winner's row.
 */
async function resolveOrCreateNamed(
  find: () => Promise<{ id: string } | undefined>,
  upsert: () => Promise<void>,
): Promise<string> {
  const existing = await find();
  if (existing) return existing.id;
  await upsert();
  const created = await find();
  if (!created) throw new Error('Named row could not be resolved after upsert');
  return created.id;
}

export async function ingestJUnitReport(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  xml: string,
  metadata: IngestMetadata,
): Promise<IngestResponse> {
  // Parse before touching the database: a malformed report must persist nothing.
  const report = parseJUnitXml(xml);
  if (report.tests.length === 0) throw badRequest('Report contains no test cases');

  // ---- resolve run context ------------------------------------------------------------
  const environmentId = metadata.environment
    ? await resolveOrCreateNamed(
        async () =>
          (
            await db
              .select({ id: s.environments.id })
              .from(s.environments)
              .where(
                and(
                  eq(s.environments.projectId, projectId),
                  eq(s.environments.name, metadata.environment as string),
                ),
              )
          )[0],
        async () => {
          await db
            .insert(s.environments)
            .values({ projectId, name: metadata.environment as string })
            .onConflictDoNothing();
        },
      )
    : null;

  const releaseId = metadata.release
    ? await resolveOrCreateNamed(
        async () =>
          (
            await db
              .select({ id: s.releases.id })
              .from(s.releases)
              .where(
                and(
                  eq(s.releases.projectId, projectId),
                  eq(s.releases.name, metadata.release as string),
                ),
              )
          )[0],
        async () => {
          await db
            .insert(s.releases)
            .values({ projectId, name: metadata.release as string, status: 'in_progress' })
            .onConflictDoNothing();
        },
      )
    : null;

  const runName =
    metadata.runName ??
    `CI ${metadata.branch ?? 'unknown-branch'} ${(metadata.commitSha ?? '').slice(0, 8)}`.trim();

  // ---- bind incoming tests to managed cases -------------------------------------------
  const declaredRefs = report.tests
    .map((t) => t.declaredCaseRef)
    .filter((ref): ref is string => Boolean(ref));
  const fqNames = report.tests.map((t) => t.fqName);

  const casesByRef = new Map<string, string>();
  if (declaredRefs.length > 0) {
    const rows = await db
      .select({ id: s.testCases.id, ref: s.testCases.ref })
      .from(s.testCases)
      .where(and(eq(s.testCases.projectId, projectId), inArray(s.testCases.ref, declaredRefs)));
    for (const row of rows) casesByRef.set(row.ref, row.id);
  }

  const existingBindings = new Map<string, BindingRow>();
  if (fqNames.length > 0) {
    const rows = await db
      .select({
        id: s.automationBindings.id,
        caseId: s.automationBindings.caseId,
        fqName: s.automationBindings.fqName,
        method: s.automationBindings.method,
      })
      .from(s.automationBindings)
      .where(
        and(
          eq(s.automationBindings.projectId, projectId),
          inArray(s.automationBindings.fqName, fqNames),
        ),
      );
    for (const row of rows) existingBindings.set(row.fqName, row);
  }

  type Resolved = {
    test: ParsedTest;
    caseId: string | null;
    method: 'identifier' | 'name_match' | null;
  };
  const resolved: Resolved[] = report.tests.map((test) => {
    // An explicit identifier always wins: it survives renames, which is the whole point of
    // the promotion path (design Decision 4).
    const byIdentifier = test.declaredCaseRef ? casesByRef.get(test.declaredCaseRef) : undefined;
    if (byIdentifier) return { test, caseId: byIdentifier, method: 'identifier' };

    const byName = existingBindings.get(test.fqName);
    if (byName) return { test, caseId: byName.caseId, method: 'name_match' };

    return { test, caseId: null, method: null };
  });

  const boundResolved = resolved.filter(
    (r): r is Resolved & { caseId: string; method: 'identifier' | 'name_match' } =>
      r.caseId !== null,
  );

  // ---- create the run and its results --------------------------------------------------
  const run = expectOne(
    await db
      .insert(s.runs)
      .values({
        projectId,
        environmentId,
        releaseId,
        name: runName,
        kind: 'automated',
        status: 'closed',
        commitSha: metadata.commitSha ?? null,
        branch: metadata.branch ?? null,
        startedAt: ctx.now,
        closedAt: ctx.now,
      })
      .returning(),
    'run insert',
  );

  // The monthly partition for this run must exist before results are written.
  await db.execute(sql`select ensure_case_result_partition(${ctx.now.toISOString()})`);

  const triage = { newFailures: 0, carriedForward: 0, regressions: 0 };

  if (boundResolved.length > 0) {
    const runCases = await db
      .insert(s.runCases)
      .values(
        boundResolved.map((r) => ({
          runId: run.id,
          caseId: r.caseId,
          outcome: r.test.outcome,
        })),
      )
      .returning({ id: s.runCases.id, caseId: s.runCases.caseId });

    const runCaseByCase = new Map(runCases.map((rc) => [rc.caseId, rc.id]));

    // ---- triage carry-forward (design Decision 15) ------------------------------------
    const failures = boundResolved.filter((r) => r.test.outcome === 'failed');
    const signatures = failures.map((r) => failureSignature(r.caseId, r.test.failureMessage));

    const priorTriage = new Map<string, { id: string; state: string }>();
    if (signatures.length > 0) {
      const rows = await db
        .select({
          id: s.failureTriage.id,
          signature: s.failureTriage.signature,
          state: s.failureTriage.state,
        })
        .from(s.failureTriage)
        .where(
          and(
            eq(s.failureTriage.projectId, projectId),
            inArray(s.failureTriage.signature, signatures),
          ),
        );
      for (const row of rows) priorTriage.set(row.signature, { id: row.id, state: row.state });
    }

    const resultRows = boundResolved.map((r) => {
      const isFailure = r.test.outcome === 'failed';
      const signature = isFailure ? failureSignature(r.caseId, r.test.failureMessage) : null;
      let triageState: string | null = null;

      if (isFailure && signature) {
        const prior = priorTriage.get(signature);
        if (!prior) {
          triageState = 'new';
          triage.newFailures += 1;
        } else if (prior.state === 'resolved') {
          // A resolved failure recurring is a regression, never a silent inheritance.
          triageState = 'regression';
          triage.regressions += 1;
        } else {
          triageState = prior.state;
          triage.carriedForward += 1;
        }
      }

      return {
        executedAt: ctx.now,
        runCaseId: mustHave(runCaseByCase, r.caseId),
        runId: run.id,
        projectId,
        caseId: r.caseId,
        outcome: r.test.outcome,
        durationMs: r.test.durationMs,
        failureMessage: r.test.failureMessage,
        failureSignature: signature,
        triageState: triageState as (typeof s.triageStates)[number] | null,
        origin: 'api' as const,
      };
    });

    await db.insert(s.caseResults).values(resultRows);

    // Record or advance triage rows for the signatures seen in this import.
    const seen = new Set<string>();
    for (const row of resultRows) {
      if (!row.failureSignature || seen.has(row.failureSignature)) continue;
      seen.add(row.failureSignature);
      const prior = priorTriage.get(row.failureSignature);
      if (!prior) {
        await db
          .insert(s.failureTriage)
          .values({
            projectId,
            caseId: row.caseId,
            signature: row.failureSignature,
            state: 'new',
          })
          .onConflictDoNothing();
      } else if (prior.state === 'resolved') {
        await db
          .update(s.failureTriage)
          .set({ state: 'regression', updatedAt: ctx.now })
          .where(eq(s.failureTriage.id, prior.id));
      }
    }

    // ---- record and refresh bindings ---------------------------------------------------
    const bindingValues = boundResolved.map((r) => ({
      projectId,
      caseId: r.caseId,
      fqName: r.test.fqName,
      method: r.method,
      lastSeenAt: ctx.now,
      promotedAt: r.method === 'identifier' ? ctx.now : null,
    }));
    await db
      .insert(s.automationBindings)
      .values(bindingValues)
      .onConflictDoUpdate({
        target: [s.automationBindings.projectId, s.automationBindings.fqName],
        set: {
          lastSeenAt: ctx.now,
          caseId: sqlExcluded('case_id'),
          method: sqlExcluded('method'),
          promotedAt: sqlExcluded('promoted_at'),
        },
      });

    // Cases with an automated result are automated, by definition.
    await db
      .update(s.testCases)
      .set({ isAutomated: true })
      .where(inArray(s.testCases.id, [...new Set(boundResolved.map((r) => r.caseId))]));
  }

  // ---- unbound tests are retained and reported, never auto-created ---------------------
  const unbound = resolved.filter((r) => r.caseId === null);
  if (unbound.length > 0) {
    await db.insert(s.unboundResults).values(
      unbound.map((r) => ({
        projectId,
        runId: run.id,
        fqName: r.test.fqName,
        outcome: r.test.outcome,
        seenAt: ctx.now,
      })),
    );
  }

  return {
    runId: run.id,
    runName: run.name,
    ingested: report.tests.length,
    bound: {
      byIdentifier: boundResolved.filter((r) => r.method === 'identifier').length,
      byName: boundResolved.filter((r) => r.method === 'name_match').length,
    },
    unbound: unbound.length,
    counts: report.counts,
    triage,
  };
}
