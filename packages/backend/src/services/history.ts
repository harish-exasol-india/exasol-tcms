import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { actorIdOf, originOf, type RequestContext } from './context.js';

type Snapshot = Record<string, unknown>;

/** Fields that differ between two snapshots, ignoring machine-managed columns. */
export function changedFieldsBetween(before: Snapshot, after: Snapshot): string[] {
  const ignored = new Set(['updatedAt', 'createdAt', 'id']);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (ignored.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed.sort();
}

/**
 * Appends a history entry. Called on every case mutation, so AC 1's change history holds
 * regardless of which interface performed the write (design Decision 10).
 */
export async function recordCaseHistory(
  db: Database,
  ctx: RequestContext,
  input: {
    caseId: string;
    action: 'created' | 'updated' | 'deleted' | 'restored';
    changedFields: string[];
    before?: Snapshot | null;
    after?: Snapshot | null;
  },
): Promise<void> {
  await db.insert(s.caseHistory).values({
    caseId: input.caseId,
    actorId: actorIdOf(ctx),
    origin: originOf(ctx),
    action: input.action,
    changedFields: input.changedFields,
    before: input.before ?? null,
    after: input.after ?? null,
    occurredAt: ctx.now,
  });
}

export async function listCaseHistory(db: Database, caseId: string) {
  return db
    .select({
      id: s.caseHistory.id,
      actorId: s.caseHistory.actorId,
      actorName: s.users.displayName,
      origin: s.caseHistory.origin,
      action: s.caseHistory.action,
      changedFields: s.caseHistory.changedFields,
      occurredAt: s.caseHistory.occurredAt,
    })
    .from(s.caseHistory)
    .leftJoin(s.users, eq(s.users.id, s.caseHistory.actorId))
    .where(eq(s.caseHistory.caseId, caseId))
    .orderBy(desc(s.caseHistory.occurredAt));
}
