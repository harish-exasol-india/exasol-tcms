/**
 * Test plans, environments, and releases (AC 5, AC 4).
 *
 * A plan is a named, reusable case selection. Its membership is snapshotted into a run at
 * creation time so that editing the plan afterwards cannot retroactively change what an
 * existing run contained (test-planning spec).
 */
import type {
  CreateEnvironmentRequest,
  CreatePlanRequest,
  CreateReleaseRequest,
  UpdatePlanRequest,
  UpdateReleaseRequest,
} from '@tcms/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { badRequest, notFound } from '../http/errors.js';

// ---- plans ----------------------------------------------------------------------------

export async function listPlans(db: Database, projectId: string) {
  const plans = await db
    .select({
      id: s.testPlans.id,
      name: s.testPlans.name,
      description: s.testPlans.description,
      createdAt: s.testPlans.createdAt,
    })
    .from(s.testPlans)
    .where(eq(s.testPlans.projectId, projectId))
    .orderBy(s.testPlans.name);

  if (plans.length === 0) return [];
  const counts = await db
    .select({
      planId: s.testPlanCases.planId,
      caseCount: sql<number>`count(*)::int`,
    })
    .from(s.testPlanCases)
    .where(
      inArray(
        s.testPlanCases.planId,
        plans.map((p) => p.id),
      ),
    )
    .groupBy(s.testPlanCases.planId);
  const byPlan = new Map(counts.map((c) => [c.planId, c.caseCount]));

  return plans.map((p) => ({
    ...p,
    caseCount: byPlan.get(p.id) ?? 0,
    createdAt: p.createdAt.toISOString(),
  }));
}

async function assertCasesBelong(db: Database, projectId: string, caseIds: string[]) {
  if (caseIds.length === 0) return;
  const found = await db
    .select({ id: s.testCases.id })
    .from(s.testCases)
    .where(
      and(
        eq(s.testCases.projectId, projectId),
        isNull(s.testCases.deletedAt),
        inArray(s.testCases.id, caseIds),
      ),
    );
  if (found.length !== new Set(caseIds).size) {
    throw badRequest('One or more cases do not belong to this project', 'INVALID_CASES');
  }
}

export async function createPlan(
  db: Database,
  projectId: string,
  userId: string | null,
  input: CreatePlanRequest,
) {
  await assertCasesBelong(db, projectId, input.caseIds);
  const plan = expectOne(
    await db
      .insert(s.testPlans)
      .values({
        projectId,
        name: input.name,
        description: input.description ?? null,
        createdBy: userId,
      })
      .returning(),
    'test plan insert',
  );
  if (input.caseIds.length > 0) {
    await db
      .insert(s.testPlanCases)
      .values(input.caseIds.map((caseId) => ({ planId: plan.id, caseId })))
      .onConflictDoNothing();
  }
  return plan;
}

export async function updatePlan(
  db: Database,
  projectId: string,
  planId: string,
  input: UpdatePlanRequest,
) {
  const [existing] = await db
    .select()
    .from(s.testPlans)
    .where(and(eq(s.testPlans.id, planId), eq(s.testPlans.projectId, projectId)));
  if (!existing) throw notFound('Test plan not found');

  if (input.name !== undefined || input.description !== undefined) {
    await db
      .update(s.testPlans)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description ?? null }),
      })
      .where(eq(s.testPlans.id, planId));
  }
  if (input.caseIds) {
    await assertCasesBelong(db, projectId, input.caseIds);
    await db.delete(s.testPlanCases).where(eq(s.testPlanCases.planId, planId));
    if (input.caseIds.length > 0) {
      await db
        .insert(s.testPlanCases)
        .values(input.caseIds.map((caseId) => ({ planId, caseId })))
        .onConflictDoNothing();
    }
  }
}

export async function planCaseIds(db: Database, planId: string): Promise<string[]> {
  const rows = await db
    .select({ caseId: s.testPlanCases.caseId })
    .from(s.testPlanCases)
    .where(eq(s.testPlanCases.planId, planId));
  return rows.map((r) => r.caseId);
}

