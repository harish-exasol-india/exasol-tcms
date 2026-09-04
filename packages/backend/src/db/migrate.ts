/**
 * Migration runner.
 *
 * Forward migrations are applied by Drizzle's own migrator, which records each applied
 * migration in `drizzle.__drizzle_migrations`. drizzle-kit generates forward SQL only, so
 * each migration is paired by hand with a `drizzle/down/<name>.down.sql` script; rolling
 * back executes that script and deletes the ledger row, which is what makes the migration
 * eligible to run again (design — Migration Plan).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../../drizzle');

export async function migrateUp(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

/** Rolls back the most recently applied migration. */
export async function migrateDown(databaseUrl: string): Promise<string | null> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const applied = await pool.query<{ id: number; hash: string }>(
      'select id, hash from drizzle.__drizzle_migrations order by created_at desc, id desc limit 1',
    );
    const latest = applied.rows[0];
    if (!latest) return null;

    // Drizzle stores the migration's hash, not its filename; resolve the name via the
    // journal so the paired down script can be located.
    const journalRaw = await readFile(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8');
    const journal = JSON.parse(journalRaw) as { entries: { idx: number; tag: string }[] };
    const entry = journal.entries.at(-1);
    if (!entry) throw new Error('migration journal is empty but a migration is recorded');

    const downFiles = await readdir(path.join(migrationsFolder, 'down'));
    const downFile = downFiles.find((f) => f === `${entry.tag}.down.sql`);
    if (!downFile) {
      throw new Error(
        `no down migration for '${entry.tag}'. Every migration must ship a paired ` +
          `drizzle/down/${entry.tag}.down.sql script.`,
      );
    }

    const sql = await readFile(path.join(migrationsFolder, 'down', downFile), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('delete from drizzle.__drizzle_migrations where id = $1', [latest.id]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return entry.tag;
  } finally {
    await pool.end();
  }
}
