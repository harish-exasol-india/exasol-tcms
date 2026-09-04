/**
 * Quality metrics and trends (AC 7).
 *
 * Flakiness is defined as differing outcomes across runs of the *same commit*. JUnit XML
 * carries no retry information (design Decision 8), so within-run retries are invisible;
 * cross-run detection is what remains and is what this implements.
 *
 * Every series is bounded by the retention window, and says so — a short series must not be
 * read as a quiet period when it is actually the edge of retained history (Decision 11).
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { coverageSummary } from './coverage.js';

export async function metrics(
  db: Database,
  projectId: string,
  options: { days: number; releaseId?: string | undefined; retentionMonths: number },
) {
  const retentionDays = options.retentionMonths * 30;
  const effectiveDays = Math.min(options.days, retentionDays);
  const from = new Date(Date.now() - effectiveDays * 86_400_000);

  const conditions = [eq(s.caseResults.projectId, projectId), gte(s.caseResults.executedAt, from)];
  if (options.releaseId) {
    const runsInRelease = db
      .select({ id: s.runs.id })
      .from(s.runs)
      .where(eq(s.runs.releaseId, options.releaseId));
    conditions.push(sql`${s.caseResults.runId} in ${runsInRelease}`);
  }

  const [totals] = await db
    .select({
      executions: sql<number>`count(*)::int`,
      passed: sql<number>`count(*) filter (where ${s.caseResults.outcome} = 'passed')::int`,
      failed: sql<number>`count(*) filter (where ${s.caseResults.outcome} = 'failed')::int`,
      runtimeMsP50: sql<
        number | null
      >`percentile_disc(0.5) within group (order by ${s.caseResults.durationMs})`,
      runtimeMsP95: sql<
        number | null
      >`percentile_disc(0.95) within group (order by ${s.caseResults.durationMs})`,
      totalRuntimeMs: sql<number>`coalesce(sum(${s.caseResults.durationMs}), 0)::bigint`,
    })
    .from(s.caseResults)
    .where(and(...conditions));

  const executions = totals?.executions ?? 0;
  const decided = (totals?.passed ?? 0) + (totals?.failed ?? 0);

  const trendRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${s.caseResults.executedAt}), 'YYYY-MM-DD')`,
      executions: sql<number>`count(*)::int`,
      passed: sql<number>`count(*) filter (where ${s.caseResults.outcome} = 'passed')::int`,
      failed: sql<number>`count(*) filter (where ${s.caseResults.outcome} = 'failed')::int`,
      runtimeMsP50: sql<
        number | null
      >`percentile_disc(0.5) within group (order by ${s.caseResults.durationMs})`,
    })
    .from(s.caseResults)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('day', ${s.caseResults.executedAt})`)
    .orderBy(sql`date_trunc('day', ${s.caseResults.executedAt})`);

  // ---- flakiness: same case, same commit, differing outcomes ---------------------------
  const flakyRows = await db.execute<{
    case_ref: string;
    case_title: string;
    commit_sha: string;
    outcomes: string[];
    changes: number;
  }>(sql`
    select tc.ref as case_ref, tc.title as case_title, r.commit_sha,
           array_agg(distinct cr.outcome) as outcomes,
           count(distinct cr.outcome)::int as changes
    from ${s.caseResults} cr
    join ${s.runs} r on r.id = cr.run_id
    join ${s.testCases} tc on tc.id = cr.case_id
    where cr.project_id = ${projectId}
      and cr.executed_at >= ${from.toISOString()}
      and r.commit_sha is not null
    group by tc.ref, tc.title, r.commit_sha
    having count(distinct cr.outcome) > 1
    order by count(distinct cr.outcome) desc, tc.ref
    limit 100
  `);

  // ---- defect age bands, measured from when the link was recorded ----------------------
  const defectRows = await db.execute<{ band: string; count: number }>(sql`
    select band, count(*)::int as count from (
      select case
        when now() - dl.linked_at < interval '7 days' then '0-7 days'
        when now() - dl.linked_at < interval '30 days' then '8-30 days'
        when now() - dl.linked_at < interval '90 days' then '31-90 days'
        else '90+ days'
      end as band
      from ${s.defectLinks} dl
      join ${s.runCases} rc on rc.id = dl.run_case_id
      join ${s.runs} r on r.id = rc.run_id
      where r.project_id = ${projectId}
    ) x group by band
    order by min(case band
      when '0-7 days' then 1 when '8-30 days' then 2 when '31-90 days' then 3 else 4 end)
  `);

  return {
    window: {
      days: effectiveDays,
      from: from.toISOString(),
      to: new Date().toISOString(),
      retentionMonths: options.retentionMonths,
    },
    totals: {
      executions,
      passRate: decided === 0 ? 0 : Math.round(((totals?.passed ?? 0) / decided) * 1000) / 10,
      failureRate: decided === 0 ? 0 : Math.round(((totals?.failed ?? 0) / decided) * 1000) / 10,
      runtimeMsP50: totals?.runtimeMsP50 === null ? null : Number(totals?.runtimeMsP50),
      runtimeMsP95: totals?.runtimeMsP95 === null ? null : Number(totals?.runtimeMsP95),
      totalRuntimeMs: Number(totals?.totalRuntimeMs ?? 0),
    },
    coverage: await coverageSummary(db, projectId, {}),
    trend: trendRows.map((row) => {
      const dayDecided = row.passed + row.failed;
      return {
        day: row.day,
        executions: row.executions,
        passRate: dayDecided === 0 ? 0 : Math.round((row.passed / dayDecided) * 1000) / 10,
        failureRate: dayDecided === 0 ? 0 : Math.round((row.failed / dayDecided) * 1000) / 10,
        runtimeMsP50: row.runtimeMsP50 === null ? null : Number(row.runtimeMsP50),
      };
    }),
    // Says explicitly when the requested window was clipped by retention.
    trendTruncated: options.days > retentionDays,
    flaky: flakyRows.rows.map((r) => ({
      caseRef: r.case_ref,
      caseTitle: r.case_title,
      commitSha: r.commit_sha,
      outcomes: r.outcomes,
      changes: Number(r.changes),
    })),
    defectAgeBands: defectRows.rows.map((r) => ({ band: r.band, count: Number(r.count) })),
  };
}
