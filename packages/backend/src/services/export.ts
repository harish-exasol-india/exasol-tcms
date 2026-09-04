/**
 * Export for downstream reporting (AC 1, design Decision 21).
 *
 * Rows are streamed rather than buffered: an export of a full retention window is far too
 * large to assemble in memory, and a report that works in development but exhausts the heap
 * in production is not an export feature.
 *
 * Both paths enforce the caller's project role, so an export can never contain data the
 * caller could not read through the UI.
 */
import { and, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';

export type ResultExportFilters = {
  releaseId?: string | undefined;
  environmentId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
};

const RESULT_COLUMNS = [
  'case_ref',
  'case_title',
  'suite',
  'outcome',
  'executed_at',
  'duration_ms',
  'run_name',
  'release',
  'environment',
  'branch',
  'commit_sha',
  'triage_state',
  'failure_message',
] as const;

/** Escapes a value for CSV: quotes, newlines and separators are all handled. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(',')}\n`;
}

function resultConditions(projectId: string, filters: ResultExportFilters) {
  const conditions = [eq(s.caseResults.projectId, projectId)];
  if (filters.releaseId) conditions.push(eq(s.runs.releaseId, filters.releaseId));
  if (filters.environmentId) conditions.push(eq(s.runs.environmentId, filters.environmentId));
  if (filters.from) conditions.push(gte(s.caseResults.executedAt, filters.from));
  if (filters.to) conditions.push(lte(s.caseResults.executedAt, filters.to));
  return conditions;
}

const RESULT_SELECTION = {
  id: s.caseResults.id,
  caseRef: s.testCases.ref,
  caseTitle: s.testCases.title,
  suite: s.suites.name,
  outcome: s.caseResults.outcome,
  executedAt: s.caseResults.executedAt,
  durationMs: s.caseResults.durationMs,
  runName: s.runs.name,
  release: s.releases.name,
  environment: s.environments.name,
  branch: s.runs.branch,
  commitSha: s.runs.commitSha,
  triageState: s.caseResults.triageState,
  failureMessage: s.caseResults.failureMessage,
} as const;

/** The joined result shape used by every export path. */
function resultQuery(db: Database, conditions: SQL[], limit: number) {
  return db
    .select(RESULT_SELECTION)
    .from(s.caseResults)
    .innerJoin(s.runs, eq(s.runs.id, s.caseResults.runId))
    .innerJoin(s.testCases, eq(s.testCases.id, s.caseResults.caseId))
    .innerJoin(s.suites, eq(s.suites.id, s.testCases.suiteId))
    .leftJoin(s.releases, eq(s.releases.id, s.runs.releaseId))
    .leftJoin(s.environments, eq(s.environments.id, s.runs.environmentId))
    .where(and(...conditions))
    .orderBy(s.caseResults.executedAt, s.caseResults.id)
    .limit(limit);
}

export type ExportedResult = Awaited<ReturnType<typeof resultQuery>>[number];

/**
 * Yields results in batches. Keyset pagination on executed_at + id rather than OFFSET, so
 * memory stays flat and deep pages stay cheap.
 */
export async function* streamResults(
  db: Database,
  projectId: string,
  filters: ResultExportFilters,
  batchSize = 2000,
): AsyncGenerator<ExportedResult[]> {
  let after: { executedAt: Date; id: string } | null = null;

  for (;;) {
    const conditions = resultConditions(projectId, filters);
    if (after) {
      conditions.push(
        sql`(${s.caseResults.executedAt}, ${s.caseResults.id}) > (${after.executedAt.toISOString()}, ${after.id})`,
      );
    }

    const batch = await resultQuery(db, conditions, batchSize);
    if (batch.length === 0) return;
    yield batch;

    const last = batch.at(-1);
    if (!last || batch.length < batchSize) return;
    after = { executedAt: last.executedAt, id: last.id };
  }
}

export const resultCsvHeader = csvRow(RESULT_COLUMNS);

export function resultToCsv(row: ExportedResult): string {
  return csvRow([
    row.caseRef,
    row.caseTitle,
    row.suite,
    row.outcome,
    row.executedAt,
    row.durationMs,
    row.runName,
    row.release,
    row.environment,
    row.branch,
    row.commitSha,
    row.triageState,
    row.failureMessage,
  ]);
}

/** Paginated programmatic access (AC 1). Every matching row appears exactly once. */
export async function pageResults(db: Database, projectId: string, filters: ResultExportFilters) {
  const limit = Math.min(filters.limit ?? 200, 1000);
  const conditions = resultConditions(projectId, filters);

  if (filters.cursor) {
    const [executedAt, id] = filters.cursor.split('|');
    if (executedAt && id) {
      conditions.push(
        sql`(${s.caseResults.executedAt}, ${s.caseResults.id}) > (${executedAt}, ${id})`,
      );
    }
  }

  // One extra row tells us whether a further page exists without a second count query.
  const rows = await resultQuery(db, conditions, limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    results: page.map((r) => ({ ...r, executedAt: r.executedAt.toISOString() })),
    nextCursor: rows.length > limit && last ? `${last.executedAt.toISOString()}|${last.id}` : null,
  };
}

/** Case export, for taking the managed repository out as a spreadsheet. */
export async function exportCases(db: Database, projectId: string, caseIds?: string[]) {
  const conditions = [eq(s.testCases.projectId, projectId), sql`${s.testCases.deletedAt} is null`];
  if (caseIds?.length) conditions.push(inArray(s.testCases.id, caseIds));

  return db
    .select({
      ref: s.testCases.ref,
      title: s.testCases.title,
      suite: s.suites.name,
      priority: s.testCases.priority,
      risk: s.testCases.risk,
      owner: s.users.displayName,
      automated: s.testCases.isAutomated,
      preconditions: s.testCases.preconditions,
      tags: sql<string>`coalesce((
        select string_agg(t.name, ' ' order by t.name) from ${s.caseTags} ct
        join ${s.tags} t on t.id = ct.tag_id where ct.case_id = ${s.testCases.id}
      ), '')`,
    })
    .from(s.testCases)
    .innerJoin(s.suites, eq(s.suites.id, s.testCases.suiteId))
    .leftJoin(s.users, eq(s.users.id, s.testCases.ownerId))
    .where(and(...conditions))
    .orderBy(s.testCases.ref);
}
