import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { projects, users } from './identity.js';
import { testCases } from './repository.js';

/**
 * A named, reusable case selection. Membership is snapshotted into a run at creation time,
 * so editing a plan afterwards leaves existing runs untouched (test-planning spec).
 */
export const testPlans = pgTable(
  'test_plan',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('test_plan_name_uq').on(t.projectId, t.name)],
);

export const testPlanCases = pgTable(
  'test_plan_case',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => testPlans.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('test_plan_case_pk').on(t.planId, t.caseId)],
);

/** Named execution targets. The ingest endpoint accepts one by name (design Decision 8). */
export const environments = pgTable(
  'environment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
  },
  (t) => [uniqueIndex('environment_name_uq').on(t.projectId, t.name)],
);

export const releases = pgTable(
  'release',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status', { enum: ['planned', 'in_progress', 'released', 'cancelled'] })
      .notNull()
      .default('planned'),
    targetDate: timestamp('target_date', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('release_name_uq').on(t.projectId, t.name),
    index('release_status_ix').on(t.status),
  ],
);

/** Named sign-off items per release; the gate reflects approvals, not evidence (Decision 16). */
export const releaseSignOffs = pgTable(
  'release_sign_off',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    approverId: uuid('approver_id').references(() => users.id, { onDelete: 'set null' }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('release_sign_off_name_uq').on(t.releaseId, t.name)],
);

export const testPlansRelations = relations(testPlans, ({ many, one }) => ({
  project: one(projects, { fields: [testPlans.projectId], references: [projects.id] }),
  planCases: many(testPlanCases),
}));

export const testPlanCasesRelations = relations(testPlanCases, ({ one }) => ({
  plan: one(testPlans, { fields: [testPlanCases.planId], references: [testPlans.id] }),
  testCase: one(testCases, { fields: [testPlanCases.caseId], references: [testCases.id] }),
}));

export const releasesRelations = relations(releases, ({ many, one }) => ({
  project: one(projects, { fields: [releases.projectId], references: [projects.id] }),
  signOffs: many(releaseSignOffs),
}));

export const releaseSignOffsRelations = relations(releaseSignOffs, ({ one }) => ({
  release: one(releases, { fields: [releaseSignOffs.releaseId], references: [releases.id] }),
  approver: one(users, { fields: [releaseSignOffs.approverId], references: [users.id] }),
}));

export type TestPlan = typeof testPlans.$inferSelect;
export type Environment = typeof environments.$inferSelect;
export type Release = typeof releases.$inferSelect;
export type ReleaseSignOff = typeof releaseSignOffs.$inferSelect;
