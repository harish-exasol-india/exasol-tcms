import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects, users } from './identity.js';

/** Priority and risk are fixed vocabularies; AC 1 names both as required case metadata. */
export const casePriorities = ['low', 'medium', 'high', 'critical'] as const;
export const caseRisks = ['low', 'medium', 'high'] as const;

/**
 * The suite tree carries product / component / module (design Decision 2). Nesting is by
 * self-referencing parent; a case belongs to exactly one suite.
 */
export const suites = pgTable(
  'suite',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('suite_project_parent_ix').on(t.projectId, t.parentId),
    index('suite_parent_ix').on(t.parentId),
  ],
);

/**
 * Manual and automated cases live in one table, distinguished by `isAutomated` rather than
 * by separate stores, so automation status can change without the case moving or its
 * reference changing (test-repository spec).
 */
export const testCases = pgTable(
  'test_case',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    suiteId: uuid('suite_id')
      .notNull()
      .references(() => suites.id, { onDelete: 'restrict' }),
    ref: text('ref').notNull(),
    title: text('title').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    priority: text('priority', { enum: casePriorities }).notNull().default('medium'),
    risk: text('risk', { enum: caseRisks }).notNull().default('medium'),
    preconditions: text('preconditions'),
    isAutomated: boolean('is_automated').notNull().default(false),
    customFields: jsonb('custom_fields').$type<Record<string, string | number | boolean>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('test_case_ref_uq').on(t.projectId, t.ref),
    index('test_case_suite_ix').on(t.suiteId),
    index('test_case_project_automated_ix').on(t.projectId, t.isAutomated),
  ],
);

/**
 * A step is either literal content or a reference to a shared step. When `sharedStepId` is
 * set the referenced block's current content is rendered in position (design Decision 12).
 */
export const caseSteps = pgTable(
  'case_step',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    action: text('action'),
    expected: text('expected'),
    sharedStepId: uuid('shared_step_id'),
  },
  (t) => [uniqueIndex('case_step_position_uq').on(t.caseId, t.position)],
);

/** Tag names are stored already normalised; the unique index makes convergence enforceable. */
export const tags = pgTable(
  'tag',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('tag_project_name_uq').on(t.projectId, t.name)],
);

export const caseTags = pgTable(
  'case_tag',
  {
    caseId: uuid('case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('case_tag_pk').on(t.caseId, t.tagId), index('case_tag_tag_ix').on(t.tagId)],
);

export const suitesRelations = relations(suites, ({ one, many }) => ({
  project: one(projects, { fields: [suites.projectId], references: [projects.id] }),
  parent: one(suites, {
    fields: [suites.parentId],
    references: [suites.id],
    relationName: 'suiteTree',
  }),
  children: many(suites, { relationName: 'suiteTree' }),
  testCases: many(testCases),
}));

export const testCasesRelations = relations(testCases, ({ one, many }) => ({
  project: one(projects, { fields: [testCases.projectId], references: [projects.id] }),
  suite: one(suites, { fields: [testCases.suiteId], references: [suites.id] }),
  owner: one(users, { fields: [testCases.ownerId], references: [users.id] }),
  steps: many(caseSteps),
  caseTags: many(caseTags),
}));

export const caseStepsRelations = relations(caseSteps, ({ one }) => ({
  testCase: one(testCases, { fields: [caseSteps.caseId], references: [testCases.id] }),
}));

export const caseTagsRelations = relations(caseTags, ({ one }) => ({
  testCase: one(testCases, { fields: [caseTags.caseId], references: [testCases.id] }),
  tag: one(tags, { fields: [caseTags.tagId], references: [tags.id] }),
}));

export type Suite = typeof suites.$inferSelect;
export type TestCase = typeof testCases.$inferSelect;
export type NewTestCase = typeof testCases.$inferInsert;
export type CaseStep = typeof caseSteps.$inferSelect;
export type Tag = typeof tags.$inferSelect;
