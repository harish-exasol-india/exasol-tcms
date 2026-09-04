import type {
  CreateCustomFieldRequest,
  CreateSharedStepRequest,
  UpdateSharedStepRequest,
} from '@tcms/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { badRequest, notFound } from '../http/errors.js';

/**
 * Shared steps with their blast radius.
 *
 * Because runs render the latest case content (design Decision 9), editing a shared step
 * changes what every in-flight run referencing it shows — across all projects. That fan-out
 * is the compounding risk named in the design, so the counts are computed here and surfaced
 * in the editor before an edit proceeds.
 */
export async function listSharedSteps(db: Database, projectId: string) {
  const blocks = await db
    .select({ id: s.sharedSteps.id, name: s.sharedSteps.name })
    .from(s.sharedSteps)
    .where(eq(s.sharedSteps.projectId, projectId))
    .orderBy(asc(s.sharedSteps.name));

  if (blocks.length === 0) return [];
  const ids = blocks.map((b) => b.id);

  const items = await db
    .select()
    .from(s.sharedStepItems)
    .where(inArray(s.sharedStepItems.sharedStepId, ids))
    .orderBy(asc(s.sharedStepItems.position));

  // How many cases reference each block.
  const references = await db
    .select({
      sharedStepId: s.caseSteps.sharedStepId,
      caseCount: sql<number>`count(distinct ${s.caseSteps.caseId})::int`,
    })
    .from(s.caseSteps)
    .where(inArray(s.caseSteps.sharedStepId, ids))
    .groupBy(s.caseSteps.sharedStepId);

  // How many currently-open runs would change content if the block were edited. This is
  // the fan-out that design Decision 9 makes possible and the editor must surface.
  const openRuns = await db
    .select({
      sharedStepId: s.caseSteps.sharedStepId,
      runCount: sql<number>`count(distinct ${s.runCases.runId})::int`,
    })
    .from(s.caseSteps)
    .innerJoin(s.runCases, eq(s.runCases.caseId, s.caseSteps.caseId))
    .innerJoin(s.runs, eq(s.runs.id, s.runCases.runId))
    .where(and(inArray(s.caseSteps.sharedStepId, ids), eq(s.runs.status, 'open')))
    .groupBy(s.caseSteps.sharedStepId);

  const refByBlock = new Map(references.map((r) => [r.sharedStepId, r.caseCount]));
  const runsByBlock = new Map(openRuns.map((r) => [r.sharedStepId, r.runCount]));

  return blocks.map((block) => ({
    id: block.id,
    name: block.name,
    referencingCaseCount: refByBlock.get(block.id) ?? 0,
    affectedOpenRunCount: runsByBlock.get(block.id) ?? 0,
    items: items
      .filter((i) => i.sharedStepId === block.id)
      .map((i) => ({ position: i.position, action: i.action, expected: i.expected })),
  }));
}

export async function getSharedStep(db: Database, projectId: string, id: string) {
  const all = await listSharedSteps(db, projectId);
  const found = all.find((b) => b.id === id);
  if (!found) throw notFound('Shared step not found');
  return found;
}

export async function createSharedStep(
  db: Database,
  projectId: string,
  input: CreateSharedStepRequest,
) {
  const created = expectOne(
    await db.insert(s.sharedSteps).values({ projectId, name: input.name }).returning(),
    'shared step insert',
  );
  await db.insert(s.sharedStepItems).values(
    input.items.map((item, index) => ({
      sharedStepId: created.id,
      position: index + 1,
      action: item.action,
      expected: item.expected ?? null,
    })),
  );
  return getSharedStep(db, projectId, created.id);
}

export async function updateSharedStep(
  db: Database,
  projectId: string,
  id: string,
  input: UpdateSharedStepRequest,
) {
  await getSharedStep(db, projectId, id);
  if (input.name !== undefined) {
    await db
      .update(s.sharedSteps)
      .set({ name: input.name, updatedAt: new Date() })
      .where(eq(s.sharedSteps.id, id));
  }
  if (input.items) {
    await db.delete(s.sharedStepItems).where(eq(s.sharedStepItems.sharedStepId, id));
    await db.insert(s.sharedStepItems).values(
      input.items.map((item, index) => ({
        sharedStepId: id,
        position: index + 1,
        action: item.action,
        expected: item.expected ?? null,
      })),
    );
  }
  return getSharedStep(db, projectId, id);
}

export async function deleteSharedStep(db: Database, projectId: string, id: string) {
  const block = await getSharedStep(db, projectId, id);
  if (block.referencingCaseCount > 0) {
    throw badRequest(
      `Shared step is referenced by ${block.referencingCaseCount} case(s)`,
      'SHARED_STEP_IN_USE',
    );
  }
  await db.delete(s.sharedSteps).where(eq(s.sharedSteps.id, id));
}

/** Custom field definitions with usage counts, so removal can warn about impact. */
export async function listCustomFields(db: Database, projectId: string) {
  const definitions = await db
    .select({
      id: s.customFieldDefinitions.id,
      key: s.customFieldDefinitions.key,
      label: s.customFieldDefinitions.label,
      type: s.customFieldDefinitions.type,
      options: s.customFieldDefinitions.options,
    })
    .from(s.customFieldDefinitions)
    .where(eq(s.customFieldDefinitions.projectId, projectId))
    .orderBy(asc(s.customFieldDefinitions.label));

  if (definitions.length === 0) return [];

  // Counts, per custom-field key, how many live cases carry a value. Expanding the jsonb
  // object's keys avoids passing an array parameter, which Drizzle flattens to a scalar.
  const usage = await db.execute<{ key: string; usage_count: string }>(sql`
    select k.key, count(*)::int as usage_count
    from ${s.testCases} tc,
         lateral jsonb_object_keys(tc.custom_fields) as k(key)
    where tc.project_id = ${projectId}
      and tc.deleted_at is null
      and tc.custom_fields is not null
    group by k.key
  `);
  const byKey = new Map(usage.rows.map((r) => [r.key, Number(r.usage_count)]));

  return definitions.map((d) => ({ ...d, usageCount: byKey.get(d.key) ?? 0 }));
}

export async function createCustomField(
  db: Database,
  projectId: string,
  input: CreateCustomFieldRequest,
) {
  if (input.type === 'select' && (!input.options || input.options.length === 0)) {
    throw badRequest('A select field requires at least one option');
  }
  const [existing] = await db
    .select({ id: s.customFieldDefinitions.id })
    .from(s.customFieldDefinitions)
    .where(
      and(
        eq(s.customFieldDefinitions.projectId, projectId),
        eq(s.customFieldDefinitions.key, input.key),
      ),
    );
  if (existing)
    throw badRequest(`A custom field with key '${input.key}' already exists`, 'DUPLICATE_KEY');

  return expectOne(
    await db
      .insert(s.customFieldDefinitions)
      .values({
        projectId,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options ?? null,
      })
      .returning(),
    'custom field insert',
  );
}

/** Reports how many cases carry a value, so the caller can warn before removing. */
export async function customFieldUsage(db: Database, projectId: string, id: string) {
  const fields = await listCustomFields(db, projectId);
  const field = fields.find((f) => f.id === id);
  if (!field) throw notFound('Custom field not found');
  return field;
}

export async function deleteCustomField(db: Database, projectId: string, id: string) {
  await customFieldUsage(db, projectId, id);
  await db.delete(s.customFieldDefinitions).where(eq(s.customFieldDefinitions.id, id));
}
