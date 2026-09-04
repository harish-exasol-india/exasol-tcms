/**
 * Manual test execution (AC 5).
 *
 * The correctness-critical part is concurrency. Two testers working the same run must not
 * silently overwrite each other: in UAT, one tester's pass replacing another's fail is a
 * correctness bug, not an inconvenience, and it is exactly the thing that discredits a
 * release sign-off. Every result write therefore carries the version it was based on, and a
 * stale write is rejected with the current value so the caller can decide (Decision 13).
 */
import type { CreateRunRequest, RecordResultRequest } from '@tcms/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import type { RequestContext } from './context.js';
import { planCaseIds } from './planning.js';

/** Rejected because someone else wrote first. Carries the current value, not just a code. */
export class ResultConflictError extends HttpError {
  constructor(current: {
    outcome: string;
    version: number;
    updatedBy: string | null;
    updatedAt: string;
  }) {
    // `current` travels in the response body: the tester needs to see the other result
    // before deciding whether to overwrite it (design Decision 13).
    super(409, 'This case was updated by someone else', 'RESULT_CONFLICT', { current });
    this.name = 'ResultConflictError';
  }
}

const PROGRESS = {
  passed: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'passed')::int`,
  failed: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'failed')::int`,
  blocked: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'blocked')::int`,
  skipped: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'skipped')::int`,
  untested: sql<number>`count(*) filter (where ${s.runCases.outcome} = 'untested')::int`,
  total: sql<number>`count(*)::int`,
};

export async function listRuns(
  db: Database,
  projectId: string,
  filters: {
    releaseId?: string | undefined;
    kind?: string | undefined;
    status?: string | undefined;
  } = {},
) {
  const conditions = [eq(s.runs.projectId, projectId)];
  if (filters.releaseId) conditions.push(eq(s.runs.releaseId, filters.releaseId));
  if (filters.kind) conditions.push(sql`${s.runs.kind} = ${filters.kind}`);
  if (filters.status) conditions.push(sql`${s.runs.status} = ${filters.status}`);

  return db
    .select({
      id: s.runs.id,
      name: s.runs.name,
      kind: s.runs.kind,
      status: s.runs.status,
      releaseId: s.runs.releaseId,
      releaseName: s.releases.name,
      environmentName: s.environments.name,
      branch: s.runs.branch,
      commitSha: s.runs.commitSha,
      startedAt: s.runs.startedAt,
      closedAt: s.runs.closedAt,
      ...PROGRESS,
    })
    .from(s.runs)
    .leftJoin(s.releases, eq(s.releases.id, s.runs.releaseId))
    .leftJoin(s.environments, eq(s.environments.id, s.runs.environmentId))
    .leftJoin(s.runCases, eq(s.runCases.runId, s.runs.id))
    .where(and(...conditions))
    .groupBy(s.runs.id, s.releases.name, s.environments.name)
    .orderBy(desc(s.runs.startedAt))
    .limit(200);
}

export function toRunSummary(row: Awaited<ReturnType<typeof listRuns>>[number]) {
  const { total, passed, failed, blocked, skipped, untested, startedAt, closedAt, ...rest } = row;
  return {
    ...rest,
    startedAt: startedAt.toISOString(),
    closedAt: closedAt?.toISOString() ?? null,
    progress: { total, passed, failed, blocked, skipped, untested },
  };
}

export async function createRun(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  input: CreateRunRequest,
) {
  // Membership is snapshotted here: editing the plan afterwards must not change what this
  // run contains (test-planning spec).
  const caseIds = input.planId ? await planCaseIds(db, input.planId) : (input.caseIds ?? []);
  if (caseIds.length === 0) throw badRequest('The run would contain no cases', 'EMPTY_RUN');

  const valid = await db
    .select({ id: s.testCases.id })
    .from(s.testCases)
    .where(
      and(
        eq(s.testCases.projectId, projectId),
        isNull(s.testCases.deletedAt),
        inArray(s.testCases.id, caseIds),
      ),
    );
  if (valid.length === 0) throw badRequest('None of the selected cases exist', 'EMPTY_RUN');

  const run = expectOne(
    await db
      .insert(s.runs)
      .values({
        projectId,
        planId: input.planId ?? null,
        environmentId: input.environmentId ?? null,
        releaseId: input.releaseId ?? null,
        name: input.name,
        kind: input.kind,
        status: 'open',
        createdBy: ctx.principal.kind === 'user' ? ctx.principal.userId : null,
        startedAt: ctx.now,
      })
      .returning(),
    'run insert',
  );

  await db
    .insert(s.runCases)
    .values(valid.map((c) => ({ runId: run.id, caseId: c.id, outcome: 'untested' as const })));

  return run;
}

