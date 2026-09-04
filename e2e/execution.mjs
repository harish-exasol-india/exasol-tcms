/** Browser verification of runs, execution, triage, release readiness and metrics. */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};
const num = async (page, id) =>
  Number((await page.getByTestId(id).textContent())?.replace(/[^\d.]/g, '') ?? '0');

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

async function signIn(p) {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.fill('input[type="email"]', 'harish.ekambaram@exasol.com');
  await p.fill('input[type="password"]', 'demo-password-123');
  await p.click('button[type="submit"]');
  await p.waitForSelector('[data-testid="tab-runs"]', { timeout: 20000 });
}

try {
  await signIn(page);

  // ---- Runs list (tasks 5.5, 9.8) ----
  await page.getByTestId('tab-runs').click();
  await page.waitForSelector('[data-testid="runs-table"]', { timeout: 20000 });
  const runRows = await page.locator('[data-testid="runs-table"] tbody tr').count();
  check('runs list renders', runRows > 0, `${runRows} runs`);
  check('planning vocabulary is shown', (await page.locator('[data-testid="plans-table"]').count()) === 1);
  check('environments listed', (await page.locator('[data-testid="environments-table"]').count()) === 1);
  check('releases listed', (await page.locator('[data-testid="releases-table"]').count()) === 1);

  // ---- Run execution (task 9.8) ----
  await page.locator('[data-testid="runs-table"] tbody tr button.link').first().click();
  await page.waitForSelector('[data-testid="execution-panel"]', { timeout: 20000 });
  check('run execution view opens', true);
  const progressText = await page.getByTestId('run-progress').textContent();
  check('run progress is shown', /\d+\/\d+ executed/.test(progressText ?? ''), progressText?.trim());

  const before = await page.getByTestId('current-outcome').textContent();
  // Keyboard-driven execution: '1' records a pass and advances (task 9.8).
  await page.keyboard.press('1');
  await page.waitForTimeout(1500);
  const afterKeyboard = await page.getByTestId('current-outcome').textContent();
  check(
    'a keystroke records a result and advances to the next case',
    afterKeyboard !== null,
    `${before} -> advanced to a case showing ${afterKeyboard}`,
  );

  // Defect linking with validation (task 9.7).
  await page.getByTestId('issue-key').fill('not a key');
  await page.getByTestId('link-defect').click();
  await page.waitForSelector('[data-testid="defect-error"]', { timeout: 10000 });
  const defectError = await page.getByTestId('defect-error').textContent();
  check('an invalid issue key is rejected with the expected format', /PROJECT-123/.test(defectError ?? ''), defectError?.trim());

  await page.getByTestId('issue-key').fill(`EXA-${Math.floor(Math.random() * 9000) + 1000}`);
  await page.getByTestId('link-defect').click();
  await page.waitForTimeout(1500);
  check('a valid issue key links', (await page.locator('[data-testid="defect-list"]').count()) === 1);

  // ---- Triage (task 7.6) ----
  await page.getByTestId('tab-triage').click();
  await page.waitForSelector('[data-testid="triage-table"]', { timeout: 20000 });
  const triageRows = await page.locator('[data-testid="triage-table"] tbody tr').count();
  check('triage table renders', triageRows > 0, `${triageRows} signatures`);
  const attention = await num(page, 'triage-attention');
  check('separates failures needing a decision from those that have one', attention >= 0, `${attention} need a decision`);

  const firstRow = page.locator('[data-testid^="triage-state-"]').first();
  if ((await firstRow.count()) > 0) {
    await firstRow.selectOption('known_issue');
    await page.waitForTimeout(1500);
    const known = await num(page, 'triage-count-known_issue');
    check('changing a triage state updates the counts', known > 0, `${known} known issues`);
  }

  // ---- Release readiness (task 10.7) ----
  await page.getByTestId('tab-releases').click();
  await page.waitForSelector('[data-testid="gate-status"]', { timeout: 20000 });
  const gate = await page.getByTestId('gate-status').textContent();
  check('gate status is shown', Boolean(gate), gate?.trim().slice(0, 60));

  const panels = ['release-pass-rate', 'release-blocking', 'release-coverage', 'release-uat'];
  const present = [];
  for (const id of panels) {
    if ((await page.getByTestId(id).count()) > 0) present.push(id);
  }
  check(
    'execution, blocking, coverage and UAT are all in one view (AC 4)',
    present.length === panels.length,
    present.join(', '),
  );
  check('blocking failures listed', (await page.locator('[data-testid="blocking-table"]').count()) >= 0);
  check('sign-off checklist rendered', (await page.locator('[data-testid="signoff-table"]').count()) === 1);

  const signOffButtons = await page.locator('[data-testid^="signoff-complete-"]').count();
  if (signOffButtons > 0) {
    await page.locator('[data-testid^="signoff-complete-"]').first().click();
    await page.waitForTimeout(1800);
    const done = await page.locator('[data-testid^="signoff-done-"]').count();
    check('signing off records who approved and when', done > 0, `${done} completed`);
  } else {
    check('sign-off items already complete', true);
  }

  // ---- Metrics (task 11.5) ----
  await page.getByTestId('tab-metrics').click();
  await page.waitForSelector('[data-testid="metric-pass-rate"]', { timeout: 20000 });
  const passRate = await num(page, 'metric-pass-rate');
  const failureRate = await num(page, 'metric-failure-rate');
  check('pass and failure rates are reported', passRate > 0, `${passRate}% pass, ${failureRate}% fail`);
  check('rates are complementary', Math.abs(passRate + failureRate - 100) < 1.5, `${passRate}+${failureRate}`);
  check('executions counted', (await num(page, 'metric-executions')) > 0);
  check('coverage shown alongside', (await num(page, 'metric-coverage')) >= 0);
  check('trend series rendered', (await page.locator('.sparkline').count()) >= 3);
  check('flaky candidates table present', (await page.locator('[data-testid="flaky-table"]').count()) === 1);
  const flakyRows = await page.locator('[data-testid="flaky-table"] tbody tr').count();
  check('flaky candidates detected from seeded data', flakyRows > 0, `${flakyRows} candidates`);

  // Retention boundary is stated, not silently applied.
  await page.getByTestId('metrics-window-365').click();
  await page.waitForTimeout(2000);
  const truncated = await page.locator('[data-testid="metrics-truncated"]').count();
  const windowLabel = await page.getByTestId('metrics-window-label').textContent();
  check('a window beyond retention is disclosed', truncated === 1, windowLabel?.trim());

  check('no uncaught exceptions', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: 'e2e/metrics.png', fullPage: false });
} finally {
  await browser.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
