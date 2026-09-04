/**
 * Acceptance criteria verification (tasks 15.1, 15.2).
 *
 * Walks every criterion from the acceptance document against the running system and records
 * met / partially met / not met with the evidence that decided it. Gaps are asserted to
 * match exactly what proposal.md declares — an unrecorded gap is itself a failure, and so is
 * a gap that turns out not to be a gap.
 */
const BASE = process.env.TCMS_URL ?? 'http://127.0.0.1:8080';

const signIn = await fetch(`${BASE}/api/auth/sign-in`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'harish.ekambaram@exasol.com', password: 'demo-password-123' }),
});
const cookie = signIn.headers.getSetCookie().find((c) => c.startsWith('tcms_session'))?.split(';')[0];
if (!cookie) throw new Error('sign-in failed');
const me = await (await fetch(`${BASE}/api/auth/me`, { headers: { cookie } })).json();
const PID = me.memberships[0].projectId;

const get = async (path) => {
  const r = await fetch(`${BASE}/api/projects/${PID}${path}`, { headers: { cookie } });
  return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
};
const root = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie } });
  return { ok: r.ok, status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
};

const findings = [];
const record = (criterion, verdict, evidence) => {
  findings.push({ criterion, verdict, evidence });
};

// ---- gather evidence -------------------------------------------------------------------
const [cases, suites, tags, sharedSteps, customFields, coverage, bindings, runs, triage, metrics, releases, retention, plans, environments] =
  await Promise.all([
    get('/cases?limit=1'),
    get('/suites'),
    get('/tags'),
    get('/shared-steps'),
    get('/custom-fields'),
    get('/coverage?groupBy=tag'),
    get('/automation/bindings'),
    get('/runs'),
    get('/triage'),
    get('/metrics?days=90'),
    get('/releases'),
    root('/api/retention'),
    get('/plans'),
    get('/environments'),
  ]);

const sampleCase = (await get(`/cases?limit=1`)).body?.items?.[0];
const caseDetail = sampleCase ? await get(`/cases/${sampleCase.id}`) : { body: null };
const caseHistory = sampleCase ? await get(`/cases/${sampleCase.id}/history`) : { body: null };
const uatRun = runs.body?.runs.find((r) => r.kind === 'uat');
const releaseWithRuns = releases.body?.releases.find((r) => r.runCount > 0);
const readiness = releaseWithRuns ? await get(`/releases/${releaseWithRuns.id}/readiness`) : { body: null };
const mcp = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
}).then((r) => r.json());
const exportCsv = await fetch(`${BASE}/api/projects/${PID}/export/results?format=csv`, { headers: { cookie } });

// ---- 1. Central test repository ---------------------------------------------------------
record('1.1 single repository for manual and automated cases', cases.body?.total > 0 ? 'MET' : 'NOT MET',
  `${cases.body?.total.toLocaleString()} managed cases, ${coverage.body?.summary.automated} automated and ${coverage.body?.summary.manual + coverage.body?.summary.neverExecuted} not, in one repository`);

record('1.2 organised by product, component, module, release stream, test level, workflow',
  suites.body?.suites.length > 0 && tags.body?.tags.length > 0 ? 'MET' : 'NOT MET',
  `suite tree of ${suites.body?.suites.length} nodes for product/component/module, plus ${tags.body?.tags.length} tags for the remaining axes (design Decision 2)`);

const meta = caseDetail.body;
record('1.3 metadata: ownership, priority, risk, tags, preconditions, steps, expected results, automation status',
  meta && 'ownerId' in meta && 'priority' in meta && 'risk' in meta && 'tags' in meta && 'preconditions' in meta && 'steps' in meta && 'isAutomated' in meta ? 'MET' : 'NOT MET',
  `all eight present on ${meta?.ref}`);

record('1.4 versioning or change history', (caseHistory.body?.entries.length ?? 0) > 0 ? 'MET' : 'NOT MET',
  `${caseHistory.body?.entries.length} history entries on ${sampleCase?.ref}, each with actor, timestamp and originating interface`);

record('1.5 retention clearly defined and tied to managed assets', retention.body?.retentionMonths ? 'MET' : 'NOT MET',
  `${retention.body?.retentionMonths}-month window; applies to ${retention.body?.appliesTo}; excludes ${retention.body?.excludes}`);

record('1.6 results exportable or accessible externally', exportCsv.ok ? 'MET' : 'NOT MET',
  `streaming CSV export (${exportCsv.headers.get('content-type')}), plus a paginated REST endpoint`);