export async function getRun(db: Database, projectId: string, runId: string) {
  const [row] = await db
    .select({
      id: s.runs.id,
      name: s.runs.name,
      kind: s.runs.kind,
      status: s.runs.status,
      releaseId: s.runs.releaseId,
      releaseName: s.releases.name,
      environmentName: s.environments.name,
      branch: s.runs.branch,
      commitSha: s.runs.commitSha,
      startedAt: s.runs.startedAt,
      closedAt: s.runs.closedAt,
    })
    .from(s.runs)
    .leftJoin(s.releases, eq(s.releases.id, s.runs.releaseId))
    .leftJoin(s.environments, eq(s.environments.id, s.runs.environmentId))
    .where(and(eq(s.runs.id, runId), eq(s.runs.projectId, projectId)));
  if (!row) throw notFound('Run not found');

  const cases = await db
    .select({
      id: s.runCases.id,
      caseId: s.runCases.caseId,
      ref: s.testCases.ref,
      title: s.testCases.title,
      suiteName: s.suites.name,
      priority: s.testCases.priority,
      outcome: s.runCases.outcome,
      version: s.runCases.version,
      assigneeId: s.runCases.assigneeId,
      assigneeName: s.users.displayName,
      updatedAt: s.runCases.updatedAt,
    })
    .from(s.runCases)
    .innerJoin(s.testCases, eq(s.testCases.id, s.runCases.caseId))
    .innerJoin(s.suites, eq(s.suites.id, s.testCases.suiteId))
    .leftJoin(s.users, eq(s.users.id, s.runCases.assigneeId))
    .where(eq(s.runCases.runId, runId))
    .orderBy(asc(s.testCases.ref));

  const progress = {
    total: cases.length,
    passed: cases.filter((c) => c.outcome === 'passed').length,
    failed: cases.filter((c) => c.outcome === 'failed').length,
    blocked: cases.filter((c) => c.outcome === 'blocked').length,
    skipped: cases.filter((c) => c.outcome === 'skipped').length,
    untested: cases.filter((c) => c.outcome === 'untested').length,
  };

  return {
    ...row,
    startedAt: row.startedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    progress,
    cases: cases.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() })),
  };
}

/** One case within a run, with steps, evidence, and defect links resolved. */
export async function getRunCase(
  db: Database,
  projectId: string,
  runId: string,
  runCaseId: string,
) {
  const [row] = await db
    .select({
      id: s.runCases.id,
      caseId: s.runCases.caseId,
      ref: s.testCases.ref,
      title: s.testCases.title,
      suiteName: s.suites.name,
      priority: s.testCases.priority,
      outcome: s.runCases.outcome,
      version: s.runCases.version,
      assigneeId: s.runCases.assigneeId,
      assigneeName: s.users.displayName,
      updatedAt: s.runCases.updatedAt,
    })
    .from(s.runCases)
    .innerJoin(s.runs, eq(s.runs.id, s.runCases.runId))
    .innerJoin(s.testCases, eq(s.testCases.id, s.runCases.caseId))
    .innerJoin(s.suites, eq(s.suites.id, s.testCases.suiteId))
    .leftJoin(s.users, eq(s.users.id, s.runCases.assigneeId))
    .where(
      and(
        eq(s.runCases.id, runCaseId),
        eq(s.runCases.runId, runId),
        eq(s.runs.projectId, projectId),
      ),
    );
  if (!row) throw notFound('Run case not found');

  const stepRows = await db
    .select({
      position: s.caseSteps.position,
      action: s.caseSteps.action,
      expected: s.caseSteps.expected,
      sharedStepId: s.caseSteps.sharedStepId,
      sharedStepName: s.sharedSteps.name,
    })
    .from(s.caseSteps)
    .leftJoin(s.sharedSteps, eq(s.sharedSteps.id, s.caseSteps.sharedStepId))
    .where(eq(s.caseSteps.caseId, row.caseId))
    .orderBy(asc(s.caseSteps.position));

  const sharedIds = stepRows.map((r) => r.sharedStepId).filter((id): id is string => Boolean(id));
  const sharedItems = sharedIds.length
    ? await db
        .select()
        .from(s.sharedStepItems)
        .where(inArray(s.sharedStepItems.sharedStepId, sharedIds))
        .orderBy(asc(s.sharedStepItems.position))
    : [];

  const stepOutcomes = await db
    .select()
    .from(s.stepResults)
    .where(eq(s.stepResults.runCaseId, runCaseId));
  const byPosition = new Map(stepOutcomes.map((r) => [r.stepPosition, r]));

  const attachments = await db
    .select()
    .from(s.attachments)
    .where(eq(s.attachments.runCaseId, runCaseId))
    .orderBy(desc(s.attachments.uploadedAt));

  const defects = await db
    .select()
    .from(s.defectLinks)
    .where(eq(s.defectLinks.runCaseId, runCaseId))
    .orderBy(desc(s.defectLinks.linkedAt));

  return {
    ...row,
    updatedAt: row.updatedAt.toISOString(),
    steps: stepRows.map((step) => ({
      position: step.position,
      action: step.action,
      expected: step.expected,
      sharedStepName: step.sharedStepName,
      sharedStepItems: step.sharedStepId
        ? sharedItems
            .filter((i) => i.sharedStepId === step.sharedStepId)
            .map((i) => ({ position: i.position, action: i.action, expected: i.expected }))
        : null,
      outcome: byPosition.get(step.position)?.outcome ?? null,
      comment: byPosition.get(step.position)?.comment ?? null,
    })),
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      stepPosition: a.stepPosition,
      uploadedAt: a.uploadedAt.toISOString(),
    })),
    defects: defects.map((d) => ({
      id: d.id,
      issueKey: d.issueKey,
      stepPosition: d.stepPosition,
      linkedAt: d.linkedAt.toISOString(),
    })),
  };
}

