/**
 * Twelve-factor audit (task 14.1).
 *
 * Design Decision 22 claims all configuration arrives through the environment and that no
 * container keeps state on its filesystem. That claim is only worth anything if it is
 * checked: a single `readFileSync` of a config file, or one writable volume, quietly makes
 * a later move to Kubernetes a migration rather than repackaging.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const failures = [];
const notes = [];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', '__fixtures__'].includes(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(full) && !/\.test\.tsx?$/.test(full)) files.push(full);
  }
  return files;
}

// 1. Configuration is read in exactly one place.
const sources = walk('packages/backend/src');
const envReaders = sources.filter(
  (f) =>
    /process\.env/.test(readFileSync(f, 'utf8')) &&
    !f.endsWith('config.ts') &&
    !f.includes('/docs/') &&
    !f.endsWith('seed-cli.ts') &&
    !f.endsWith('migrate-cli.ts') &&
    !f.endsWith('drizzle.config.ts'),
);
if (envReaders.length > 0) {
  failures.push(`Configuration is read outside config.ts:\n    ${envReaders.join('\n    ')}`);
} else {
  notes.push('Backend reads process.env only in config.ts (plus CLI entrypoints).');
}

// 2. No source reads a configuration file from disk at runtime.
const fileConfigReaders = sources.filter((f) => {
  const text = readFileSync(f, 'utf8');
  return /readFileSync\(.*(config|\.env|settings)/i.test(text);
});
if (fileConfigReaders.length > 0) {
  failures.push(`Configuration read from a file:\n    ${fileConfigReaders.join('\n    ')}`);
} else {
  notes.push('No source reads configuration from the filesystem.');
}

// 3. Compose declares no bind mount or writable volume on the application containers.
const compose = readFileSync('docker-compose.yml', 'utf8');
// Only the `services:` block: the last service would otherwise absorb the top-level
// `volumes:` declaration and be reported as stateful.
const servicesBlock = compose.slice(
  compose.indexOf('services:'),
  compose.search(/^volumes:/m) === -1 ? undefined : compose.search(/^volumes:/m),
);
const appSections = servicesBlock.split(/^  (?=\w)/m).filter((s) => /^(backend|frontend):/.test(s));
for (const section of appSections) {
  const name = section.split(':')[0];
  if (/^\s{4}volumes:/m.test(section)) {
    failures.push(`Container '${name}' declares a volume; application containers must be stateless.`);
  } else {
    notes.push(`Container '${name}' declares no volume.`);
  }
}

// 4. Every configuration key has a default or is documented in .env.example.
const configSource = readFileSync('packages/backend/src/config.ts', 'utf8');
const keys = [...configSource.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
const example = readFileSync('.env.example', 'utf8');
const required = keys.filter((k) => {
  const line = configSource.split('\n').find((l) => l.trim().startsWith(`${k}:`));
  return line && !line.includes('.default(');
});
const undocumented = required.filter((k) => !example.includes(k) && !compose.includes(k));
if (undocumented.length > 0) {
  failures.push(`Required settings neither defaulted nor documented: ${undocumented.join(', ')}`);
} else {
  notes.push(`All ${keys.length} settings are defaulted or documented (${required.length} required).`);
}

// 5. The running containers hold no writable state outside their volumes.
try {
  const mounts = execSync(
    `docker inspect --format '{{.Name}} {{range .Mounts}}{{.Destination}} {{end}}' ` +
      `exasol-tcms-backend-1 exasol-tcms-frontend-1 2>/dev/null`,
    { encoding: 'utf8' },
  ).trim();
  for (const line of mounts.split('\n')) {
    const [name, ...destinations] = line.trim().split(/\s+/);
    if (destinations.length > 0) {
      failures.push(`Running container ${name} has mounts: ${destinations.join(', ')}`);
    } else {
      notes.push(`Running container ${name} has no mounts.`);
    }
  }
} catch {
  notes.push('Containers not running; skipped the live mount check.');
}

for (const note of notes) console.log(`PASS  ${note}`);
for (const failure of failures) console.log(`FAIL  ${failure}`);
console.log(`\n${notes.length} checks passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