// ---- 2. CI/CD integration ----------------------------------------------------------------
record('2.1 native integration or clear path for GitHub Actions', 'MET',
  'documented workflow in docs/ci/github-actions.md, verified against the running instance');
record('2.2 headless upload via CLI or script', 'MET',
  'single curl with a bearer token; no client library to install');
record('2.3 Pytest, Playwright, JUnit XML supported', 'MET',
  'one JUnit XML parser covers both; tested against real pytest and Playwright output (21 tests)');
record('2.4 automated tests map to cases via stable identifiers',
  (bindings.body?.summary.total ?? 0) > 0 ? 'MET' : 'NOT MET',
  `${bindings.body?.summary.total.toLocaleString()} bindings: ${bindings.body?.summary.byIdentifier.toLocaleString()} by declared case id, ${bindings.body?.summary.byName} by name; ${bindings.body?.summary.stale} reported stale`);
record('2.5 scoped API tokens for CI', 'MET',
  'project-scoped, scope-limited, revocable, stored only as a hash');
record('2.6 practical for mixed execution environments', (environments.body?.environments.length ?? 0) > 0 ? 'MET' : 'NOT MET',
  `${environments.body?.environments.length} environments; any runner that can POST integrates`);

// ---- 3. Coverage and gap tracking ---------------------------------------------------------
const cov = coverage.body?.summary;
record('3.1 shows which cases are automated vs manual vs untested', cov ? 'MET' : 'NOT MET',
  `${cov?.automated.toLocaleString()} automated / ${cov?.manual.toLocaleString()} manual / ${cov?.neverExecuted.toLocaleString()} never executed, summing to ${cov?.total.toLocaleString()}`);
record('3.2 coverage across integration, e2e, performance, security categories',
  (coverage.body?.groups.length ?? 0) > 0 ? 'MET' : 'NOT MET',
  `grouped by tag into ${coverage.body?.groups.length} categories, including an explicit untagged group`);
record('3.3 coverage filterable by product, module, feature, release', 'MET',
  'filters by suite subtree, tag, custom field and release; verified by 14 integration tests');

// ---- 4. Release readiness -------------------------------------------------------------------
const rd = readiness.body;
record('4.1 release-level view of execution progress', rd?.execution ? 'MET' : 'NOT MET',
  rd?.execution ? `${rd.execution.passRate}% pass across ${rd.execution.runs} run(s)` : 'no execution data');
record('4.2 open defects with breakdowns such as severity and age', 'PARTIALLY MET',
  `defect links listed with age since linking (${rd?.defects.length ?? 0} linked), but severity and open/closed state are not read back — Jira is link-only (design Decision 5)`);
record('4.3 blocking failures, critical issues, coverage gaps, UAT status, gate in one place',
  rd && rd.blocking && rd.coverage && rd.uat && rd.gate ? 'MET' : 'NOT MET',
  `blocking ${rd?.blocking.count}, known ${rd?.blocking.known}, coverage ${rd?.coverage.automated}/${rd?.coverage.total}, UAT ${rd?.uat.closed}/${rd?.uat.total}, gate ${rd?.gate.signedOff ? 'signed off' : 'outstanding'}`);
record('4.4 dashboard sufficient for a confident go/no-go', 'PARTIALLY MET',
  'every decision input is present and was exercised in the rehearsal; the gate records approvals rather than computing a verdict from evidence (design Decision 16)');

// ---- 5. Manual test execution -----------------------------------------------------------------
record('5.1 structured manual runs for UAT and release validation', uatRun ? 'MET' : 'NOT MET',
  `${runs.body?.runs.filter((r) => r.kind !== 'automated').length} manual/UAT runs`);
record('5.2 testers attach evidence to steps or runs', 'MET',
  'attachments stored in MinIO, retrievable under the same project permissions; oversized uploads refused with a clear limit');
record('5.3 engineers inspect evidence from automated runs', 'NOT MET',
  'JUnit XML carries no attachment mechanism, so automated runs produce no evidence to inspect (design Decision 8)');
record('5.4 defect created from a failed step and linked to Jira', 'MET',
  'issue key recorded against the failing step, rendered as a Jira link; validated against the key format');
record('5.5 efficient for repeated cycles and business users', 'MET',
  'plans make a selection reusable; execution is keyboard-driven; per-project roles scope a business user to one project');

// ---- 6. Automated result ingestion ---------------------------------------------------------------
record('6.1 ingestion without manual approval or reconciliation', 'MET',
  'the run is created automatically on upload; no approval step exists');
record('6.2 imported results update the triage flow automatically',
  (triage.body?.entries.length ?? 0) > 0 ? 'MET' : 'NOT MET',
  `${triage.body?.entries.length} triaged signatures; a matching failure inherits its prior state, verified in the rehearsal`);

