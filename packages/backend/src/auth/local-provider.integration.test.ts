import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { LocalAuthProvider } from './local-provider.js';
import { hashPassword } from './password.js';

const url = process.env['TEST_DATABASE_URL'];
const suite = url ? describe : describe.skip;

suite('local auth provider (integration)', () => {
  let pool: Pool;
  let db: ReturnType<typeof createDatabase>;
  let provider: LocalAuthProvider;
  const email = `auth-${Date.now()}@exasol.com`;
  const disabledEmail = `disabled-${Date.now()}@exasol.com`;

  beforeAll(async () => {
    pool = createPool(url as string);
    db = createDatabase(pool);
    provider = new LocalAuthProvider(db);
    await db.insert(s.users).values([
      { email, displayName: 'Auth User', passwordHash: await hashPassword('correct-password') },
      {
        email: disabledEmail,
        displayName: 'Disabled User',
        passwordHash: await hashPassword('correct-password'),
        isActive: 'disabled',
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(s.users).where(eq(s.users.email, email));
    await db.delete(s.users).where(eq(s.users.email, disabledEmail));
    await pool.end();
  });

  it('authenticates valid credentials', async () => {
    const identity = await provider.authenticate({ email, password: 'correct-password' });
    expect(identity).not.toBeNull();
    expect(identity?.email).toBe(email);
    expect(identity?.displayName).toBe('Auth User');
  });

  it('rejects a wrong password', async () => {
    expect(await provider.authenticate({ email, password: 'wrong' })).toBeNull();
  });

  it('rejects an unknown account identically to a wrong password', async () => {
    const unknown = await provider.authenticate({
      email: 'nobody@exasol.com',
      password: 'whatever',
    });
    const wrong = await provider.authenticate({ email, password: 'wrong' });
    // Both are null with no distinguishing information: the caller cannot tell whether
    // the account exists (auth-and-access spec).
    expect(unknown).toBeNull();
    expect(wrong).toBeNull();
    expect(unknown).toEqual(wrong);
  });

  it('does not disclose account existence through response timing', async () => {
    const time = async (input: { email: string; password: string }) => {
      const started = process.hrtime.bigint();
      await provider.authenticate(input);
      return Number(process.hrtime.bigint() - started) / 1e6;
    };
    const existing = await time({ email, password: 'wrong' });
    const missing = await time({ email: 'nobody@exasol.com', password: 'wrong' });
    // Both paths perform a real Argon2 verification, so neither returns fast enough to
    // reveal which case it was. A missing account must not be an order of magnitude faster.
    expect(missing).toBeGreaterThan(existing / 5);
  });

  it('refuses a disabled account', async () => {
    expect(
      await provider.authenticate({ email: disabledEmail, password: 'correct-password' }),
    ).toBeNull();
  });

  it('rejects malformed input without throwing', async () => {
    expect(await provider.authenticate({})).toBeNull();
    expect(await provider.authenticate({ email: 'not-an-email', password: 'x' })).toBeNull();
  });
});
