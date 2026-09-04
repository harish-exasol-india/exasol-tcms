/**
 * Automation binding reporting (design Decision 4).
 *
 * With no Requirement entity (Decision 3), the automation binding is the *entire* coverage
 * signal — nothing cross-checks it. That is why how a binding was established and when it
 * was last matched are reported as first-class facts: it makes decay observable instead of
 * silent, which is the failure mode name-based matching otherwise has.
 */
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';

export type BindingReport = {
  bindings: {
    id: string;
    caseId: string;
    caseRef: string;
    caseTitle: string;
    fqName: string;
    method: 'identifier' | 'name_match';
    lastSeenAt: string | null;
    promotedAt: string | null;
    isStale: boolean;
  }[];
  summary: {
    total: number;
    byIdentifier: number;
    byName: number;
    stale: number;
    staleThresholdDays: number;
  };
  unboundTests: { fqName: string; outcome: string; seenAt: string }[];
};

export async function bindingReport(
  db: Database,
  projectId: string,
  staleThresholdDays: number,
  options: { limit?: number; filter?: 'all' | 'fragile' | 'stale' } = {},
): Promise<BindingReport> {
  const staleBefore = new Date(Date.now() - staleThresholdDays * 24 * 60 * 60 * 1000);
  const limit = Math.min(options.limit ?? 300, 1000);
  const filter = options.filter ?? 'all';

  // Never matched, or not matched within the threshold: both mean the binding is not
  // demonstrably live.
  const isStale = sql`(${s.automationBindings.lastSeenAt} is null or ${s.automationBindings.lastSeenAt} < ${staleBefore.toISOString()})`;

  // The summary is an aggregate, not a count of rows shipped to the caller: at ~100k
  // bindings, loading every row to tally it in JavaScript cost ~900ms per request and sent
  // two orders of magnitude more data than the view renders.
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      byIdentifier: sql<number>`count(*) filter (where ${s.automationBindings.method} = 'identifier')::int`,
      byName: sql<number>`count(*) filter (where ${s.automationBindings.method} = 'name_match')::int`,
      stale: sql<number>`count(*) filter (where ${isStale})::int`,
    })
    .from(s.automationBindings)
    .where(eq(s.automationBindings.projectId, projectId));

  const conditions = [eq(s.automationBindings.projectId, projectId)];
  if (filter === 'fragile') conditions.push(eq(s.automationBindings.method, 'name_match'));
  if (filter === 'stale') conditions.push(isStale);

  const rows = await db
    .select({
      id: s.automationBindings.id,
      caseId: s.automationBindings.caseId,
      caseRef: s.testCases.ref,
      caseTitle: s.testCases.title,
      fqName: s.automationBindings.fqName,
      method: s.automationBindings.method,
      lastSeenAt: s.automationBindings.lastSeenAt,
      promotedAt: s.automationBindings.promotedAt,
    })
    .from(s.automationBindings)
    .innerJoin(s.testCases, eq(s.testCases.id, s.automationBindings.caseId))
    .where(and(...conditions))
    // Fragile and stale bindings first: they are the ones needing attention, and the list
    // is truncated, so they must not fall off the end of it.
    .orderBy(sql`${s.automationBindings.lastSeenAt} asc nulls first`, s.testCases.ref)
    .limit(limit);

  const bindings = rows.map((row) => ({
    ...row,
    isStale: row.lastSeenAt === null || row.lastSeenAt < staleBefore,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    promotedAt: row.promotedAt?.toISOString() ?? null,
  }));

  const unbound = await db
    .select({
      fqName: s.unboundResults.fqName,
      outcome: s.unboundResults.outcome,
      seenAt: s.unboundResults.seenAt,
    })
    .from(s.unboundResults)
    .where(eq(s.unboundResults.projectId, projectId))
    .orderBy(desc(s.unboundResults.seenAt))
    .limit(200);

  return {
    bindings,
    summary: {
      total: totals?.total ?? 0,
      byIdentifier: totals?.byIdentifier ?? 0,
      byName: totals?.byName ?? 0,
      stale: totals?.stale ?? 0,
      staleThresholdDays,
    },
    unboundTests: unbound.map((u) => ({ ...u, seenAt: u.seenAt.toISOString() })),
  };
}

/** Bindings not matched within the threshold, for a focused staleness view. */
export async function staleBindings(db: Database, projectId: string, staleThresholdDays: number) {
  const staleBefore = new Date(Date.now() - staleThresholdDays * 24 * 60 * 60 * 1000);
  return db
    .select({
      caseRef: s.testCases.ref,
      caseTitle: s.testCases.title,
      fqName: s.automationBindings.fqName,
      method: s.automationBindings.method,
      lastSeenAt: s.automationBindings.lastSeenAt,
    })
    .from(s.automationBindings)
    .innerJoin(s.testCases, eq(s.testCases.id, s.automationBindings.caseId))
    .where(
      and(
        eq(s.automationBindings.projectId, projectId),
        or(
          isNull(s.automationBindings.lastSeenAt),
          lt(s.automationBindings.lastSeenAt, staleBefore),
        ),
      ),
    )
    .orderBy(sql`${s.automationBindings.lastSeenAt} asc nulls first`);
}
