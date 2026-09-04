/**
 * Representative seed data.
 *
 * Sized from the design's scale envelope (~25k cases, ~100k results/day) but scaled down by
 * default so it loads quickly; pass SEED_SCALE to grow it. Deliberately produces a mix that
 * exercises the reporting paths: automated and manual cases, bound and unbound results,
 * recurring failure signatures, and runs spread across releases and environments.
 */
import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { expectOne } from './expect.js';
import * as s from './schema/index.js';

type Scale = { suites: number; cases: number; runs: number; resultsPerRun: number };

export const defaultScale: Scale = { suites: 40, cases: 2000, runs: 30, resultsPerRun: 400 };

const pick = <T>(items: readonly T[], i: number): T => items[i % items.length] as T;

const TAG_NAMES = [
  'e2e',
  'integration',
  'performance',
  'security',
  'smoke',
  'release-8.0.x',
  'release-7.1.x',
  'nightly-etl',
  'bi-dashboard',
] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const RISKS = ['low', 'medium', 'high'] as const;
const FAILURES = [
  'AssertionError: expected 200 but got 503',
  'TimeoutError: waiting for selector ".grid-row" failed',
  'ConnectionError: could not connect to backend',
] as const;

export async function seed(db: Database, scale: Scale = defaultScale): Promise<void> {
  const project = expectOne(
    await db
      .insert(s.projects)
      .values({ key: 'exasol-db', name: 'Exasol Database', description: 'Seeded dataset' })
      .returning(),
    'project insert',
  );
  const projectId = project.id;

  const users = await db
    .insert(s.users)
    .values(
      Array.from({ length: 12 }, (_, i) => ({
        email: `seed.user${i}@exasol.com`,
        displayName: `Seed User ${i}`,
      })),
    )
    .returning();

  await db.insert(s.memberships).values(
    users.map((u, i) => ({
      userId: u.id,
      projectId,
      role: pick(['admin', 'lead', 'tester', 'tester', 'viewer'] as const, i),
    })),
  );

  // Suite tree: product -> component -> module
  const product = expectOne(
    await db.insert(s.suites).values({ projectId, name: 'Exasol DB' }).returning(),
    'root suite insert',
  );
  const components = await db
    .insert(s.suites)
    .values(
      ['Query Engine', 'Storage', 'Cluster', 'Loader'].map((name, i) => ({
        projectId,
        parentId: product.id,
        name,
        position: i,
      })),
    )
    .returning();
  const modules = await db
    .insert(s.suites)
    .values(
      Array.from({ length: scale.suites }, (_, i) => ({
        projectId,
        parentId: pick(components, i).id,
        name: `Module ${i + 1}`,
        position: i,
      })),
    )
    .returning();

  const tags = await db
    .insert(s.tags)
    .values(TAG_NAMES.map((name) => ({ projectId, name })))
    .returning();

  await db.insert(s.customFieldDefinitions).values([
    { projectId, key: 'component_owner', label: 'Component Owner', type: 'text' },
    { projectId, key: 'requires_cluster', label: 'Requires Cluster', type: 'boolean' },
  ]);

  const sharedStep = expectOne(
    await db.insert(s.sharedSteps).values({ projectId, name: 'Connect as admin' }).returning(),
    'shared step insert',
  );
  await db.insert(s.sharedStepItems).values([
    { sharedStepId: sharedStep.id, position: 1, action: 'Open a session', expected: 'Connected' },
    { sharedStepId: sharedStep.id, position: 2, action: 'Authenticate', expected: 'Admin role' },
  ]);

  // Cases: roughly 45% automated, matching a realistic partial-automation estimate.
  const cases = await db
    .insert(s.testCases)
    .values(
      Array.from({ length: scale.cases }, (_, i) => ({
        projectId,
        suiteId: pick(modules, i).id,
        ref: `EXA-${1000 + i}`,
        title: `Verify behaviour ${i + 1}`,
        ownerId: pick(users, i).id,
        priority: pick(PRIORITIES, i),
        risk: pick(RISKS, i),
        preconditions: i % 3 === 0 ? 'A running cluster is available' : null,
        isAutomated: i % 100 < 45,
        customFields: { component_owner: `team-${i % 6}`, requires_cluster: i % 4 === 0 },
      })),
    )
    .returning({ id: s.testCases.id, ref: s.testCases.ref, isAutomated: s.testCases.isAutomated });

  await db
    .insert(s.caseSteps)
    .values(
      cases.flatMap((c, i) => [
        ...(i % 5 === 0
          ? [{ caseId: c.id, position: 1, sharedStepId: sharedStep.id }]
          : [{ caseId: c.id, position: 1, action: 'Run the query', expected: 'Rows returned' }]),
        { caseId: c.id, position: 2, action: 'Inspect the result', expected: 'Matches baseline' },
      ]),
    );

  // Creation history for every seeded case: AC 1's change history is only visible if the
  // seeded data actually carries it.
  await db.insert(s.caseHistory).values(
    cases.map((c, i) => ({
      caseId: c.id,
      actorId: pick(users, i).id,
      origin: 'ui' as const,
      action: 'created' as const,
      changedFields: ['title', 'suiteId', 'priority', 'risk', 'steps', 'tags'],
      after: { title: `Verify behaviour ${i + 1}` },
    })),
  );

  // A subset carries a later edit too, so the history view shows more than one entry.
  await db.insert(s.caseHistory).values(
    cases
      .filter((_, i) => i % 7 === 0)
      .map((c, i) => ({
        caseId: c.id,
        actorId: pick(users, i + 1).id,
        origin: pick(['ui', 'api', 'mcp'] as const, i),
        action: 'updated' as const,
        changedFields: i % 2 === 0 ? ['title'] : ['priority', 'tags'],
      })),
  );

  await db
    .insert(s.caseTags)
    .values(
      cases.flatMap((c, i) => [
        { caseId: c.id, tagId: pick(tags, i).id },
        { caseId: c.id, tagId: pick(tags, i + 3).id },
      ]),
    )
    .onConflictDoNothing();

  // Bindings only for automated cases; a minority stay on fragile name matching.
  const automated = cases.filter((c) => c.isAutomated);
  await db.insert(s.automationBindings).values(
    automated.map((c, i) => ({
      projectId,
      caseId: c.id,
      fqName: `tests/${i % 4}/test_module.py::test_${c.ref.toLowerCase()}`,
      method: (i % 3 === 0 ? 'name_match' : 'identifier') as 'name_match' | 'identifier',
      // Every 20th binding is deliberately stale, so the staleness report has something to find.
      lastSeenAt: i % 20 === 0 ? new Date(Date.now() - 60 * 864e5) : new Date(),
      promotedAt: i % 3 === 0 ? null : new Date(),
    })),
  );

  const environments = await db
    .insert(s.environments)
    .values(['staging', 'production', 'ci'].map((name) => ({ projectId, name })))
    .returning();
  const releases = await db
    .insert(s.releases)
    .values([
      { projectId, name: '7.1.20', status: 'released' as const },
      { projectId, name: '8.0.0', status: 'released' as const },
      { projectId, name: '8.0.1', status: 'in_progress' as const },
    ])
    .returning();

  await db.insert(s.releaseSignOffs).values(
    releases.flatMap((r) =>
      ['QA lead', 'Product', 'Support'].map((name, i) => ({
        releaseId: r.id,
        name,
        approverId: pick(users, i).id,
        ...(r.status === 'released'
          ? { completedBy: pick(users, i).id, completedAt: new Date() }
          : {}),
      })),
    ),
  );

  const plan = expectOne(
    await db
      .insert(s.testPlans)
      .values({ projectId, name: 'Full Regression', createdBy: expectOne(users, 'seed users').id })
      .returning(),
    'test plan insert',
  );
  await db
    .insert(s.testPlanCases)
    .values(cases.slice(0, 500).map((c) => ({ planId: plan.id, caseId: c.id })))
    .onConflictDoNothing();

  // Runs spread over the last 90 days so trend and flakiness views have a series.
  const runs = await db
    .insert(s.runs)
    .values(
      Array.from({ length: scale.runs }, (_, i) => {
        const startedAt = new Date(Date.now() - i * 3 * 864e5);
        return {
          projectId,
          planId: i % 3 === 0 ? plan.id : null,
          environmentId: pick(environments, i).id,
          releaseId: pick(releases, i).id,
          name: `Run ${i + 1}`,
          kind: pick(['automated', 'automated', 'manual', 'uat'] as const, i),
          status: (i === 0 ? 'open' : 'closed') as 'open' | 'closed',
          // Runs are paired onto a shared commit: flakiness is defined as differing
          // outcomes across runs of the SAME commit, so a unique SHA per run would make it
          // undetectable by construction.
          commitSha: `deadbeef${String(Math.floor(i / 2)).padStart(4, '0')}`,
          branch: i % 4 === 0 ? 'main' : `feature/branch-${i}`,
          createdBy: pick(users, i).id,
          startedAt,
          closedAt: i === 0 ? null : startedAt,
        };
      }),
    )
    .returning();

  // Ensure a partition exists for every month the seed writes into.
  for (const run of runs) {
    await db.execute(sql`select ensure_case_result_partition(${run.startedAt.toISOString()})`);
  }

  for (const run of runs) {
    const selected = cases.slice(0, scale.resultsPerRun);
    const runIndex = runs.indexOf(run);
    const runCases = await db
      .insert(s.runCases)
      .values(
        selected.map((c, i) => {
          // Cases at index % 100 === 50 are flaky: same case, same commit, alternating
          // outcome between the two runs sharing that commit. This is what makes
          // cross-run flakiness detection (AC 7) testable against the seed.
          const isFlaky = i % 100 === 50;
          const outcome = isFlaky
            ? runIndex % 2 === 0
              ? ('failed' as const)
              : ('passed' as const)
            : i % 100 < 8
              ? ('failed' as const)
              : i % 100 < 11
                ? ('blocked' as const)
                : ('passed' as const);
          return { runId: run.id, caseId: c.id, assigneeId: pick(users, i).id, outcome };
        }),
      )
      .returning({ id: s.runCases.id, caseId: s.runCases.caseId, outcome: s.runCases.outcome });

    await db.insert(s.caseResults).values(
      runCases.map((rc, i) => ({
        executedAt: run.startedAt,
        runCaseId: rc.id,
        runId: run.id,
        projectId,
        caseId: rc.caseId,
        outcome: rc.outcome,
        durationMs: 50 + ((i * 37) % 5000),
        // Recurring signatures across runs are what make carry-forward and cross-run
        // flakiness detection testable.
        ...(rc.outcome === 'failed'
          ? {
              failureMessage: pick(FAILURES, i),
              failureSignature: `sig:${rc.caseId}:${i % FAILURES.length}`,
            }
          : {}),
        origin: 'api' as const,
      })),
    );
  }

  await db.insert(s.unboundResults).values(
    Array.from({ length: 15 }, (_, i) => ({
      projectId,
      runId: expectOne(runs, 'seed runs').id,
      fqName: `tests/new/test_unmapped.py::test_case_${i}`,
      outcome: 'passed',
    })),
  );
}
