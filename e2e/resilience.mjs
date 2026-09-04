/**
 * Health, readiness and dependency-failure behaviour (task 14.2).
 *
 * Verifies the negative case, not just the happy path: liveness must stay up while a
 * dependency is down, readiness must report the dependency accurately, and the process must
 * survive a database restart rather than needing to be restarted itself.
 */
import { execSync } from 'node:child_process';

const BACKEND = 'http://127.0.0.1:3000';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(path, timeoutMs = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(`${BACKEND}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

const containerState = () => sh(`docker inspect --format '{{.State.Status}}' exasol-tcms-backend-1`);

// ---- baseline ----
check('liveness responds', (await probe('/healthz')).status === 200);
const ready = await probe('/readyz');
check('readiness reports the database reachable', ready.body?.checks?.database === 'ok', JSON.stringify(ready.body));

// ---- dependency removed ----
sh('docker compose stop postgres');
await sleep(5000);

const liveWithoutDb = await probe('/healthz');
check(
  'liveness still passes while the database is down',
  liveWithoutDb.status === 200,
  `HTTP ${liveWithoutDb.status}`,
);

const notReady = await probe('/readyz', 15000);
check(
  'readiness reports not-ready rather than lying',
  notReady.status === 503 && notReady.body?.checks?.database === 'unreachable',
  `HTTP ${notReady.status} ${JSON.stringify(notReady.body)}`,
);

// The process must survive: pg emits an error event on idle clients when the server goes
// away, and an unhandled one is fatal in Node.
check(
  'the process survives the database disappearing',
  containerState() === 'running',
  `container is ${containerState()}`,
);

// ---- dependency restored ----
sh('docker compose start postgres');
for (let i = 0; i < 30; i++) {
  const r = await probe('/readyz', 5000);
  if (r.status === 200) break;
  await sleep(2000);
}
const recovered = await probe('/readyz', 10000);
check(
  'readiness recovers without restarting the application',
  recovered.status === 200 && recovered.body?.checks?.database === 'ok',
  JSON.stringify(recovered.body),
);
check('the container was never restarted', containerState() === 'running');

// A real query must work again, not merely the health probe.
const restarts = sh(`docker inspect --format '{{.RestartCount}}' exasol-tcms-backend-1`);
check('docker reports zero restarts', restarts === '0', `RestartCount=${restarts}`);

// ---- compose healthchecks agree ----
await sleep(6000);
const statuses = sh(`docker compose ps --format '{{.Service}} {{.Status}}'`);
check(
  'compose reports every service healthy again',
  (statuses.match(/healthy/g) ?? []).length === 4,
  statuses.replace(/\n/g, ' | '),
);

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
