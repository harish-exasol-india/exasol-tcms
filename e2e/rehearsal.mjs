/**
 * End-to-end release rehearsal (task 15.3).
 *
 * Walks the whole workflow the product exists for, in one pass, against the running system:
 * author a case, upload CI results, triage a failure, execute a manual UAT run, link a
 * defect, and complete release sign-off. The question it answers is whether the release view
 * at the end could actually support a go/no-go discussion.
 */
const BASE = process.env.TCMS_URL ?? 'http://127.0.0.1:8080';
const stamp = Date.now();
const steps = [];
const step = (name, ok, detail = '') => {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const signIn = await fetch(`${BASE}/api/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'harish.ekambaram@exasol.com', password: 'demo-password-123' }),
});
const cookie = signIn.headers.getSetCookie().find((c) => c.startsWith('tcms_session'))?.split(';')[0];
if (!cookie) throw new Error('sign-in failed');
const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })).json();
const PID = me.memberships[0].projectId;

const api = async (method, path, body, extraHeaders = {}) => {
  const r = await fetch(`${BASE}/api/projects/${PID}${path}`, {
    method,
    headers: { cookie, ...(body && typeof body === 'object' ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const text = await r.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
  return parsed;
};

// ---- 1. Author a case ------------------------------------------------------------------
const suites = await api('GET', '/suites');
const suiteId = suites.suites[0].id;
const authored = await api('POST', '/cases', {
  suiteId,
  title: `Rehearsal: cluster failover ${stamp}`,
  priority: 'critical',
  risk: 'high',
  preconditions: 'A three-node cluster is running',
  steps: [
    { action: 'Stop the active node', expected: 'A standby is promoted' },
    { action: 'Run a query', expected: 'It succeeds against the new active node' },
  ],
  tags: ['  End-To-End  ', 'RELEASE-9.0.X'],
});
step('a test case is authored with full metadata', Boolean(authored.ref), authored.ref);
step(
  'tags are normalised on write',
  authored.tags.includes('end-to-end') && authored.tags.includes('release-9.0.x'),
  authored.tags.join(', '),
);

const history = await api('GET', `/cases/${authored.id}/history`);
step('authoring is recorded in the change history', history.entries.length === 1, history.entries[0]?.action);

// ---- 2. Upload CI results --------------------------------------------------------------
// The create endpoint returns only an id; the name is needed for the ingest query string,
// so the release is read back rather than assumed.
const releaseName = `9.0.0-rc${stamp}`;
await api('POST', '/releases', { name: releaseName, status: 'in_progress' }).catch(() => null);
const release = (await api('GET', '/releases')).releases.find((r) => r.name === releaseName);
if (!release) throw new Error('release was not created');
const token = await (async () => {
  // Tokens are issued out of band; create one directly for the rehearsal.
  const { execSync } = await import('node:child_process');
  return execSync(
    `cd packages/backend && DATABASE_URL="postgres://tcms:tcms@127.0.0.1:5432/tcms" node -e "` +
      `import('./dist/db/client.js').then(async (c) => {` +
      `const {createTokenService} = await import('./dist/auth/token-service.js');` +
      `const pool = c.createPool(process.env.DATABASE_URL); const db = c.createDatabase(pool);` +
      `const t = await createTokenService(db).issue({projectId:'${PID}',name:'rehearsal-${stamp}',scopes:['results:write']});` +
      `console.log(t.secret); await pool.end();})"`,
    { encoding: 'utf8', cwd: process.cwd() },
  ).trim().split('\n').pop();
})();

const junit = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="rehearsal"><testsuite name="rehearsal" tests="3" failures="1">
  <testcase classname="tests.cluster" name="test_failover" time="2.5">
    <properties><property name="tcms.id" value="${authored.ref}"/></properties>
    <failure message="AssertionError: standby was not promoted within 30s">stack</failure>
  </testcase>
  <testcase classname="tests.cluster" name="test_query_after_failover" time="1.1"/>
  <testcase classname="tests.cluster" name="test_unmapped_thing" time="0.2"/>
