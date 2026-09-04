import type { CreateSuiteRequest, UpdateSuiteRequest } from '@tcms/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { badRequest, notFound } from '../http/errors.js';

/** The suite tree with per-suite case counts. */
export async function listSuites(db: Database, projectId: string) {
  const suites = await db
    .select({
      id: s.suites.id,
      parentId: s.suites.parentId,
      name: s.suites.name,
      description: s.suites.description,
      position: s.suites.position,
    })
    .from(s.suites)
    .where(eq(s.suites.projectId, projectId))
    .orderBy(s.suites.position, s.suites.name);

  // Counted with a grouped query rather than a correlated subquery: a bare column
  // reference inside a raw `sql` template renders unqualified and silently resolves
  // against the wrong table, which yields zero for every suite.
  const counts = await db
    .select({
      suiteId: s.testCases.suiteId,
      caseCount: sql<number>`count(*)::int`,
    })
    .from(s.testCases)
    .where(and(eq(s.testCases.projectId, projectId), isNull(s.testCases.deletedAt)))
    .groupBy(s.testCases.suiteId);

  const bySuite = new Map(counts.map((c) => [c.suiteId, c.caseCount]));
  return suites.map((suite) => ({ ...suite, caseCount: bySuite.get(suite.id) ?? 0 }));
}

/** Ids of a suite and everything beneath it, for subtree-scoped queries. */
export async function suiteSubtreeIds(
  db: Database,
  projectId: string,
  rootId: string,
): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive subtree as (
      select id from ${s.suites} where id = ${rootId} and project_id = ${projectId}
      union all
      select child.id from ${s.suites} child
      join subtree on child.parent_id = subtree.id
    )
    select id from subtree
  `);
  return rows.rows.map((r) => r.id);
}

/** The names from the project root down to a suite, for breadcrumb display. */
export async function suitePath(db: Database, suiteId: string): Promise<string[]> {
  const rows = await db.execute<{ name: string; depth: number }>(sql`
    with recursive ancestry as (
      select id, parent_id, name, 0 as depth from ${s.suites} where id = ${suiteId}
      union all
      select parent.id, parent.parent_id, parent.name, ancestry.depth + 1
      from ${s.suites} parent join ancestry on ancestry.parent_id = parent.id
    )
    select name, depth from ancestry order by depth desc
  `);
  return rows.rows.map((r) => r.name);
}

export async function createSuite(db: Database, projectId: string, input: CreateSuiteRequest) {
  if (input.parentId) {
    const [parent] = await db
      .select({ id: s.suites.id })
      .from(s.suites)
      .where(and(eq(s.suites.id, input.parentId), eq(s.suites.projectId, projectId)));
    if (!parent) throw notFound('Parent suite not found');
  }
  const inserted = await db
    .insert(s.suites)
    .values({
      projectId,
      parentId: input.parentId ?? null,
      name: input.name,
      description: input.description ?? null,
    })
    .returning();
  return expectOne(inserted, 'suite insert');
}

export async function updateSuite(
  db: Database,
  projectId: string,
  suiteId: string,
  input: UpdateSuiteRequest,
) {
  const [existing] = await db
    .select()
    .from(s.suites)
    .where(and(eq(s.suites.id, suiteId), eq(s.suites.projectId, projectId)));
  if (!existing) throw notFound('Suite not found');

  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === suiteId) throw badRequest('A suite cannot be its own parent');
    // Moving a suite beneath its own descendant would detach the subtree from the root.
    const descendants = await suiteSubtreeIds(db, projectId, suiteId);
    if (descendants.includes(input.parentId)) {
      throw badRequest('A suite cannot be moved beneath its own descendant', 'CYCLIC_MOVE');
    }
  }

  const updated = await db
    .update(s.suites)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    })
    .where(eq(s.suites.id, suiteId))
    .returning();
  return expectOne(updated, 'suite update');
}

export async function deleteSuite(db: Database, projectId: string, suiteId: string) {
  const ids = await suiteSubtreeIds(db, projectId, suiteId);
  if (ids.length === 0) throw notFound('Suite not found');

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.testCases)
    .where(and(inArray(s.testCases.suiteId, ids), isNull(s.testCases.deletedAt)));
  const count = counted?.count ?? 0;
  if (count > 0) {
    throw badRequest(
      `Suite still contains ${count} case(s); move or delete them first`,
      'SUITE_NOT_EMPTY',
    );
  }
  await db.delete(s.suites).where(inArray(s.suites.id, ids));
}
