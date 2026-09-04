/**
 * Failure triage (AC 6, design Decision 15).
 *
 * Carry-forward happens during ingestion; this module is the human side — reading the
 * triage state of a project and changing it. The counts of new versus carried-forward
 * failures per run are what make AC 6's "without manual reconciliation" observable rather
 * than merely asserted.
 */
import { BLOCKING_TRIAGE_STATES, type UpdateTriageRequest } from '@tcms/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { notFound } from '../http/errors.js';
import type { RequestContext } from './context.js';

export async function listTriage(
  db: Database,
  projectId: string,
  filters: { state?: string | undefined; runId?: string | undefined } = {},
) {
  const conditions = [eq(s.failureTriage.projectId, projectId)];
  if (filters.state) conditions.push(sql`${s.failureTriage.state} = ${filters.state}`);

  // Restricted to the signatures seen in one run, when asked.
  if (filters.runId) {
    const signatures = db
      .select({ signature: s.caseResults.failureSignature })
      .from(s.caseResults)
      .where(
        and(
          eq(s.caseResults.runId, filters.runId),
          sql`${s.caseResults.failureSignature} is not null`,
        ),
      );
    conditions.push(inArray(s.failureTriage.signature, signatures));
  }

  const entries = await db
    .select({
      id: s.failureTriage.id,
      caseId: s.failureTriage.caseId,
      caseRef: s.testCases.ref,
      caseTitle: s.testCases.title,
      signature: s.failureTriage.signature,
      state: s.failureTriage.state,
      note: s.failureTriage.note,
      updatedByName: s.users.displayName,
      firstSeenAt: s.failureTriage.firstSeenAt,
      updatedAt: s.failureTriage.updatedAt,
    })
    .from(s.failureTriage)
    .innerJoin(s.testCases, eq(s.testCases.id, s.failureTriage.caseId))
    .leftJoin(s.users, eq(s.users.id, s.failureTriage.updatedBy))
    .where(and(...conditions))
    .orderBy(desc(s.failureTriage.updatedAt))
    .limit(500);

  if (entries.length === 0) return { entries: [], counts: {} };

  // How often each signature has actually occurred, and its most recent message.
  const occurrences = await db
    .select({
      signature: s.caseResults.failureSignature,
      occurrences: sql<number>`count(*)::int`,
      lastFailureMessage: sql<string>`(array_agg(${s.caseResults.failureMessage} order by ${s.caseResults.executedAt} desc))[1]`,
    })
    .from(s.caseResults)
    .where(
      and(
        eq(s.caseResults.projectId, projectId),
        inArray(
          s.caseResults.failureSignature,
          entries.map((e) => e.signature),
        ),
      ),
    )
    .groupBy(s.caseResults.failureSignature);
  const bySignature = new Map(occurrences.map((o) => [o.signature, o]));

  const counts: Record<string, number> = {};
  for (const entry of entries) counts[entry.state] = (counts[entry.state] ?? 0) + 1;

  return {
    entries: entries.map((e) => ({
      ...e,
      firstSeenAt: e.firstSeenAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      occurrences: bySignature.get(e.signature)?.occurrences ?? 0,
      lastFailureMessage: bySignature.get(e.signature)?.lastFailureMessage ?? null,
    })),
    counts,
  };
}

export async function updateTriage(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  triageId: string,
  input: UpdateTriageRequest,
) {
  const [existing] = await db
    .select()
    .from(s.failureTriage)
    .where(and(eq(s.failureTriage.id, triageId), eq(s.failureTriage.projectId, projectId)));
  if (!existing) throw notFound('Triage entry not found');

  await db
    .update(s.failureTriage)
    .set({
      state: input.state,
      note: input.note ?? existing.note,
      updatedBy: ctx.principal.kind === 'user' ? ctx.principal.userId : null,
      updatedAt: ctx.now,
    })
    .where(eq(s.failureTriage.id, triageId));

  // Results already recorded against this signature adopt the new state, so the run view
  // and the release view agree with the triage view immediately.
  await db
    .update(s.caseResults)
    .set({ triageState: input.state })
    .where(
      and(
        eq(s.caseResults.projectId, projectId),
        eq(s.caseResults.failureSignature, existing.signature),
      ),
    );
}

/**
 * New versus carried-forward failure counts for one run. Reported separately because that
 * separation is the whole value of carry-forward: a run with 40 known failures and 2 new
 * ones needs attention on 2, not 42.
 */
export async function runTriageSummary(db: Database, projectId: string, runId: string) {
  // "New in this run" cannot be derived from the stored triage state: a failure that
  // carries forward a state of `new` is still stored as `new`, so counting by state would
  // report it as new again on every import. It is new only if no earlier result carries the
  // same signature.
  const [row] = await db
    .execute<{
      total_failures: number;
      new_failures: number;
      regressions: number;
      carried_forward: number;
    }>(sql`
    with run_failures as (
      select cr.id, cr.failure_signature, cr.triage_state, cr.executed_at
      from ${s.caseResults} cr
      where cr.project_id = ${projectId} and cr.run_id = ${runId} and cr.outcome = 'failed'
    ),
    classified as (
      select rf.*,
        not exists (
          select 1 from ${s.caseResults} earlier
          where earlier.project_id = ${projectId}
            and earlier.failure_signature = rf.failure_signature
            and earlier.run_id <> ${runId}
            and earlier.executed_at <= rf.executed_at
        ) as first_sighting
      from run_failures rf
    )
    select
      count(*)::int as total_failures,
      count(*) filter (where first_sighting)::int as new_failures,
      count(*) filter (where triage_state = 'regression')::int as regressions,
      count(*) filter (where not first_sighting and triage_state <> 'regression')::int as carried_forward
    from classified
  `)
    .then((r) => r.rows);

  return {
    totalFailures: Number(row?.total_failures ?? 0),
    newFailures: Number(row?.new_failures ?? 0),
    regressions: Number(row?.regressions ?? 0),
    carriedForward: Number(row?.carried_forward ?? 0),
  };
}

/** Failures nobody has dispositioned yet — the ones that block a release (AC 4). */
export function blockingStates(): readonly string[] {
  return BLOCKING_TRIAGE_STATES;
}