/**
 * Records a result under optimistic concurrency.
 *
 * The UPDATE is guarded by the version the caller read, so two testers writing concurrently
 * cannot both succeed: the second write matches zero rows and is reported as a conflict
 * with the value that actually won.
 */
export async function recordResult(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  runId: string,
  runCaseId: string,
  input: RecordResultRequest,
) {
  const [existing] = await db
    .select({ runId: s.runCases.runId, caseId: s.runCases.caseId, status: s.runs.status })
    .from(s.runCases)
    .innerJoin(s.runs, eq(s.runs.id, s.runCases.runId))
    .where(
      and(
        eq(s.runCases.id, runCaseId),
        eq(s.runCases.runId, runId),
        eq(s.runs.projectId, projectId),
      ),
    );
  if (!existing) throw notFound('Run case not found');
  if (existing.status !== 'open') throw badRequest('This run is closed', 'RUN_CLOSED');

  const userId = ctx.principal.kind === 'user' ? ctx.principal.userId : null;

  const updated = await db
    .update(s.runCases)
    .set({
      outcome: input.outcome,
      version: sql`${s.runCases.version} + 1`,
      updatedAt: ctx.now,
      ...(userId ? { assigneeId: userId } : {}),
    })
    .where(and(eq(s.runCases.id, runCaseId), eq(s.runCases.version, input.basedOnVersion)))
    .returning({ version: s.runCases.version });

  if (updated.length === 0) {
    // Someone else wrote first. Report what actually won so the caller can reconcile.
    const [current] = await db
      .select({
        outcome: s.runCases.outcome,
        version: s.runCases.version,
        updatedAt: s.runCases.updatedAt,
        updatedBy: s.users.displayName,
      })
      .from(s.runCases)
      .leftJoin(s.users, eq(s.users.id, s.runCases.assigneeId))
      .where(eq(s.runCases.id, runCaseId));
    throw new ResultConflictError({
      outcome: current?.outcome ?? 'untested',
      version: current?.version ?? 0,
      updatedBy: current?.updatedBy ?? null,
      updatedAt: current?.updatedAt.toISOString() ?? new Date().toISOString(),
    });
  }

  if (input.steps?.length) {
    for (const step of input.steps) {
      await db
        .insert(s.stepResults)
        .values({
          runCaseId,
          stepPosition: step.position,
          outcome: step.outcome,
          comment: step.comment ?? null,
          recordedBy: userId,
          recordedAt: ctx.now,
        })
        .onConflictDoUpdate({
          target: [s.stepResults.runCaseId, s.stepResults.stepPosition],
          set: {
            outcome: step.outcome,
            comment: step.comment ?? null,
            recordedBy: userId,
            recordedAt: ctx.now,
          },
        });
    }
  }

  await db.execute(sql`select ensure_case_result_partition(${ctx.now.toISOString()})`);
  await db.insert(s.caseResults).values({
    executedAt: ctx.now,
    runCaseId,
    runId,
    projectId,
    caseId: existing.caseId,
    outcome: input.outcome,
    failureMessage: input.outcome === 'failed' ? (input.comment ?? null) : null,
    recordedBy: userId,
    origin: ctx.principal.origin,
  });

  return { version: updated[0]?.version ?? input.basedOnVersion + 1 };
}

export async function closeRun(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  runId: string,
) {
  const [existing] = await db
    .select()
    .from(s.runs)
    .where(and(eq(s.runs.id, runId), eq(s.runs.projectId, projectId)));
  if (!existing) throw notFound('Run not found');
  await db.update(s.runs).set({ status: 'closed', closedAt: ctx.now }).where(eq(s.runs.id, runId));
}
