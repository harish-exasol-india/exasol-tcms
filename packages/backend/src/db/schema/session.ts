import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects, users } from './identity.js';

/**
 * Sessions live in Postgres rather than in process memory so the backend stays stateless
 * and horizontally replaceable (design Decision 22). The JWT carries the session id; the
 * row is what makes revocation immediate.
 */
export const sessions = pgTable(
  'session',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
  },
  (t) => [index('session_user_ix').on(t.userId), index('session_expires_ix').on(t.expiresAt)],
);

/** The operations a token may perform. Deliberately coarse: tokens are for machines. */
export const tokenScopes = ['results:write', 'results:read', 'cases:read', 'cases:write'] as const;

/**
 * Scoped API tokens for CI (AC 2). The secret is shown once at issuance and stored only as
 * a hash; `lastUsedAt` supports the operator's view of which tokens are still live.
 */
export const apiTokens = pgTable(
  'api_token',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    prefix: text('prefix').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('api_token_hash_ix').on(t.tokenHash),
    index('api_token_project_ix').on(t.projectId),
  ],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  project: one(projects, { fields: [apiTokens.projectId], references: [projects.id] }),
}));

export type Session = typeof sessions.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