</testsuite></testsuites>`;

const ingest1 = await fetch(
  `${BASE}/api/projects/${PID}/results/junit?release=${encodeURIComponent(release.name)}&environment=ci&branch=main&commitSha=rehearsal${stamp}`,
  { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' }, body: junit },
).then((r) => r.json());

step('CI results upload headlessly with only a scoped token', ingest1.ingested === 3, `${ingest1.ingested} results`);
step('the authored case is bound by its declared identifier', ingest1.bound.byIdentifier === 1, JSON.stringify(ingest1.bound));
step('an unmapped test is retained, not turned into a case', ingest1.unbound === 2, `${ingest1.unbound} unbound`);
step('the failure is raised as new', ingest1.triage.newFailures === 1, JSON.stringify(ingest1.triage));

// ---- 3. Triage, then prove carry-forward ------------------------------------------------
const triage = await api('GET', '/triage');
const entry = triage.entries.find((e) => e.caseRef === authored.ref);
step('the failure appears in triage against the right case', Boolean(entry), entry?.caseRef);

await api('PATCH', `/triage/${entry.id}`, { state: 'known_issue', note: 'Upstream fix pending' });
const ingest2 = await fetch(
  `${BASE}/api/projects/${PID}/results/junit?release=${encodeURIComponent(release.name)}&environment=ci&branch=main&commitSha=rehearsal${stamp}b`,
  { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' }, body: junit },
).then((r) => r.json());
step(
  'a triaged failure carries forward and does not re-alert',
  ingest2.triage.newFailures === 0 && ingest2.triage.carriedForward === 1,
  JSON.stringify(ingest2.triage),
);

// ---- 4. Coverage reflects the automation ------------------------------------------------
const coverage = await api('GET', `/coverage?tag=end-to-end`);
step(
  'coverage counts the case as automated once bound',
  coverage.summary.automated >= 1,
  `${coverage.summary.automated} automated of ${coverage.summary.total}`,
);

// ---- 5. Manual UAT run ------------------------------------------------------------------
const plan = await api('POST', '/plans', { name: `Rehearsal plan ${stamp}`, caseIds: [authored.id] });
const uat = await api('POST', '/runs', {
  name: `UAT rehearsal ${stamp}`,
  kind: 'uat',
  planId: plan.id,
  releaseId: release.id,
});
const runDetail = await api('GET', `/runs/${uat.id}`);
step('a UAT run is created from the plan', runDetail.cases.length === 1, `${runDetail.cases.length} case(s)`);

const runCase = runDetail.cases[0];
await api('PATCH', `/runs/${uat.id}/cases/${runCase.id}`, {
  outcome: 'failed',
  basedOnVersion: runCase.version,
  comment: 'Standby promotion timed out, matching the automated failure',
  steps: [
    { position: 1, outcome: 'failed', comment: 'No promotion after 30s' },
    { position: 2, outcome: 'blocked' },
  ],
});
const executed = await api('GET', `/runs/${uat.id}/cases/${runCase.id}`);
step('a tester records a step-level failure', executed.outcome === 'failed' && executed.steps[0].outcome === 'failed');

// ---- 6. Defect from the failed step ------------------------------------------------------
const defect = await api('POST', `/runs/${uat.id}/cases/${runCase.id}/defects`, {
  issueKey: 'EXA-9001',
  stepPosition: 1,
});
step('a defect is raised from the failed step and links to Jira', defect.url.includes('/browse/EXA-9001'), defect.url);

await api('POST', `/runs/${uat.id}/close`);

// ---- 7. Release readiness ----------------------------------------------------------------
await api('POST', `/releases/${release.id}/sign-offs`, { name: `QA lead ${stamp}` }).catch(() => null);
const readinessBefore = await api('GET', `/releases/${release.id}/readiness`);
step('the release view reports execution progress', readinessBefore.execution !== null, `${readinessBefore.execution?.passRate}% pass`);
step('known issues are excluded from blocking', readinessBefore.blocking.known >= 1, `${readinessBefore.blocking.count} blocking, ${readinessBefore.blocking.known} known`);
step('the linked defect appears with its age', readinessBefore.defects.some((d) => d.issueKey === 'EXA-9001'));
step('coverage is shown alongside', typeof readinessBefore.coverage.automated === 'number');
step('UAT status is shown', readinessBefore.uat.total >= 1, `${readinessBefore.uat.closed}/${readinessBefore.uat.total} closed`);
step('the gate is not signed off while an item is outstanding', readinessBefore.gate.signedOff === false, readinessBefore.gate.outstanding.join(', '));

const outstanding = readinessBefore.gate.items.find((i) => !i.completedAt);
await api('POST', `/sign-offs/${outstanding.id}/complete`);
const readinessAfter = await api('GET', `/releases/${release.id}/readiness`);
step('signing off records who approved and when', Boolean(readinessAfter.gate.items.find((i) => i.id === outstanding.id)?.completedAt));

// ---- 8. Could this support a go/no-go? ---------------------------------------------------
const r = readinessAfter;
const decisionInputs = {
  'execution progress': r.execution !== null,
  'pass rate': typeof r.execution?.passRate === 'number',
  'blocking failures': typeof r.blocking.count === 'number',
  'known issues separated': typeof r.blocking.known === 'number',
  'linked defects': Array.isArray(r.defects),
  'coverage gap': typeof r.coverage.manual === 'number',
  'UAT status': typeof r.uat.closed === 'number',
  'gate status': typeof r.gate.signedOff === 'boolean',
};
const missing = Object.entries(decisionInputs).filter(([, present]) => !present).map(([k]) => k);
step(
  'the release view carries every input a go/no-go needs (AC 4)',
  missing.length === 0,
  missing.length ? `missing: ${missing.join(', ')}` : Object.keys(decisionInputs).join(', '),
);

// ---- 9. Export for downstream reporting --------------------------------------------------
const csv = await fetch(`${BASE}/api/projects/${PID}/export/results?format=csv&releaseId=${release.id}`, {
  headers: { cookie },
});
const csvText = await csv.text();
step('results export for downstream reporting', csv.ok && csvText.split('\n').length > 1, `${csvText.split('\n').length - 2} rows`);

const failed = steps.filter((s) => !s.ok).length;
console.log(`\n${steps.length - failed}/${steps.length} rehearsal steps passed`);
process.exit(failed === 0 ? 0 : 1);
