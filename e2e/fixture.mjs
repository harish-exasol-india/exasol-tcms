/** Creates a deterministic non-member user for the membership admin test. */
import { eq } from 'drizzle-orm';
import { hashPassword } from '../packages/backend/dist/auth/password.js';
import { createDatabase, createPool } from '../packages/backend/dist/db/client.js';
import * as s from '../packages/backend/dist/db/schema/index.js';

const email = 'e2e.candidate@exasol.com';
const pool = createPool(process.env.DATABASE_URL);
const db = createDatabase(pool);
try {
  await db.delete(s.users).where(eq(s.users.email, email));
  const [user] = await db
    .insert(s.users)
    .values({ email, displayName: 'E2E Candidate', passwordHash: await hashPassword('x') })
    .returning();
  // Deliberately NOT a member of any project.
  console.log(`fixture user ${email} (${user.id}) created with no membership`);
} finally {
  await pool.end();
}
