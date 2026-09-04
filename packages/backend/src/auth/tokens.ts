/**
 * Scoped API tokens for machine access (AC 2, auth-and-access spec).
 *
 * The secret is generated once, returned once, and stored only as a SHA-256 hash. A visible
 * prefix is kept so operators can identify a token in a list without it being usable.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOKEN_PREFIX_LENGTH = 8;

export type IssuedToken = {
  /** The full secret. Returned once at issuance and never recoverable afterwards. */
  secret: string;
  hash: string;
  prefix: string;
};

export function issueToken(): IssuedToken {
  const secret = `tcms_${randomBytes(32).toString('base64url')}`;
  return {
    secret,
    hash: hashToken(secret),
    prefix: secret.slice(0, TOKEN_PREFIX_LENGTH),
  };
}

export function hashToken(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Compares two token hashes without leaking their difference through timing. */
export function tokenHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/** Extracts a bearer token from an Authorization header, or null. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
