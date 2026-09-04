import { createDatabase, createPool } from './client.js';
import { defaultScale, seed } from './seed.js';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const factor = Number(process.env['SEED_SCALE'] ?? '1');
const scale = {
  suites: Math.round(defaultScale.suites * factor),
  cases: Math.round(defaultScale.cases * factor),
  runs: Math.round(defaultScale.runs * factor),
  resultsPerRun: Math.round(defaultScale.resultsPerRun * factor),
};

const pool = createPool(databaseUrl);
const started = Date.now();
try {
  await seed(createDatabase(pool), scale);
  console.log(`seeded in ${((Date.now() - started) / 1000).toFixed(1)}s`, scale);
} finally {
  await pool.end();
}
