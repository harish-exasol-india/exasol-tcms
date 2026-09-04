/**
 * Two testers in one run (tasks 9.5, 9.6, 9.9, 9.10).
 *
 * Drives two independent browser contexts against the same run to prove the thing design
 * Decision 13 exists for: one tester's result must not silently overwrite another's.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch();

async function session(email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', 'demo-password-123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="tab-runs"]', { timeout: 20000 });
  return { context, page };
}

// A fresh run so the test is repeatable.
const setup = await session('harish.ekambaram@exasol.com');
const runName = `Concurrency ${Date.now()}`;
await setup.page.getByTestId('tab-runs').click();
await setup.page.waitForSelector('[data-testid="runs-table"]', { timeout: 20000 });
await setup.page.getByTestId('new-run').click();
await setup.page.getByTestId('run-name').fill(runName);
const planOption = await setup.page
  .getByTestId('run-plan')
  .locator('option')
  .nth(1)
  .getAttribute('value');
await setup.page.getByTestId('run-plan').selectOption(planOption);
await setup.page.getByTestId('create-run').click();
await setup.page.waitForSelector('[data-testid="execution-panel"]', { timeout: 20000 });
const runUrl = setup.page.url();
check('a run can be created from a plan in the browser', true, runName);

try {
  // ---- Task 9.5 / 9.6: evidence ----
  const evidence = '/tmp/evidence.png';
  writeFileSync(
    evidence,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  await setup.page.getByTestId('attachment-input').setInputFiles(evidence);
  await setup.page.waitForSelector('[data-testid="attachment-list"]', { timeout: 20000 });
  const attachments = await setup.page.locator('[data-testid="attachment-list"] li').count();
  check('evidence can be attached to a case in a run', attachments > 0, `${attachments} file(s)`);

  const link = await setup.page.locator('[data-testid="attachment-list"] a').first().getAttribute('href');
  const fetched = await setup.page.evaluate(async (href) => {
    const r = await fetch(href, { credentials: 'include' });
    return { status: r.status, type: r.headers.get('content-type') };
  }, link);
  check('attached evidence can be retrieved', fetched.status === 200, `${fetched.status} ${fetched.type}`);

  // Oversized upload is refused.
  const big = '/tmp/too-big.bin';
  writeFileSync(big, Buffer.alloc(27 * 1024 * 1024));
  await setup.page.getByTestId('attachment-input').setInputFiles(big);
  await setup.page.waitForTimeout(4000);
  const errorShown = await setup.page.locator('[data-testid="attachment-error"]').count();
  check('an oversized upload is refused with a message', errorShown === 1,
    errorShown ? (await setup.page.getByTestId('attachment-error').textContent())?.trim() : 'no error shown');

  // ---- Task 9.9 / 9.10: two concurrent testers ----
  const second = await session('second.tester@exasol.com');
  await second.page.goto(runUrl, { waitUntil: 'networkidle' });
  await second.page.getByTestId('tab-runs').click();
  await second.page.waitForSelector('[data-testid="runs-table"]', { timeout: 20000 });
  await second.page
    .locator(`[data-testid="runs-table"] tbody tr:has-text("${runName}") button.link`)
    .first()
    .click();
  await second.page.waitForSelector('[data-testid="execution-panel"]', { timeout: 20000 });
  check('a second tester opens the same run', true);

  // Both testers must be working the same case for the race to be real.
  const targetRef = await setup.page
    .locator('[data-testid="execution-panel"] .mono')
    .first()
    .textContent();
  await second.page.getByTestId(`run-case-${targetRef?.trim()}`).click();
  await second.page.waitForTimeout(1500);

  // The run view polls every 5s, which also refreshes the optimistic-concurrency version.
  // That is correct behaviour, but it makes the race non-deterministic to test. Pinning the
  // polled version to what this page first read reproduces exactly the state of a tester who
  // clicked within the polling window.
  const pinnedVersions = new Map();
  await second.page.route('**/api/projects/*/runs/*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body.cases)) {
      for (const c of body.cases) {
        if (!pinnedVersions.has(c.id)) pinnedVersions.set(c.id, c.version);
        c.version = pinnedVersions.get(c.id);
      }
    }
    return route.fulfill({ response, json: body });
  });
  await second.page.waitForTimeout(6000);

  // First tester writes, moving the real version forward.
  await setup.page.getByTestId('record-failed').click();
  await setup.page.waitForTimeout(2500);

  // Second writes based on the version it read before the first write landed.
  // Capture what the second page actually sends, to see whether the version is stale.
  let sentBody = null;
  let sentStatus = null;
  second.page.on('response', async (r) => {
    if (r.request().method() === 'PATCH' && r.url().includes('/cases/')) {
      sentStatus = r.status();
      sentBody = r.request().postData();
    }
  });
  await second.page.getByTestId('record-passed').click();
  await second.page.waitForTimeout(4000);
  await second.page.waitForSelector('[data-testid="conflict-prompt"]', { timeout: 20000 });
  check('the second tester is stopped rather than silently overwriting', true);

  const conflictOutcome = await second.page.getByTestId('conflict-outcome').textContent();
  check(
    'the conflict shows the other result before offering to overwrite',
    conflictOutcome?.trim() === 'failed',
    `other tester recorded "${conflictOutcome?.trim()}"`,
  );

  // Keeping theirs leaves the first write standing.
  await second.page.unroute('**/runs/*');
  await second.page.getByTestId('conflict-keep').click();
  await second.page.waitForTimeout(2500);
  const kept = await second.page.getByTestId('current-outcome').textContent();
  check('choosing to keep theirs preserves the first result', kept?.trim() === 'failed', kept?.trim());

  // ---- Task 9.4: progress reaches the other tester without a manual reload ----
  const progressBefore = await second.page.getByTestId('run-progress').textContent();
  await setup.page.getByTestId('record-passed').click();
  await second.page.waitForFunction(
    (before) =>
      document.querySelector('[data-testid="run-progress"]')?.textContent !== before,
    progressBefore,
    { timeout: 25000 },
  );
  const progressAfter = await second.page.getByTestId('run-progress').textContent();
  check(
    'progress updates for the other tester without a page reload',
    progressBefore !== progressAfter,
    `${progressBefore?.trim()} -> ${progressAfter?.trim()}`,
  );

  await second.page.screenshot({ path: 'e2e/concurrency.png', fullPage: false });
  await second.context.close();
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
