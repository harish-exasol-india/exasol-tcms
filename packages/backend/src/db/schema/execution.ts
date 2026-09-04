import { relations } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects, users } from './identity.js';
import { environments, releases, testPlans } from './planning.js';
import { testCases } from './repository.js';

export const resultOutcomes = ['passed', 'failed', 'blocked', 'skipped', 'untested'] as const;
export const runKinds = ['manual', 'automated', 'uat'] as const;
export const triageStates = [
  'new',
  'investigating',
  'known_issue',
  'flaky',
  'resolved',
  'regression',
] as const;

/**
 * A run is an execution of a plan or an ad-hoc selection, in one environment, optionally
 * attributed to a release. Automated runs are created by ingestion with no approval step
 * (design Decision 8); `kind` distinguishes UAT runs for release reporting.
 */
export const runs = pgTable(
  'run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => testPlans.id, { onDelete: 'set null' }),
    environmentId: uuid('environment_id').references(() => environments.id, {
      onDelete: 'set null',
    }),
    releaseId: uuid('release_id').references(() => releases.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: runKinds }).notNull().default('manual'),
    status: text('status', { enum: ['open', 'closed', 'aborted'] })
      .notNull()
      .default('open'),
    commitSha: text('commit_sha'),
    branch: text('branch'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    index('run_project_started_ix').on(t.projectId, t.startedAt),
    index('run_release_ix').on(t.releaseId),
    index('run_kind_ix').on(t.projectId, t.kind),
  ],
);

/**
 * The case's membership in a run. `version` backs optimistic concurrency: a result write
 * carries the version it was based on, and a stale write is rejected (design Decision 13).
 */
export const runCases = pgTable(
  'run_case',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    outcome: text('outcome', { enum: resultOutcomes }).notNull().default('untested'),
    version: integer('version').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('run_case_uq').on(t.runId, t.caseId),
    index('run_case_outcome_ix').on(t.runId, t.outcome),
    // Coverage asks "has this case ever been executed?", which leads with case_id. The
    // composite (run_id, case_id) index cannot serve that, so without this index the
    // lookup degrades to a sequential scan per case: measured at 217s over 25k cases.
    index('run_case_case_ix').on(t.caseId),
  ],
);

/**
 * One recorded execution outcome. This is the high-volume table; its primary key includes
 * `executedAt` because Postgres requires the partition key in the primary key, and it is
 * partitioned by month (design Decision 20).
 */
export const caseResults = pgTable(
  'case_result',
  {
    id: uuid('id').defaultRandom().notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }).defaultNow().notNull(),
    runCaseId: uuid('run_case_id').notNull(),
    runId: uuid('run_id').notNull(),
    projectId: uuid('project_id').notNull(),
    caseId: uuid('case_id').notNull(),
    outcome: text('outcome', { enum: resultOutcomes }).notNull(),
    durationMs: bigint('duration_ms', { mode: 'number' }),
    failureMessage: text('failure_message'),
    failureSignature: text('failure_signature'),
    triageState: text('triage_state', { enum: triageStates }),
    recordedBy: uuid('recorded_by'),
    origin: text('origin', { enum: ['ui', 'api', 'mcp'] }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.executedAt] }),
    index('case_result_run_ix').on(t.runId),
    index('case_result_case_ix').on(t.caseId, t.executedAt),
    index('case_result_project_executed_ix').on(t.projectId, t.executedAt),
    index('case_result_signature_ix').on(t.failureSignature),
  ],
);

export const stepResults = pgTable(
  'step_result',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runCaseId: uuid('run_case_id')
      .notNull()
      .references(() => runCases.id, { onDelete: 'cascade' }),
    stepPosition: integer('step_position').notNull(),
    outcome: text('outcome', { enum: resultOutcomes }).notNull(),
    comment: text('comment'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('step_result_uq').on(t.runCaseId, t.stepPosition)],
);

export const runsRelations = relations(runs, ({ one, many }) => ({
  project: one(projects, { fields: [runs.projectId], references: [projects.id] }),
  plan: one(testPlans, { fields: [runs.planId], references: [testPlans.id] }),
  environment: one(environments, { fields: [runs.environmentId], references: [environments.id] }),
  release: one(releases, { fields: [runs.releaseId], references: [releases.id] }),
  runCases: many(runCases),
}));

export const runCasesRelations = relations(runCases, ({ one, many }) => ({
  run: one(runs, { fields: [runCases.runId], references: [runs.id] }),
  testCase: one(testCases, { fields: [runCases.caseId], references: [testCases.id] }),
  assignee: one(users, { fields: [runCases.assigneeId], references: [users.id] }),
  stepResults: many(stepResults),
}));

export const stepResultsRelations = relations(stepResults, ({ one }) => ({
  runCase: one(runCases, { fields: [stepResults.runCaseId], references: [runCases.id] }),
}));

export type Run = typeof runs.$inferSelect;
export type RunCase = typeof runCases.$inferSelect;
export type CaseResult = typeof caseResults.$inferSelect;
export type StepResult = typeof stepResults.$inferSelect;
