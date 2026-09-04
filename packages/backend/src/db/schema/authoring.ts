import { relations } from 'drizzle-orm';
import {
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
import { testCases } from './repository.js';

/**
 * A named step block referenced by many cases. Editing it propagates to every referencing
 * case, and — because runs render the latest content (design Decision 9) — to every
 * in-flight run as well. The editor surfaces that blast radius before an edit proceeds.
 */
export const sharedSteps = pgTable(
  'shared_step',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('shared_step_name_uq').on(t.projectId, t.name)],
);

export const sharedStepItems = pgTable(
  'shared_step_item',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sharedStepId: uuid('shared_step_id')
      .notNull()
      .references(() => sharedSteps.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    action: text('action').notNull(),
    expected: text('expected'),
  },
  (t) => [uniqueIndex('shared_step_item_position_uq').on(t.sharedStepId, t.position)],
);

/** Admin-defined typed fields beyond the built-in AC 1 metadata (design Decision 12). */
export const customFieldTypes = ['text', 'number', 'boolean', 'select'] as const;

export const customFieldDefinitions = pgTable(
  'custom_field_definition',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type', { enum: customFieldTypes }).notNull(),
    options: jsonb('options').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('custom_field_key_uq').on(t.projectId, t.key)],
);

/** The interfaces a write can originate from, recorded on every mutation (Decision 10). */
export const originValues = ['ui', 'api', 'mcp'] as const;

/**
 * Append-only record of every case change: what changed, who changed it, when, and through
 * which interface. Satisfies AC 1 independently of run version pinning (Decision 9).
 */
export const caseHistory = pgTable(
  'case_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    origin: text('origin', { enum: originValues }).notNull(),
    action: text('action', { enum: ['created', 'updated', 'deleted', 'restored'] }).notNull(),
    changedFields: jsonb('changed_fields').$type<string[]>().notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('case_history_case_ix').on(t.caseId, t.occurredAt)],
);

export const sharedStepsRelations = relations(sharedSteps, ({ many }) => ({
  items: many(sharedStepItems),
}));

export const sharedStepItemsRelations = relations(sharedStepItems, ({ one }) => ({
  sharedStep: one(sharedSteps, {
    fields: [sharedStepItems.sharedStepId],
    references: [sharedSteps.id],
  }),
}));

export const caseHistoryRelations = relations(caseHistory, ({ one }) => ({
  testCase: one(testCases, { fields: [caseHistory.caseId], references: [testCases.id] }),
  actor: one(users, { fields: [caseHistory.actorId], references: [users.id] }),
}));

export type SharedStep = typeof sharedSteps.$inferSelect;
export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type CaseHistoryEntry = typeof caseHistory.$inferSelect;
