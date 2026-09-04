/**
 * Execution history retention (AC 1, design Decision 11).
 *
 * A flat window: everything older than the configured months is deleted, uniformly, with no
 * carve-out by asset type. Managed test assets — cases, suites, shared steps, plans and
 * their history — are never touched; only execution history ages out.
 *
 * Results are removed by dropping whole monthly partitions rather than by a mass DELETE,
 * which is why the table is partitioned in the first place (Decision 20). Attachments are
 * deleted alongside their runs so that no object outlives the row referencing it.
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { deleteAttachmentsForRuns } from './evidence.js';
import type { ObjectStore } from './storage.js';

export type RetentionReport = {
  cutoff: string;
  partitionsDropped: string[];
  runsDeleted: number;
  attachmentsDeleted: number;
  dryRun: boolean;
};

/** The monthly partitions of case_result that lie entirely before the cutoff. */
export async function expiredPartitions(db: Database, cutoff: Date): Promise<string[]> {
  const rows = await db.execute<{ partition: string; upper_bound: string }>(sql`
    select c.relname as partition,
           -- The upper bound is the exclusive end of the partition's range.
           (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \\(''([^'']+)''\\)'))[1] as upper_bound
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'case_result'
      and pg_get_expr(c.relpartbound, c.oid) not like '%DEFAULT%'
  `);

  return rows.rows
    .filter((r) => r.upper_bound && new Date(r.upper_bound) <= cutoff)
    .map((r) => r.partition);
}

export async function applyRetention(
  db: Database,
  store: ObjectStore,
  options: { retentionMonths: number; dryRun?: boolean; now?: Date },
): Promise<RetentionReport> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - options.retentionMonths);

  const partitions = await expiredPartitions(db, cutoff);

  const expiredRuns = await db
    .select({ id: s.runs.id })
    .from(s.runs)
    .where(and(eq(s.runs.projectId, s.runs.projectId), lt(s.runs.startedAt, cutoff)));
  const runIds = expiredRuns.map((r) => r.id);

  if (options.dryRun) {
    const attachmentCount = runIds.length
      ? ((
          await db
            .select({ count: sql<number>`count(*)::int` })
            .from(s.attachments)
            .where(inArray(s.attachments.runId, runIds))
        )[0]?.count ?? 0)
      : 0;
    return {
      cutoff: cutoff.toISOString(),
      partitionsDropped: partitions,
      runsDeleted: runIds.length,
      attachmentsDeleted: attachmentCount,
      dryRun: true,
    };
  }

  // Objects first: a failure here must not leave rows pointing at deleted files, and
  // re-running is safe because deleting an absent object is a no-op.
  const attachmentsDeleted = await deleteAttachmentsForRuns(db, store, runIds);

  for (const partition of partitions) {
    await db.execute(sql.raw(`drop table if exists ${partition}`));
  }

  // Runs cascade to run_case, step_result, and defect_link.
  if (runIds.length > 0) {
    await db.delete(s.runs).where(inArray(s.runs.id, runIds));
  }

  return {
    cutoff: cutoff.toISOString(),
    partitionsDropped: partitions,
    runsDeleted: runIds.length,
    attachmentsDeleted,
    dryRun: false,
  };
}

/** Any attachment row whose run no longer exists — should always be zero after retention. */
export async function orphanedAttachmentCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.attachments)
    .where(sql`not exists (select 1 from ${s.runs} r where r.id = ${s.attachments.runId})`);
  return row?.count ?? 0;
}
