import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import * as s from '../db/schema/index.js';
import { burnVerificationTime, verifyPassword } from './password.js';
import type { AuthenticatedIdentity, AuthProvider } from './provider.js';

export const localCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;

  constructor(private readonly db: Database) {}

  async authenticate(input: Record<string, unknown>): Promise<AuthenticatedIdentity | null> {
    const parsed = localCredentialsSchema.safeParse(input);
    if (!parsed.success) return null;

    const [user] = await this.db
      .select()
      .from(s.users)
      .where(and(eq(s.users.email, parsed.data.email.toLowerCase()), eq(s.users.provider, 'local')))
      .limit(1);

    // Spend comparable time whether or not the account exists, so the response does not
    // disclose account existence through timing.
    if (!user?.passwordHash) {
      await burnVerificationTime(parsed.data.password);
      return null;
    }
    if (user.isActive !== 'active') {
      await burnVerificationTime(parsed.data.password);
      return null;
    }
    if (!(await verifyPassword(user.passwordHash, parsed.data.password))) return null;

    return { externalId: user.id, email: user.email, displayName: user.displayName };
  }
}
