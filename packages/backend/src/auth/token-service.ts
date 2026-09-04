/** Issuance, verification, and revocation of scoped API tokens (AC 2). */
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { expectOne } from '../db/expect.js';
import * as s from '../db/schema/index.js';
import { hashToken, issueToken } from './tokens.js';

export type TokenService = {
  issue(input: {
    projectId: string;
    name: string;
    scopes: string[];
    createdBy?: string;
    expiresAt?: Date;
  }): Promise<{ id: string; secret: string; prefix: string }>;
  verify(secret: string): Promise<{
    tokenId: string;
    projectId: string;
    scopes: string[];
  } | null>;
  revoke(tokenId: string): Promise<void>;
};

export function createTokenService(db: Database): TokenService {
  return {
    async issue({ projectId, name, scopes, createdBy, expiresAt }) {
      const token = issueToken();
      const row = expectOne(
        await db
          .insert(s.apiTokens)
          .values({
            projectId,
            name,
            scopes,
            tokenHash: token.hash,
            prefix: token.prefix,
            createdBy: createdBy ?? null,
            expiresAt: expiresAt ?? null,
          })
          .returning({ id: s.apiTokens.id }),
        'api token insert',
      );
      // The secret is returned here and nowhere else, ever.
      return { id: row.id, secret: token.secret, prefix: token.prefix };
    },

    async verify(secret) {
      const [row] = await db
        .select({
          id: s.apiTokens.id,
          projectId: s.apiTokens.projectId,
          scopes: s.apiTokens.scopes,
        })
        .from(s.apiTokens)
        .where(
          and(
            eq(s.apiTokens.tokenHash, hashToken(secret)),
            isNull(s.apiTokens.revokedAt),
            or(isNull(s.apiTokens.expiresAt), gt(s.apiTokens.expiresAt, new Date())),
          ),
        )
        .limit(1);
      if (!row) return null;

      // Fire-and-forget: last-used tracking must never fail a request.
      void db
        .update(s.apiTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(s.apiTokens.id, row.id))
        .catch(() => undefined);

      return { tokenId: row.id, projectId: row.projectId, scopes: row.scopes };
    },

    async revoke(tokenId) {
      await db
        .update(s.apiTokens)
        .set({ revokedAt: new Date() })
        .where(eq(s.apiTokens.id, tokenId));
    },
  };
}