export async function deletePlan(db: Database, projectId: string, planId: string) {
  const [existing] = await db
    .select()
    .from(s.testPlans)
    .where(and(eq(s.testPlans.id, planId), eq(s.testPlans.projectId, projectId)));
  if (!existing) throw notFound('Test plan not found');
  // Runs keep their own case membership, so deleting a plan cannot orphan a run.
  await db.delete(s.testPlans).where(eq(s.testPlans.id, planId));
}

// ---- environments ---------------------------------------------------------------------

export async function listEnvironments(db: Database, projectId: string) {
  const environments = await db
    .select({
      id: s.environments.id,
      name: s.environments.name,
      description: s.environments.description,
    })
    .from(s.environments)
    .where(eq(s.environments.projectId, projectId))
    .orderBy(s.environments.name);

  if (environments.length === 0) return [];
  const counts = await db
    .select({ environmentId: s.runs.environmentId, runCount: sql<number>`count(*)::int` })
    .from(s.runs)
    .where(eq(s.runs.projectId, projectId))
    .groupBy(s.runs.environmentId);
  const byEnv = new Map(counts.map((c) => [c.environmentId, c.runCount]));
  return environments.map((e) => ({ ...e, runCount: byEnv.get(e.id) ?? 0 }));
}

export async function createEnvironment(
  db: Database,
  projectId: string,
  input: CreateEnvironmentRequest,
) {
  const [existing] = await db
    .select({ id: s.environments.id })
    .from(s.environments)
    .where(and(eq(s.environments.projectId, projectId), eq(s.environments.name, input.name)));
  if (existing)
    throw badRequest(`An environment named '${input.name}' already exists`, 'DUPLICATE');

  return expectOne(
    await db
      .insert(s.environments)
      .values({ projectId, name: input.name, description: input.description ?? null })
      .returning(),
    'environment insert',
  );
}

export async function deleteEnvironment(db: Database, projectId: string, id: string) {
  const [existing] = await db
    .select()
    .from(s.environments)
    .where(and(eq(s.environments.id, id), eq(s.environments.projectId, projectId)));
  if (!existing) throw notFound('Environment not found');
  await db.delete(s.environments).where(eq(s.environments.id, id));
}

// ---- releases -------------------------------------------------------------------------

export async function listReleases(db: Database, projectId: string) {
  const releases = await db
    .select({
      id: s.releases.id,
      name: s.releases.name,
      status: s.releases.status,
      targetDate: s.releases.targetDate,
      createdAt: s.releases.createdAt,
    })
    .from(s.releases)
    .where(eq(s.releases.projectId, projectId))
    .orderBy(s.releases.name);

  if (releases.length === 0) return [];
  const counts = await db
    .select({ releaseId: s.runs.releaseId, runCount: sql<number>`count(*)::int` })
    .from(s.runs)
    .where(eq(s.runs.projectId, projectId))
    .groupBy(s.runs.releaseId);
  const byRelease = new Map(counts.map((c) => [c.releaseId, c.runCount]));

  return releases.map((r) => ({
    ...r,
    runCount: byRelease.get(r.id) ?? 0,
    targetDate: r.targetDate?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createRelease(db: Database, projectId: string, input: CreateReleaseRequest) {
  const [existing] = await db
    .select({ id: s.releases.id })
    .from(s.releases)
    .where(and(eq(s.releases.projectId, projectId), eq(s.releases.name, input.name)));
  if (existing) throw badRequest(`A release named '${input.name}' already exists`, 'DUPLICATE');

  return expectOne(
    await db
      .insert(s.releases)
      .values({
        projectId,
        name: input.name,
        status: input.status,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
      })
      .returning(),
    'release insert',
  );
}

export async function updateRelease(
  db: Database,
  projectId: string,
  releaseId: string,
  input: UpdateReleaseRequest,
) {
  const [existing] = await db
    .select()
    .from(s.releases)
    .where(and(eq(s.releases.id, releaseId), eq(s.releases.projectId, projectId)));
  if (!existing) throw notFound('Release not found');

  await db
    .update(s.releases)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.targetDate === undefined
        ? {}
        : { targetDate: input.targetDate ? new Date(input.targetDate) : null }),
    })
    .where(eq(s.releases.id, releaseId));
}
