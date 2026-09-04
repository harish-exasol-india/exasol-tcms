import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { projects } from './identity.js';
import { testCases } from './repository.js';

/** How a binding was established. `identifier` is exact; `name_match` is fragile (Decision 4). */
export const bindingMethods = ['identifier', 'name_match'] as const;

/**
 * Binds an automated test to a managed case. With no Requirement entity (design Decision 3)
 * this is the entire coverage signal, so `method` and `lastSeenAt` are first-class: they are
 * what make decay observable rather than silent.
 */
export const automationBindings = pgTable(
  'automation_binding',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    fqName: text('fq_name').notNull(),
    method: text('method', { enum: bindingMethods }).notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('automation_binding_fq_uq').on(t.projectId, t.fqName),
    index('automation_binding_case_ix').on(t.caseId),
    index('automation_binding_method_ix').on(t.projectId, t.method),
    index('automation_binding_last_seen_ix').on(t.lastSeenAt),
  ],
);

/** Results that matched no managed case. Retained and reported; never auto-creates a case. */
export const unboundResults = pgTable(
  'unbound_result',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    fqName: text('fq_name').notNull(),
    outcome: text('outcome').notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('unbound_result_project_ix').on(t.projectId, t.seenAt)],
);

export const automationBindingsRelations = relations(automationBindings, ({ one }) => ({
  testCase: one(testCases, { fields: [automationBindings.caseId], references: [testCases.id] }),
}));

export type AutomationBinding = typeof automationBindings.$inferSelect;
export type UnboundResult = typeof unboundResults.$inferSelect;
