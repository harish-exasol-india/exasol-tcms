/**
 * Every forward migration must ship a paired down script.
 *
 * drizzle-kit generates forward SQL only. The design's rollback plan depends on the pair
 * existing, and the moment one is missing the plan is fiction — so this is checked in CI
 * rather than discovered during an incident.
 */
import { readdirSync } from 'node:fs';

const dir = 'packages/backend/drizzle';
const forward = readdirSync(dir).filter((f) => f.endsWith('.sql'));
const down = new Set(readdirSync(`${dir}/down`).filter((f) => f.endsWith('.down.sql')));

const missing = forward.filter((f) => !down.has(`${f.replace(/\.sql$/, '')}.down.sql`));
const orphaned = [...down].filter(
  (d) => !forward.includes(`${d.replace(/\.down\.sql$/, '')}.sql`),
);

if (missing.length === 0 && orphaned.length === 0) {
  console.log(`All ${forward.length} migrations have a paired down script.`);
  process.exit(0);
}
if (missing.length) {
  console.error(
    `Migrations without a down script:\n  ${missing.join('\n  ')}\n` +
      `Create drizzle/down/<name>.down.sql for each; the rollback plan depends on it.`,
  );
}
if (orphaned.length) console.error(`Down scripts with no migration:\n  ${orphaned.join('\n  ')}`);
process.exit(1);
