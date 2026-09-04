/**
 * Password hashing.
 *
 * Argon2id with parameters at the OWASP baseline. Only a salted one-way hash is ever
 * persisted; there is no code path that recovers a credential (auth-and-access spec).
 */
import { hash, verify } from '@node-rs/argon2';

const OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, OPTIONS);
}

export async function verifyPassword(digest: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext, OPTIONS);
  } catch {
    // A malformed or unparseable digest is a failed verification, never an error that
    // could be distinguished by a caller probing for account existence.
    return false;
  }
}

/**
 * Constant-ish work factor for accounts that do not exist, so that a caller cannot infer
 * account existence from response timing.
 */
const DUMMY_DIGEST_PROMISE = hashPassword('__nonexistent_account_timing_equaliser__');

export async function burnVerificationTime(plaintext: string): Promise<void> {
  await verifyPassword(await DUMMY_DIGEST_PROMISE, plaintext);
}
