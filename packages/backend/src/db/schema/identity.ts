import { relations } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Projects are the unit of access control: every permission decision resolves against a
 * user's role in a specific project (design Decision 6).
 */
export const projects = pgTable(
  'project',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('project_key_uq').on(t.key)],
);

/**
 * `provider` and `externalId` exist from day one so that adding an OIDC provider later is
 * an adapter change rather than a schema migration (design Decision 7).
 */
export const users = pgTable(
  'app_user',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    provider: text('provider', { enum: ['local', 'oidc'] })
      .notNull()
      .default('local'),
    externalId: text('external_id'),
    passwordHash: text('password_hash'),
    isActive: text('is_active', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('app_user_email_uq').on(t.email),
    uniqueIndex('app_user_external_uq').on(t.provider, t.externalId),
  ],
);

/** The per-project role assignment. Composite primary key: one role per user per project. */
export const memberships = pgTable(
  'membership',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'lead', 'tester', 'viewer'] }).notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    grantedBy: uuid('granted_by').references(() => users.id),
  },
  (t) => [
    uniqueIndex('membership_pk').on(t.userId, t.projectId),
    index('membership_project_ix').on(t.projectId),
  ],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  memberships: many(memberships),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  project: one(projects, { fields: [memberships.projectId], references: [projects.id] }),
}));

export type Project = typeof projects.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
