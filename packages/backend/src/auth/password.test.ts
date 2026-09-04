import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('never stores the plaintext', async () => {
    const digest = await hashPassword('correct horse battery staple');
    expect(digest).not.toContain('correct horse battery staple');
    expect(digest.startsWith('$argon2id$')).toBe(true);
  });

  it('salts: the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });

  it('verifies a correct password', async () => {
    const digest = await hashPassword('s3cret');
    expect(await verifyPassword(digest, 's3cret')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const digest = await hashPassword('s3cret');
    expect(await verifyPassword(digest, 's3cr3t')).toBe(false);
  });

  it('treats a malformed digest as a failed verification, not an error', async () => {
    expect(await verifyPassword('not-a-digest', 'anything')).toBe(false);
  });
});
