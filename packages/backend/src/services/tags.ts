import { normalizeTags } from '@tcms/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';

/**
 * Resolves tag names to ids, creating any that do not exist. Names are normalised first, so
 * "End-To-End" and "end to end" converge on one row rather than creating two (Decision 2).
 */
export async function resolveTagIds(
  db: Database,
  projectId: string,
  rawNames: readonly string[],
): Promise<{ ids: string[]; names: string[] }> {
  const names = normalizeTags(rawNames);
  if (names.length === 0) return { ids: [], names: [] };

  // onConflictDoNothing makes concurrent creation of the same tag safe.
  await db
    .insert(s.tags)
    .values(names.map((name) => ({ projectId, name })))
    .onConflictDoNothing();

  const rows = await db
    .select({ id: s.tags.id, name: s.tags.name })
    .from(s.tags)
    .where(and(eq(s.tags.projectId, projectId), inArray(s.tags.name, names)));

  const byName = new Map(rows.map((r) => [r.name, r.id]));
  return { ids: names.map((n) => byName.get(n)).filter((id): id is string => Boolean(id)), names };
}

/** Existing tags with usage counts, for the autocomplete that keeps entry converging. */
export async function listTags(db: Database, projectId: string, prefix?: string) {
  const normalizedPrefix = prefix?.toLowerCase().trim();
  const rows = await db
    .select({
      name: s.tags.name,
      usageCount: sql<number>`count(${s.caseTags.caseId})::int`,
    })
    .from(s.tags)
    .leftJoin(s.caseTags, eq(s.caseTags.tagId, s.tags.id))
    .where(
      normalizedPrefix
        ? and(eq(s.tags.projectId, projectId), sql`${s.tags.name} like ${`${normalizedPrefix}%`}`)
        : eq(s.tags.projectId, projectId),
    )
    .groupBy(s.tags.name)
    .orderBy(sql`count(${s.caseTags.caseId}) desc`, s.tags.name);
  return rows;
}
