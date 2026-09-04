import { describe, expect, it } from 'vitest';
import { hashToken, issueToken, parseBearer, tokenHashesMatch } from './tokens.js';

describe('api tokens', () => {
  it('issues a secret that is not recoverable from what is stored', () => {
    const token = issueToken();
    expect(token.hash).not.toContain(token.secret);
    expect(token.secret).not.toBe(token.hash);
    expect(token.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps an identifying prefix that is not usable as a credential', () => {
    const token = issueToken();
    expect(token.prefix).toHaveLength(8);
    expect(token.secret.startsWith(token.prefix)).toBe(true);
    expect(hashToken(token.prefix)).not.toBe(token.hash);
  });

  it('issues a distinct secret every time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => issueToken().secret));
    expect(secrets.size).toBe(50);
  });

  it('recomputes the same hash for the same secret', () => {
    const token = issueToken();
    expect(hashToken(token.secret)).toBe(token.hash);
    expect(tokenHashesMatch(hashToken(token.secret), token.hash)).toBe(true);
  });

  it('does not match a different token', () => {
    expect(tokenHashesMatch(issueToken().hash, issueToken().hash)).toBe(false);
  });

  it('rejects malformed hash comparisons rather than throwing', () => {
    expect(tokenHashesMatch('', '')).toBe(false);
    expect(tokenHashesMatch('abc', 'abcdef')).toBe(false);
  });

  it('parses a bearer header and ignores anything else', () => {
    expect(parseBearer('Bearer abc123')).toBe('abc123');
    expect(parseBearer('bearer abc123')).toBe('abc123');
    expect(parseBearer('Basic abc123')).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer('Bearer')).toBeNull();
  });
});
