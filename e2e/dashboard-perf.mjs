/**
 * Dashboard query performance (task 11.6).
 *
 * Design Decision 20 says materialized views are added only where measurement shows they
 * are needed. This measures every reporting endpoint at the full envelope so that decision
 * is made from data rather than assumption.
 */
const BASE = process.env.TCMS_URL ?? 'http://127.0.0.1:8080';
const PID = process.env.PROJECT_ID;
const SLOW_MS = Number(process.env.SLOW_MS ?? 1000);

const signIn = await fetch(`${BASE}/api/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'harish.ekambaram@exasol.com', password: 'demo-password-123' }),
});
const cookie = signIn.headers.getSetCookie().find((c) => c.startsWith('tcms_session'))?.split(';')[0];
if (!cookie) throw new Error('sign-in failed');

const releases = await (await fetch(`${BASE}/api/projects/${PID}/releases`, { headers: { cookie } })).json();
const releaseId = releases.releases[0]?.id;

const panels = [
  ['coverage summary', `/coverage`],
  ['coverage by tag', `/coverage?groupBy=tag`],
  ['coverage by suite', `/coverage?groupBy=suite`],
  ['uncovered drill-through', `/coverage/uncovered`],
  ['automation bindings', `/automation/bindings`],
  ['triage list', `/triage`],
  ['runs list', `/runs`],
  ['metrics 30d', `/metrics?days=30`],
  ['metrics 90d', `/metrics?days=90`],
  ['metrics 365d', `/metrics?days=365`],
  ['release readiness', releaseId ? `/releases/${releaseId}/readiness` : null],
  ['case list page', `/cases?limit=200`],
];

console.log('  panel                       p50      p95      max   status');
const slow = [];
for (const [label, path] of panels) {
  if (!path) continue;
  const times = [];
  let status = 0;
  for (let i = 0; i < 7; i++) {
    const t0 = performance.now();
    const r = await fetch(`${BASE}/api/projects/${PID}${path}`, { headers: { cookie } });
    await r.arrayBuffer();
    times.push(performance.now() - t0);
    status = r.status;
  }
  times.sort((a, b) => a - b);
  const p = (q) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * q))]);
  if (p(0.5) > SLOW_MS) slow.push({ label, p50: p(0.5) });
  console.log(
    `  ${label.padEnd(25)} ${String(p(0.5)).padStart(5)}ms ${String(p(0.95)).padStart(6)}ms ${String(Math.round(times.at(-1))).padStart(6)}ms   ${status}`,
  );
}

console.log(
  slow.length === 0
    ? `\n  Every panel is under ${SLOW_MS}ms at p50. No materialized view is warranted (design Decision 20).`
    : `\n  Panels above ${SLOW_MS}ms at p50, and therefore candidates for a materialized view:\n${slow.map((s) => `    - ${s.label}: ${s.p50}ms`).join('\n')}`,
);
process.exit(0);
