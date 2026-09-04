import { relations } from 'drizzle-orm';
import { bigint, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { runCases, runs, triageStates } from './execution.js';
import { users } from './identity.js';
import { testCases } from './repository.js';

/**
 * Attachment metadata only; the bytes live in MinIO (design Decision 14). `objectKey` is
 * the storage path, and deletion of a run must delete the object so files do not outlive
 * the rows referencing them (data-lifecycle spec).
 */
export const attachments = pgTable(
  'attachment',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    runCaseId: uuid('run_case_id').references(() => runCases.id, { onDelete: 'cascade' }),
    stepPosition: bigint('step_position', { mode: 'number' }),
    objectKey: text('object_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('attachment_object_key_uq').on(t.objectKey),
    index('attachment_run_ix').on(t.runId),
    index('attachment_run_case_ix').on(t.runCaseId),
  ],
);

/**
 * A defect is a reference to a Jira issue, nothing more: no Jira API call is made in either
 * direction (design Decision 5). `linkedAt` is the only age fact the system owns, which is
 * why AC 4's age banding is computed from it rather than from Jira's created date.
 */
export const defectLinks = pgTable(
  'defect_link',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runCaseId: uuid('run_case_id')
      .notNull()
      .references(() => runCases.id, { onDelete: 'cascade' }),
    stepPosition: bigint('step_position', { mode: 'number' }),
    issueKey: text('issue_key').notNull(),
    linkedBy: uuid('linked_by').references(() => users.id, { onDelete: 'set null' }),
    linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('defect_link_uq').on(t.runCaseId, t.issueKey),
    index('defect_link_issue_ix').on(t.issueKey),
    index('defect_link_linked_at_ix').on(t.linkedAt),
  ],
);

/**
 * Triage keyed by failure signature rather than by individual result, which is what allows a
 * human decision to carry forward automatically to later matching failures (Decision 15).
 */
export const failureTriage = pgTable(
  'failure_triage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').notNull(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    signature: text('signature').notNull(),
    state: text('state', { enum: triageStates }).notNull().default('new'),
    note: text('note'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('failure_triage_signature_uq').on(t.projectId, t.signature),
    index('failure_triage_state_ix').on(t.projectId, t.state),
  ],
);

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  run: one(runs, { fields: [attachments.runId], references: [runs.id] }),
  runCase: one(runCases, { fields: [attachments.runCaseId], references: [runCases.id] }),
}));

export const defectLinksRelations = relations(defectLinks, ({ one }) => ({
  runCase: one(runCases, { fields: [defectLinks.runCaseId], references: [runCases.id] }),
}));

export const failureTriageRelations = relations(failureTriage, ({ one }) => ({
  testCase: one(testCases, { fields: [failureTriage.caseId], references: [testCases.id] }),
}));

export type Attachment = typeof attachments.$inferSelect;
export type DefectLink = typeof defectLinks.$inferSelect;
export type FailureTriage = typeof failureTriage.$inferSelect;
