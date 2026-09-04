/**
 * Release readiness (AC 4, design Decision 16).
 *
 * Brings execution progress, blocking failures, linked defects, coverage, UAT status, and
 * the sign-off gate into one view so a go/no-go discussion has everything in front of it.
 *
 * The gate reflects *approvals*, not evidence: an approver can sign off while the pass rate
 * is poor. The evidence is shown alongside precisely so that choice is made in the open.
 */
import { BLOCKING_TRIAGE_STATES } from '@tcms/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { badRequest, notFound } from '../http/errors.js';
import type { RequestContext } from './context.js';
import { coverageSummary } from './coverage.js';

export async function releaseReadiness(
  db: Database,
  projectId: string,
  releaseId: string,
  jiraBaseUrl: string,
) {
  const [release] = await db
    .select()
    .from(s.releases)
    .where(and(eq(s.releases.id, releaseId), eq(s.releases.projectId, projectId)));
  if (!release) throw notFound('Release not found');

  const runs = await db
    .select({ id: s.runs.id, name: s.runs.name, kind: s.runs.kind, status: s.runs.status })
    .from(s.runs)
    .where(and(eq(s.runs.projectId, projectId), eq(s.runs.releaseId, releaseId)));

  const runIds = runs.map((r) => r.id);

  // Absence of execution data is reported as absence, never as zero failures — reporting a
  // release with no runs as "no failures" would read as a passing state.
  let execution: {
    runs: number;
    total: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
    untested: number;
    passRate: number;
  } | null = null;

  if (runIds.length > 0) {
    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        passed: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'passed')::int`,
        failed: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'failed')::int`,
        blocked: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'blocked')::int`,
        skipped: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'skipped')::int`,
        untested: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'untested')::int`,
      })
      .from(s.runCases)
      .where(inArray(s.runCases.runId, runIds));

    const executed = (row?.passed ?? 0) + (row?.failed ?? 0);
    execution = {
      runs: runs.length,
      total: row?.total ?? 0,
      passed: row?.passed ?? 0,
      failed: row?.failed ?? 0,
      blocked: row?.blocked ?? 0,
      skipped: row?.skipped ?? 0,
      untested: row?.untested ?? 0,
      passRate: executed === 0 ? 0 : Math.round(((row?.passed ?? 0) / executed) * 1000) / 10,
    };
  }

  // ---- blocking failures --------------------------------------------------------------
  const failureRows =
    runIds.length === 0
      ? []
      : await db
          .select({
            caseRef: s.testCases.ref,
            caseTitle: s.testCases.title,
            state: s.caseResults.triageState,
            message: s.caseResults.failureMessage,
          })
          .from(s.caseResults)
          .innerJoin(s.testCases, eq(s.testCases.id, s.caseResults.caseId))
          .where(and(inArray(s.caseResults.runId, runIds), eq(s.caseResults.outcome, 'failed')))
          .limit(500);

  const blockingItems = failureRows.filter(
    (f) => f.state === null || BLOCKING_TRIAGE_STATES.includes(f.state as never),
  );

  const blocking = {
    // Untriaged and regressions block. Known issues and flakes are reported separately
    // rather than counted as blocking (release-readiness spec).
    count: blockingItems.length,
    known: failureRows.filter((f) => f.state === 'known_issue').length,
    flaky: failureRows.filter((f) => f.state === 'flaky').length,
    items: blockingItems.slice(0, 100).map((f) => ({
      caseRef: f.caseRef,
      caseTitle: f.caseTitle,
      state: (f.state ?? 'new') as never,
      message: f.message,
    })),
  };

  // ---- linked defects ------------------------------------------------------------------
  const defectRows =
    runIds.length === 0
      ? []
      : await db
          .select({
            issueKey: s.defectLinks.issueKey,
            caseRef: s.testCases.ref,
            linkedAt: s.defectLinks.linkedAt,
          })
          .from(s.defectLinks)
          .innerJoin(s.runCases, eq(s.runCases.id, s.defectLinks.runCaseId))
          .innerJoin(s.testCases, eq(s.testCases.id, s.runCases.caseId))
          .where(inArray(s.runCases.runId, runIds))
          .limit(200);

  const defects = defectRows.map((d) => ({
    issueKey: d.issueKey,
    url: `${jiraBaseUrl}/browse/${d.issueKey}`,
    caseRef: d.caseRef,
    linkedAt: d.linkedAt.toISOString(),
    // Age is measured from when the link was recorded here — the only age fact the system
    // owns, since Jira is never read (design Decision 5).
    ageDays: Math.floor((Date.now() - d.linkedAt.getTime()) / 86_400_000),
  }));

  // ---- coverage and UAT ----------------------------------------------------------------
  const coverage = await coverageSummary(db, projectId, { release: release.name });

  const uatRuns = runs.filter((r) => r.kind === 'uat');
  const uatProgress =
    uatRuns.length === 0
      ? []
      : await db
          .select({
            runId: s.runCases.runId,
            total: sql<number>`count(*)::int`,
            passed: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'passed')::int`,
            failed: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'failed')::int`,
          })
          .from(s.runCases)
          .where(
            inArray(
              s.runCases.runId,
              uatRuns.map((r) => r.id),
            ),
          )
          .groupBy(s.runCases.runId);
  const uatByRun = new Map(uatProgress.map((p) => [p.runId, p]));

  const uat = {
    total: uatRuns.length,
    closed: uatRuns.filter((r) => r.status === 'closed').length,
    runs: uatRuns.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      total: uatByRun.get(r.id)?.total ?? 0,
      passed: uatByRun.get(r.id)?.passed ?? 0,
      failed: uatByRun.get(r.id)?.failed ?? 0,
    })),
  };

  // ---- sign-off gate -------------------------------------------------------------------
  const signOffs = await db
    .select({
      id: s.releaseSignOffs.id,
      name: s.releaseSignOffs.name,
      approverId: s.releaseSignOffs.approverId,
      approverName: sql<string | null>`approver.display_name`,
      completedByName: sql<string | null>`completer.display_name`,
      completedAt: s.releaseSignOffs.completedAt,
    })
    .from(s.releaseSignOffs)
    .leftJoin(sql`${s.users} as approver`, sql`approver.id = ${s.releaseSignOffs.approverId}`)
    .leftJoin(sql`${s.users} as completer`, sql`completer.id = ${s.releaseSignOffs.completedBy}`)
    .where(eq(s.releaseSignOffs.releaseId, releaseId))
    .orderBy(s.releaseSignOffs.name);

  const outstanding = signOffs.filter((i) => i.completedAt === null);

  return {
    release: {
      id: release.id,
      name: release.name,
      status: release.status,
      targetDate: release.targetDate?.toISOString() ?? null,
    },
    execution,
    blocking,
    defects,
    coverage,
    uat,
    gate: {
      // An empty checklist is not "signed off": nobody has approved anything.
      signedOff: signOffs.length > 0 && outstanding.length === 0,
      items: signOffs.map((i) => ({
        ...i,
        completedAt: i.completedAt?.toISOString() ?? null,
      })),
      outstanding: outstanding.map((i) => i.name),
    },
  };
}

export async function addSignOffItem(
  db: Database,
  projectId: string,
  releaseId: string,
  input: { name: string; approverId?: string | null | undefined },
) {
  const [release] = await db
    .select()
    .from(s.releases)
    .where(and(eq(s.releases.id, releaseId), eq(s.releases.projectId, projectId)));
  if (!release) throw notFound('Release not found');

  // A duplicate name is a caller mistake, not a server fault: reported as such rather than
  // surfacing the unique-constraint violation as a 500.
  const [existing] = await db
    .select({ id: s.releaseSignOffs.id })
    .from(s.releaseSignOffs)
    .where(and(eq(s.releaseSignOffs.releaseId, releaseId), eq(s.releaseSignOffs.name, input.name)));
  if (existing) {
    throw badRequest(
      `A sign-off item named '${input.name}' already exists on this release`,
      'DUPLICATE_SIGN_OFF',
    );
  }

  return expectOne(
    await db
      .insert(s.releaseSignOffs)
      .values({ releaseId, name: input.name, approverId: input.approverId ?? null })
      .returning(),
    'sign-off insert',
  );
}

/**
 * Completes a sign-off item. Only the designated approver may complete it; when no approver
 * is named, any caller holding `release.sign_off` may.
 */
export async function completeSignOff(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  signOffId: string,
) {
  const [item] = await db
    .select({
      id: s.releaseSignOffs.id,
      approverId: s.releaseSignOffs.approverId,
      completedAt: s.releaseSignOffs.completedAt,
    })
    .from(s.releaseSignOffs)
    .innerJoin(s.releases, eq(s.releases.id, s.releaseSignOffs.releaseId))
    .where(and(eq(s.releaseSignOffs.id, signOffId), eq(s.releases.projectId, projectId)));
  if (!item) throw notFound('Sign-off item not found');

  const userId = ctx.principal.kind === 'user' ? ctx.principal.userId : null;
  if (item.approverId && item.approverId !== userId) {
    // Not disclosed as a permission error: the caller simply cannot act on this item.
    throw notFound('Sign-off item not found');
  }

  await db
    .update(s.releaseSignOffs)
    .set({ completedBy: userId, completedAt: ctx.now })
    .where(eq(s.releaseSignOffs.id, signOffId));
}

export async function reopenSignOff(db: Database, projectId: string, signOffId: string) {
  const [item] = await db
    .select({ id: s.releaseSignOffs.id })
    .from(s.releaseSignOffs)
    .innerJoin(s.releases, eq(s.releases.id, s.releaseSignOffs.releaseId))
    .where(and(eq(s.releaseSignOffs.id, signOffId), eq(s.releases.projectId, projectId)));
  if (!item) throw notFound('Sign-off item not found');
  await db
    .update(s.releaseSignOffs)
    .set({ completedBy: null, completedAt: null })
    .where(eq(s.releaseSignOffs.id, signOffId));
}
