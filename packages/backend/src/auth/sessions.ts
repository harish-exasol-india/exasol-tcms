/**
 * Session lifecycle. The JWT carries only the session id; the row in Postgres is what makes
 * revocation immediate and keeps the backend stateless (design Decision 22).
 */
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type SessionService = {
  create(userId: string, userAgent?: string): Promise<{ sessionId: string; expiresAt: Date }>;
  resolve(sessionId: string): Promise<{ userId: string } | null>;
  revoke(sessionId: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
  purgeExpired(): Promise<number>;
};

export function createSessionService(db: Database): SessionService {
  return {
    async create(userId, userAgent) {
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      const row = expectOne(
        await db
          .insert(s.sessions)
          .values({ userId, expiresAt, userAgent: userAgent ?? null })
          .returning({ id: s.sessions.id }),
        'session insert',
      );
      return { sessionId: row.id, expiresAt };
    },

    async resolve(sessionId) {
      const [row] = await db
        .select({ userId: s.sessions.userId })
        .from(s.sessions)
        .where(
          and(
            eq(s.sessions.id, sessionId),
            isNull(s.sessions.revokedAt),
            gt(s.sessions.expiresAt, new Date()),
          ),
        )
        .limit(1);
      return row ? { userId: row.userId } : null;
    },

    async revoke(sessionId) {
      await db
        .update(s.sessions)
        .set({ revokedAt: new Date() })
        .where(eq(s.sessions.id, sessionId));
    },

    async revokeAllForUser(userId) {
      await db
        .update(s.sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(s.sessions.userId, userId), isNull(s.sessions.revokedAt)));
    },

    async purgeExpired() {
      const removed = await db
        .delete(s.sessions)
        .where(or(lt(s.sessions.expiresAt, new Date()), lt(s.sessions.revokedAt, new Date())))
        .returning({ id: s.sessions.id });
      return removed.length;
    },
  };
}