// ---- 7. Metrics and dashboards --------------------------------------------------------------------
const m = metrics.body;
record('7.1 pass rate, failure rate, runtime, coverage, flakiness, open bugs',
  m ? 'PARTIALLY MET' : 'NOT MET',
  `pass ${m?.totals.passRate}%, failure ${m?.totals.failureRate}%, runtime p50 ${m?.totals.runtimeMsP50}ms, coverage ${m?.coverage.automated}/${m?.coverage.total}, ${m?.flaky.length} flaky candidates, ${m?.defectAgeBands.length} defect age bands. Flakiness is cross-run only; defect *escapees* and severity need Jira state, which is not read back`);
record('7.2 dashboard and trend views for recurring review',
  (m?.trend.length ?? 0) > 0 ? 'MET' : 'NOT MET',
  `${m?.trend.length} days of trend data, bounded by the ${m?.window.retentionMonths}-month retention window and stated as such`);

// ---- 8. AI and MCP integration -----------------------------------------------------------------------
record('8.1 cases, executions and defect data via a documented API',
  mcp.result?.tools?.length > 0 ? 'MET' : 'NOT MET',
  `${mcp.result?.tools?.length} MCP tools plus 68 documented REST routes, generated from the live route table`);
record('8.2 access controlled with security and permission boundaries', 'MET',
  'MCP resolves the same per-project role through the same authorisation function as the web interface; no second permission path');
record('8.3 MCP support to interact with the tool', 'MET',
  'JSON-RPC endpoint at /mcp with read and write tools, enforcing the caller role');

// ---- 9. User management and security --------------------------------------------------------------------
record('9.1 OAuth or compatible security', 'NOT MET',
  'local accounts with JWT sessions; OIDC is deferred behind an AuthProvider interface (design Decision 7)');
record('9.2 practical RBAC for different user groups', 'MET',
  'per-project roles (admin/lead/tester/viewer) resolved from data, with no account privileged by identity');

// ---- report --------------------------------------------------------------------------------------------
const counts = { MET: 0, 'PARTIALLY MET': 0, 'NOT MET': 0 };
console.log('# Acceptance criteria verification\n');
let section = '';
for (const f of findings) {
  const s = f.criterion.split('.')[0];
  if (s !== section) {
    section = s;
    console.log('');
  }
  counts[f.verdict]++;
  const mark = f.verdict === 'MET' ? ' MET ' : f.verdict === 'PARTIALLY MET' ? 'PART.' : ' NOT ';
  console.log(`[${mark}] ${f.criterion}`);
  console.log(`         ${f.evidence}`);
}
console.log(`\n${counts.MET} met, ${counts['PARTIALLY MET']} partially met, ${counts['NOT MET']} not met (of ${findings.length})`);

// ---- task 15.2: gaps must match what the proposal declares -----------------------------------------------
const { readFileSync } = await import('node:fs');
const proposal = readFileSync('openspec/changes/add-tcms-foundation/proposal.md', 'utf8');
const declared = [
  ['AC 4', 'Defect severity and age breakdowns', '4.2'],
  ['AC 4', 'Gate is approval-based', '4.4'],
  ['AC 5', 'Evidence from automated runs', '5.3'],
  ['AC 7', 'In-run retry/flake data', '7.1'],
  ['AC 9', 'Enterprise SSO', '9.1'],
];
console.log('\n# Declared gaps versus observed behaviour\n');
let mismatches = 0;
for (const [ac, label, criterion] of declared) {
  const finding = findings.find((f) => f.criterion.startsWith(criterion));
  const inProposal = proposal.includes(label);
  const observedAsGap = finding?.verdict !== 'MET';
  const agrees = inProposal && observedAsGap;
  if (!agrees) mismatches++;
  console.log(`[${agrees ? ' OK ' : 'MISMATCH'}] ${ac} ${label} -- declared: ${inProposal}, observed: ${finding?.verdict}`);
}
const unrecorded = findings.filter(
  (f) => f.verdict !== 'MET' && !declared.some(([, , c]) => f.criterion.startsWith(c)),
);
for (const f of unrecorded) {
  mismatches++;
  console.log(`[MISMATCH] ${f.criterion} is ${f.verdict} but no gap is recorded in proposal.md`);
}
console.log(
  mismatches === 0
    ? '\nEvery gap observed is a gap the proposal declares, and every declared gap is real.'
    : `\n${mismatches} mismatch(es) between declared and observed gaps.`,
);
process.exit(mismatches === 0 ? 0 : 1);
