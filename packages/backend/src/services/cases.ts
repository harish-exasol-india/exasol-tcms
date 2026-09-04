import type { CreateCaseRequest, UpdateCaseRequest } from '@tcms/shared';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { badRequest, notFound } from '../http/errors.js';
import type { RequestContext } from './context.js';
import { changedFieldsBetween, recordCaseHistory } from './history.js';
import { suitePath, suiteSubtreeIds } from './suites.js';
import { resolveTagIds } from './tags.js';

/**
 * Allocates the next human-readable reference for a project (EXA-1234).
 *
 * AC 2 calls these stable identifiers, so a reference is never reused: the next number comes
 * from the highest ever allocated, not from the current row count.
 */
async function nextRef(db: Database, projectId: string, projectKey: string): Promise<string> {
  const result = await db.execute<{ next: number }>(sql`
    select coalesce(max((regexp_match(ref, '^[A-Z0-9]+-(\\d+)$'))[1]::int), 0) + 1 as next
    from ${s.testCases} where project_id = ${projectId}
  `);
  return `${projectKey.toUpperCase().replace(/[^A-Z0-9]/g, '')}-${result.rows[0]?.next ?? 1}`;
}

async function replaceSteps(
  db: Database,
  caseId: string,
  steps: CreateCaseRequest['steps'],
): Promise<void> {
  await db.delete(s.caseSteps).where(eq(s.caseSteps.caseId, caseId));
  await db.insert(s.caseSteps).values(
    steps.map((step, index) => ({
      caseId,
      position: index + 1,
      action: step.action ?? null,
      expected: step.expected ?? null,
      sharedStepId: step.sharedStepId ?? null,
    })),
  );
}

async function replaceTags(
  db: Database,
  projectId: string,
  caseId: string,
  tags: readonly string[],
): Promise<string[]> {
  const { ids, names } = await resolveTagIds(db, projectId, tags);
  await db.delete(s.caseTags).where(eq(s.caseTags.caseId, caseId));
  if (ids.length > 0) {
    await db
      .insert(s.caseTags)
      .values(ids.map((tagId) => ({ caseId, tagId })))
      .onConflictDoNothing();
  }
  return names;
}

/** Loads one case with steps (shared steps resolved), tags, and its suite path. */
export async function getCase(db: Database, projectId: string, caseId: string) {
  const [row] = await db
    .select({
      id: s.testCases.id,
      ref: s.testCases.ref,
      projectId: s.testCases.projectId,
      suiteId: s.testCases.suiteId,
      title: s.testCases.title,
      ownerId: s.testCases.ownerId,
      ownerName: s.users.displayName,
      priority: s.testCases.priority,
      risk: s.testCases.risk,
      preconditions: s.testCases.preconditions,
      isAutomated: s.testCases.isAutomated,
      customFields: s.testCases.customFields,
      createdAt: s.testCases.createdAt,
      updatedAt: s.testCases.updatedAt,
    })
    .from(s.testCases)
    .leftJoin(s.users, eq(s.users.id, s.testCases.ownerId))
    .where(
      and(
        eq(s.testCases.id, caseId),
        eq(s.testCases.projectId, projectId),
        isNull(s.testCases.deletedAt),
      ),
    );
  if (!row) throw notFound('Test case not found');

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
    .where(eq(s.caseSteps.caseId, caseId))
    .orderBy(asc(s.caseSteps.position));

  // Shared step content is resolved at read time, so a case always renders the block's
  // current content (design Decision 12).
  const sharedIds = stepRows.map((r) => r.sharedStepId).filter((id): id is string => Boolean(id));
  const sharedItems = sharedIds.length
    ? await db
        .select()
        .from(s.sharedStepItems)
        .where(inArray(s.sharedStepItems.sharedStepId, sharedIds))
        .orderBy(asc(s.sharedStepItems.position))
    : [];

  const tagRows = await db
    .select({ name: s.tags.name })
    .from(s.caseTags)
    .innerJoin(s.tags, eq(s.tags.id, s.caseTags.tagId))
    .where(eq(s.caseTags.caseId, caseId))
    .orderBy(asc(s.tags.name));

  return {
    ...row,
    suitePath: await suitePath(db, row.suiteId),
    tags: tagRows.map((t) => t.name),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    steps: stepRows.map((step) => ({
      ...step,
      sharedStepItems: step.sharedStepId
        ? sharedItems
            .filter((i) => i.sharedStepId === step.sharedStepId)
            .map((i) => ({ position: i.position, action: i.action, expected: i.expected }))
        : null,
    })),
  };
}

