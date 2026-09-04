import { migrateDown, migrateUp } from './migrate.js';

const direction = process.argv[2] ?? 'up';
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');

if (direction === 'up') {
  await migrateUp(databaseUrl);
  console.log('migrations applied');
} else if (direction === 'down') {
  const rolled = await migrateDown(databaseUrl);
  console.log(rolled ? `rolled back: ${rolled}` : 'nothing to roll back');
} else {
  throw new Error(`unknown direction '${direction}' (expected 'up' or 'down')`);
}
