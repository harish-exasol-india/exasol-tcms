/**
 * Coverage reporting (AC 3, design Decision 3).
 *
 * Coverage is automation coverage: how many managed cases have an automation binding, how
 * many remain manual, and how many have never been executed at all. The three buckets are
 * mutually exclusive and sum to the total, so a reader can never be shown figures that do
 * not add up.
 *
 * Because the taxonomy is a suite tree plus tags (Decision 2), coverage "by product,
 * module, feature or release" is a GROUP BY over those same dimensions — the taxonomy model
 * and the coverage model are the same model.
 */
import { and, eq, exists, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { suiteSubtreeIds } from './suites.js';

export type CoverageFilters = {
  suiteId?: string;
  tags?: string[];
  release?: string;
  customField?: { key: string; value: string };
};

type Bucket = { total: number; automated: number; manual: number; neverExecuted: number };

async function caseFilterConditions(db: Database, projectId: string, filters: CoverageFilters) {
  const conditions = [eq(s.testCases.projectId, projectId), isNull(s.testCases.deletedAt)];

  if (filters.suiteId) {
    conditions.push(
      inArray(s.testCases.suiteId, await suiteSubtreeIds(db, projectId, filters.suiteId)),
    );
  }

  if (filters.tags?.length) {
    const tagged = db
      .select({ caseId: s.caseTags.caseId })
      .from(s.caseTags)
      .innerJoin(s.tags, eq(s.tags.id, s.caseTags.tagId))
      .where(inArray(s.tags.name, filters.tags));
    conditions.push(inArray(s.testCases.id, tagged));
  }

  if (filters.customField) {
    conditions.push(
      sql`${s.testCases.customFields} ->> ${filters.customField.key} = ${filters.customField.value}`,
    );
  }

  if (filters.release) {
    // Scoped to a release: only cases executed in runs attributed to it.
    const executedInRelease = db
      .select({ caseId: s.runCases.caseId })
      .from(s.runCases)
      .innerJoin(s.runs, eq(s.runs.id, s.runCases.runId))
      .innerJoin(s.releases, eq(s.releases.id, s.runs.releaseId))
      .where(and(eq(s.releases.projectId, projectId), eq(s.releases.name, filters.release)));
    conditions.push(inArray(s.testCases.id, executedInRelease));
  }

  return conditions;
}

/** True when the case has an automation binding. */
const hasBinding = () =>
  exists(
    // A correlated EXISTS rather than a join: joining would multiply a case by its bindings
    // and inflate the counts.
    sql`(select 1 from ${s.automationBindings} ab where ab.case_id = ${s.testCases.id})`,
  );

/** True when the case has ever produced a result. */
const everExecuted = () =>
  exists(sql`(select 1 from ${s.runCases} rc where rc.case_id = ${s.testCases.id})`);

export async function coverageSummary(
  db: Database,
  projectId: string,
  filters: CoverageFilters,
): Promise<Bucket> {
  const conditions = await caseFilterConditions(db, projectId, filters);

  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      automated: sql<number>`count(*) filter (where ${hasBinding()})::int`,
      // Manual and never-executed are disjoint: a case without a binding either has run
      // manually at least once, or has never run at all.
      manual: sql<number>`count(*) filter (where not ${hasBinding()} and ${everExecuted()})::int`,
      neverExecuted: sql<number>`count(*) filter (where not ${hasBinding()} and not ${everExecuted()})::int`,
    })
    .from(s.testCases)
    .where(and(...conditions));

  return row ?? { total: 0, automated: 0, manual: 0, neverExecuted: 0 };
}

/** Coverage grouped by tag, with an explicit untagged group so no case is omitted. */
export async function coverageByTag(db: Database, projectId: string, filters: CoverageFilters) {
  const conditions = await caseFilterConditions(db, projectId, filters);

  const tagged = await db
    .select({
      key: s.tags.name,
      label: s.tags.name,
      total: sql<number>`count(*)::int`,
      automated: sql<number>`count(*) filter (where ${hasBinding()})::int`,
      manual: sql<number>`count(*) filter (where not ${hasBinding()} and ${everExecuted()})::int`,
      neverExecuted: sql<number>`count(*) filter (where not ${hasBinding()} and not ${everExecuted()})::int`,
    })
    .from(s.testCases)
    .innerJoin(s.caseTags, eq(s.caseTags.caseId, s.testCases.id))
    .innerJoin(s.tags, eq(s.tags.id, s.caseTags.tagId))
    .where(and(...conditions))
    .groupBy(s.tags.name)
    .orderBy(sql`count(*) desc`, s.tags.name);

  // Cases carrying no tag would otherwise vanish from a grouped view.
  const [untagged] = await db
    .select({
      total: sql<number>`count(*)::int`,
      automated: sql<number>`count(*) filter (where ${hasBinding()})::int`,
      manual: sql<number>`count(*) filter (where not ${hasBinding()} and ${everExecuted()})::int`,
      neverExecuted: sql<number>`count(*) filter (where not ${hasBinding()} and not ${everExecuted()})::int`,
    })
    .from(s.testCases)
    .where(
      and(
        ...conditions,
        sql`not exists (select 1 from ${s.caseTags} ct where ct.case_id = ${s.testCases.id})`,
      ),
    );

  const groups = [...tagged];
  if (untagged && untagged.total > 0) {
    groups.push({ key: '__untagged__', label: '(no tag)', ...untagged });
  }
  return groups;
}

/** Coverage grouped by immediate suite. */
export async function coverageBySuite(db: Database, projectId: string, filters: CoverageFilters) {
  const conditions = await caseFilterConditions(db, projectId, filters);
  return db
    .select({
      key: s.suites.id,
      label: s.suites.name,
      total: sql<number>`count(*)::int`,
      automated: sql<number>`count(*) filter (where ${hasBinding()})::int`,
      manual: sql<number>`count(*) filter (where not ${hasBinding()} and ${everExecuted()})::int`,
      neverExecuted: sql<number>`count(*) filter (where not ${hasBinding()} and not ${everExecuted()})::int`,
    })
    .from(s.testCases)
    .innerJoin(s.suites, eq(s.suites.id, s.testCases.suiteId))
    .where(and(...conditions))
    .groupBy(s.suites.id, s.suites.name)
    .orderBy(sql`count(*) desc`, s.suites.name);
}

/** The individual cases behind the manual and never-executed buckets. */
export async function uncoveredCases(
  db: Database,
  projectId: string,
  filters: CoverageFilters,
  limit = 500,
) {
  const conditions = await caseFilterConditions(db, projectId, filters);
  const where = and(...conditions, sql`not ${hasBinding()}`);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(s.testCases)
    .where(where);

  const rows = await db
    .select({
      id: s.testCases.id,
      ref: s.testCases.ref,
      title: s.testCases.title,
      suiteName: s.suites.name,
      priority: s.testCases.priority,
      everExecuted: sql<boolean>`${everExecuted()}`,
      tags: sql<string[]>`coalesce((
        select array_agg(t.name order by t.name) from ${s.caseTags} ct
        join ${s.tags} t on t.id = ct.tag_id where ct.case_id = ${s.testCases.id}
      ), '{}')`,
    })
    .from(s.testCases)
    .innerJoin(s.suites, eq(s.suites.id, s.testCases.suiteId))
    .where(where)
    .orderBy(s.testCases.ref)
    .limit(limit);

  return { cases: rows, total: counted?.total ?? 0 };
}
