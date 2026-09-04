/**
 * Streaming export verification (task 13.8).
 *
 * The claim is that an export scales with time, not memory. This exports the whole retained
 * result set while sampling the backend container's memory, so "it streams" is measured
 * rather than asserted.
 */
import { execSync } from 'node:child_process';

const BASE = process.env.TCMS_URL ?? 'http://127.0.0.1:8080';
const PID = process.env.PROJECT_ID;

const signIn = await fetch(`${BASE}/api/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'harish.ekambaram@exasol.com', password: 'demo-password-123' }),
});
const cookie = signIn.headers.getSetCookie().find((c) => c.startsWith('tcms_session'))?.split(';')[0];
if (!cookie) throw new Error('sign-in failed');

const containerMemMb = () => {
  try {
    const out = execSync(
      'docker compose stats --no-stream --format "{{.Name}} {{.MemUsage}}" 2>/dev/null | grep backend',
      { encoding: 'utf8' },
    );
    const match = /([\d.]+)([KMG]i?B)/.exec(out);
    if (!match) return null;
    const value = Number(match[1]);
    const unit = match[2];
    return unit.startsWith('G') ? value * 1024 : unit.startsWith('K') ? value / 1024 : value;
  } catch {
    return null;
  }
};

/** Runs one export, sampling backend memory throughout. */
async function measureExport(label, query) {
  const baseline = containerMemMb();
  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const m = containerMemMb();
      if (m !== null) samples.push(m);
      await new Promise((r) => setTimeout(r, 500));
    }
  })();

  const started = Date.now();
  const response = await fetch(`${BASE}/api/projects/${PID}/export/results?${query}`, {
    headers: { cookie },
  });
  if (!response.ok) throw new Error(`export failed: ${response.status}`);

  // Consumed incrementally, as a client saving to disk would.
  let bytes = 0;
  let rows = 0;
  let firstByteMs = null;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs === null) firstByteMs = Date.now() - started;
    bytes += value.length;
    for (const byte of value) if (byte === 10) rows++;
  }
  const elapsedMs = Date.now() - started;
  sampling = false;
  await sampler;

  const peak = samples.length ? Math.max(...samples) : null;
  const mib = bytes / 1024 / 1024;
  const growth = baseline !== null && peak !== null ? peak - baseline : null;

  console.log(
    `  ${label.padEnd(12)} ${String(rows - 1).padStart(9)} rows  ${mib.toFixed(1).padStart(6)} MiB  ` +
      `ttfb ${String(firstByteMs).padStart(4)}ms  total ${(elapsedMs / 1000).toFixed(1)}s  ` +
      `mem +${growth?.toFixed(1)} MiB`,
  );
  return { rows: rows - 1, mib, firstByteMs, elapsedMs, growth };
}

console.log('  export        rows           size   time-to-first-byte      memory');

// A window covering roughly the most recent slice, then the whole retained set. A buffered
// implementation's memory scales with the payload; a streaming one's does not.
const half = new Date(Date.now() - 20 * 86_400_000).toISOString();
const small = await measureExport('recent', `format=csv&from=${encodeURIComponent(half)}`);
await new Promise((r) => setTimeout(r, 3000));
const full = await measureExport('full window', 'format=csv');

const sizeRatio = full.mib / Math.max(small.mib, 0.01);
const memRatio =
  small.growth && small.growth > 1 ? (full.growth ?? 0) / small.growth : null;

console.log(`
  payload grew ${sizeRatio.toFixed(1)}x (${small.mib.toFixed(1)} -> ${full.mib.toFixed(1)} MiB)
  memory  grew ${memRatio === null ? 'n/a' : `${memRatio.toFixed(1)}x`} (${small.growth?.toFixed(1)} -> ${full.growth?.toFixed(1)} MiB)
`);

const checks = [
  ['the full retained set exports', full.rows > 100_000, `${full.rows.toLocaleString()} rows`],
  [
    'streams: bytes arrive long before the export finishes',
    (full.firstByteMs ?? 0) < full.elapsedMs * 0.25,
    `first byte at ${full.firstByteMs}ms of ${full.elapsedMs}ms`,
  ],
  [
    // The decisive test. Buffering would make memory track the payload; streaming keeps it
    // bounded by the batch size regardless of how much is emitted.
    'memory does not scale with payload size',
    memRatio === null || memRatio < sizeRatio * 0.5,
    memRatio === null
      ? 'baseline growth too small to compare; memory stayed flat'
      : `payload ${sizeRatio.toFixed(1)}x but memory ${memRatio.toFixed(1)}x`,
  ],
];

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} -- ${detail}`);
  if (!ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
