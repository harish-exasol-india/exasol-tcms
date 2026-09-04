/**
 * Fails if docs/api.md has drifted from the live route table.
 *
 * Documentation that is generated but never re-checked rots exactly as fast as
 * documentation written by hand. This runs in CI so a new endpoint cannot ship undocumented
 * and a removed one cannot linger in the reference.
 */
import { readFileSync } from 'node:fs';
import { buildApp } from '../packages/backend/dist/app.js';
import { loadConfig } from '../packages/backend/dist/config.js';

const doc = readFileSync('docs/api.md', 'utf8');
const documented = new Set(
  [...doc.matchAll(/^\| `(GET|POST|PATCH|PUT|DELETE)` \| `([^`]+)` \|/gm)].map(
    (m) => `${m[1]} ${m[2]}`,
  ),
);

const app = await buildApp(loadConfig({ DATABASE_URL: 'postgres://check/check', LOG_LEVEL: 'fatal' }));
await app.ready();

const live = new Set();
const prefix = [];
for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
  const m = /^([\s│]*)[├└]──\s+(\S+)\s*(?:\(([^)]+)\))?/.exec(line);
  if (!m) continue;
  const depth = Math.floor((m[1] ?? '').length / 4);
  const url = `${depth === 0 ? '' : (prefix[depth - 1] ?? '')}${m[2]}`;
  prefix[depth] = url;
  prefix.length = depth + 1;
  for (const method of (m[3] ?? '').split(', ')) {
    if (method && method !== 'HEAD' && method !== 'OPTIONS') live.add(`${method} ${url}`);
  }
}
await app.close();

const missing = [...documented].filter((d) => !live.has(d));
const undocumented = [...live].filter((r) => !documented.has(r));

if (missing.length === 0 && undocumented.length === 0) {
  console.log(`docs/api.md is current: ${live.size} routes documented.`);
  process.exit(0);
}
if (undocumented.length) console.error(`Undocumented routes:\n  ${undocumented.join('\n  ')}`);
if (missing.length) console.error(`Documented but missing:\n  ${missing.join('\n  ')}`);
console.error('\nRun `npm run docs:api` to regenerate.');
process.exit(1);
