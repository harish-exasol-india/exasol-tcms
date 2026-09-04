/** Browser verification of the automation binding report (task 6.10). */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'harish.ekambaram@exasol.com');
  await page.fill('input[type="password"]', 'demo-password-123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="tab-automation"]', { timeout: 15000 });

  await page.getByTestId('tab-automation').click();
  await page.waitForSelector('[data-testid="bindings-table"]', { timeout: 15000 });

  const stats = await page.$$eval('.stat', (els) =>
    els.map((e) => ({
      label: e.querySelector('.stat-label')?.textContent ?? '',
      value: Number((e.querySelector('.stat-value')?.textContent ?? '0').replace(/,/g, '')),
    })),
  );
  const stat = (needle) => stats.find((s) => s.label.toLowerCase().includes(needle));
  check('binding summary renders', stats.length >= 4, stats.map((s) => `${s.label}=${s.value}`).join(', '));

  const total = stat('bindings')?.value ?? 0;
  const byId = stat('case id')?.value ?? 0;
  const byName = stat('name')?.value ?? 0;
  check('total bindings reported', total > 0, `${total}`);
  check('identifier and name bindings sum to the total', byId + byName === total, `${byId}+${byName}=${total}`);

  // The whole point of the view: fragile and stale bindings are distinguishable.
  check('name-based bindings are distinguished as fragile', byName > 0, `${byName} fragile`);
  const stale = stat('stale')?.value ?? 0;
  check('staleness is reported with its threshold', stat('stale') !== undefined, stat('stale')?.label);

  const warning = await page.locator('.note').first().textContent();
  check('a warning explains why name bindings are fragile', warning?.includes('renamed'), warning?.trim().slice(0, 80));

  // Truncation must be stated: the table renders a bounded slice of ~100k bindings.
  const shownAll = await page.getByTestId('binding-shown-count').textContent();
  check('the table states how many of the matching bindings it shows', /showing [\d,]+ of [\d,]+/.test(shownAll ?? ''), shownAll?.trim());
  const truncationNotice = await page.locator('[data-testid="binding-truncation"]').count();
  check('truncation is disclosed rather than silent', truncationNotice === 1);

  // Filters -- compare the reported match count, not the rendered row count, which is capped.
  await page.getByTestId('binding-filter-fragile').click();
  await page.waitForTimeout(400);
  const shownFragile = await page.getByTestId('binding-shown-count').textContent();
  const parse = (t) => Number((t ?? '').match(/of ([\d,]+)/)?.[1]?.replace(/,/g, '') ?? -1);
  check('the fragile filter narrows the matching set', parse(shownFragile) < parse(shownAll) && parse(shownFragile) > 0, `${parse(shownAll)} -> ${parse(shownFragile)}`);

  await page.getByTestId('binding-filter-stale').click();
  await page.waitForTimeout(400);
  const staleRows = await page.locator('[data-testid="bindings-table"] tbody tr').count();
  check('the stale filter shows the stale bindings', staleRows > 0 || stale === 0, `${staleRows} rows for ${stale} stale`);

  await page.getByTestId('binding-filter-all').click();
  await page.waitForTimeout(400);

  // Unbound tests
  const hasUnbound = (await page.locator('[data-testid="unbound-table"]').count()) > 0;
  check('tests matching no case are listed separately', hasUnbound);
  if (hasUnbound) {
    const unboundRows = await page.locator('[data-testid="unbound-table"] tbody tr').count();
    check('unbound tests are shown', unboundRows > 0, `${unboundRows} rows`);
  }

  check('no uncaught exceptions', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: 'e2e/automation.png', fullPage: false });
} finally {
  await browser.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