export async function createCase(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  projectKey: string,
  input: CreateCaseRequest,
) {
  const [suite] = await db
    .select({ id: s.suites.id })
    .from(s.suites)
    .where(and(eq(s.suites.id, input.suiteId), eq(s.suites.projectId, projectId)));
  if (!suite) throw notFound('Suite not found');

  const createdRows = await db
    .insert(s.testCases)
    .values({
      projectId,
      suiteId: input.suiteId,
      ref: await nextRef(db, projectId, projectKey),
      title: input.title,
      ownerId: input.ownerId ?? null,
      priority: input.priority,
      risk: input.risk,
      preconditions: input.preconditions ?? null,
      customFields: input.customFields ?? null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning();
  const created = expectOne(createdRows, 'test case insert');

  await replaceSteps(db, created.id, input.steps);
  await replaceTags(db, projectId, created.id, input.tags);
  await recordCaseHistory(db, ctx, {
    caseId: created.id,
    action: 'created',
    changedFields: ['title', 'suiteId', 'priority', 'risk', 'steps', 'tags'],
    after: { title: input.title, suiteId: input.suiteId, priority: input.priority },
  });

  return getCase(db, projectId, created.id);
}

export async function updateCase(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  caseId: string,
  input: UpdateCaseRequest,
) {
  const before = await getCase(db, projectId, caseId);

  if (input.suiteId) {
    const [suite] = await db
      .select({ id: s.suites.id })
      .from(s.suites)
      .where(and(eq(s.suites.id, input.suiteId), eq(s.suites.projectId, projectId)));
    if (!suite) throw notFound('Suite not found');
  }
  if (input.steps && input.steps.length === 0) {
    throw badRequest('At least one step is required');
  }

  await db
    .update(s.testCases)
    .set({
      ...(input.suiteId === undefined ? {} : { suiteId: input.suiteId }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId ?? null }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.risk === undefined ? {} : { risk: input.risk }),
      ...(input.preconditions === undefined ? {} : { preconditions: input.preconditions ?? null }),
      ...(input.customFields === undefined ? {} : { customFields: input.customFields }),
      updatedAt: ctx.now,
    })
    .where(eq(s.testCases.id, caseId));

  if (input.steps) await replaceSteps(db, caseId, input.steps);
  if (input.tags) await replaceTags(db, projectId, caseId, input.tags);

  const after = await getCase(db, projectId, caseId);
  const changed = changedFieldsBetween(
    before as unknown as Record<string, unknown>,
    after as unknown as Record<string, unknown>,
  );
  if (changed.length > 0) {
    await recordCaseHistory(db, ctx, {
      caseId,
      action: 'updated',
      changedFields: changed,
      before: { title: before.title, suiteId: before.suiteId, priority: before.priority },
      after: { title: after.title, suiteId: after.suiteId, priority: after.priority },
    });
  }
  return after;
}

/** Soft delete: history and past execution references survive (AC 1). */
export async function deleteCase(
  db: Database,
  ctx: RequestContext,
  projectId: string,
  caseId: string,
) {
  const existing = await getCase(db, projectId, caseId);
  await db
    .update(s.testCases)
    .set({ deletedAt: ctx.now, updatedAt: ctx.now })
    .where(eq(s.testCases.id, caseId));
  await recordCaseHistory(db, ctx, {
    caseId,
    action: 'deleted',
    changedFields: ['deletedAt'],
    before: { title: existing.title },
  });
}

export type ListCasesOptions = {
  suiteId?: string;
  includeDescendants?: boolean;
  tags?: string[];
  automated?: boolean;
  search?: string;
  limit: number;
  cursor?: string;
};

/**
 * Paginated case listing. Keyset pagination on (ref) rather than OFFSET, so deep pages stay
 * cheap at 25k cases and the list does not shift under concurrent inserts.
 */
export async function listCases(db: Database, projectId: string, options: ListCasesOptions) {
  const conditions = [eq(s.testCases.projectId, projectId), isNull(s.testCases.deletedAt)];

  if (options.suiteId) {
    const ids =
      options.includeDescendants === false
        ? [options.suiteId]
        : await suiteSubtreeIds(db, projectId, options.suiteId);
    conditions.push(inArray(s.testCases.suiteId, ids));
  }
  if (options.automated !== undefined) {
    conditions.push(eq(s.testCases.isAutomated, options.automated));
  }
  if (options.search) {
    conditions.push(
      sql`(${s.testCases.title} ilike ${`%${options.search}%`} or ${s.testCases.ref} ilike ${`%${options.search}%`})`,
    );
  }
  if (options.tags?.length) {
    // Subquery rather than a join, so a case matching two tags is not returned twice.
    const taggedCaseIds = db
      .select({ caseId: s.caseTags.caseId })
      .from(s.caseTags)
      .innerJoin(s.tags, eq(s.tags.id, s.caseTags.tagId))
      .where(inArray(s.tags.name, options.tags));
    conditions.push(inArray(s.testCases.id, taggedCaseIds));
  }
  // `total` is the size of the whole filtered set, so it must be counted before the cursor
  // narrows it — otherwise the count shrinks as the caller pages through.
  const filterConditions = [...conditions];
  if (options.cursor) conditions.push(gt(s.testCases.ref, options.cursor));

  const where = and(...conditions);

  const [counted] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(s.testCases)
    .where(and(...filterConditions));

  const rows = await db
    .select({
      id: s.testCases.id,
      ref: s.testCases.ref,
      projectId: s.testCases.projectId,
      suiteId: s.testCases.suiteId,
      suiteName: s.suites.name,
      title: s.testCases.title,
      ownerId: s.testCases.ownerId,
      ownerName: s.users.displayName,
      priority: s.testCases.priority,
      risk: s.testCases.risk,
      preconditions: s.testCases.preconditions,
      isAutomated: s.testCases.isAutomated,
      createdAt: s.testCases.createdAt,
      updatedAt: s.testCases.updatedAt,
      tags: sql<string[]>`coalesce((
        select array_agg(t.name order by t.name) from ${s.caseTags} ct
        join ${s.tags} t on t.id = ct.tag_id where ct.case_id = ${s.testCases.id}
      ), '{}')`,
    })
    .from(s.testCases)
    .leftJoin(s.users, eq(s.users.id, s.testCases.ownerId))
    .innerJoin(s.suites, eq(s.suites.id, s.testCases.suiteId))
    .where(where)
    .orderBy(asc(s.testCases.ref))
    .limit(options.limit + 1);

  const page = rows.slice(0, options.limit);
  return {
    items: page.map((r) => ({
      ...r,
      suitePath: [r.suiteName],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: counted?.total ?? 0,
    nextCursor: rows.length > options.limit ? (page.at(-1)?.ref ?? null) : null,
  };
}
