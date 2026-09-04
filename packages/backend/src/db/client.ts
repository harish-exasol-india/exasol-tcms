import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof createDatabase>;

/**
 * Creates the connection pool.
 *
 * An `error` listener is not optional. `pg` emits `error` on *idle* clients when the server
 * closes their connection — a Postgres restart, a failover, an administrator terminating
 * backends. Node treats an unhandled `error` event as fatal, so without this listener a
 * routine database restart kills the API process instead of it reconnecting. The pool
 * discards the broken client and opens a new one on the next query, so logging and
 * continuing is the correct response.
 */
export function createPool(databaseUrl: string): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    // Bounded so a wedged connection surfaces as a failed request rather than a hang.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  pool.on('error', (error) => {
    // eslint-disable-next-line no-console -- the pool has no logger; startup may precede one
    console.error(
      JSON.stringify({
        level: 50,
        msg: 'idle postgres client errored; the pool will reconnect on the next query',
        err: { message: error.message },
      }),
    );
  });

  return pool;
}

export function createDatabase(pool: Pool) {
  return drizzle(pool, { schema });
}
