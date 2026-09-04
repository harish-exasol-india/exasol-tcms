/** Browser verification of coverage reporting (task 8.4) at full scale. */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};
const num = async (page, id) =>
  Number((await page.getByTestId(id).textContent())?.replace(/[^\d]/g, '') ?? '0');

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'harish.ekambaram@exasol.com');
  await page.fill('input[type="password"]', 'demo-password-123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="tab-coverage"]', { timeout: 15000 });

  const t0 = Date.now();
  await page.getByTestId('tab-coverage').click();
  await page.waitForSelector('[data-testid="coverage-total"]', { timeout: 30000 });
  const loadMs = Date.now() - t0;
  check('coverage view loads at full scale', loadMs < 5000, `${loadMs}ms`);

  const total = await num(page, 'coverage-total');
  const automated = await num(page, 'coverage-automated');
  const manual = await num(page, 'coverage-manual');
  const never = await num(page, 'coverage-never');
  const percent = await num(page, 'coverage-percent');

  check('reports the managed case total', total > 0, `${total} cases`);
  check(
    'the three buckets sum to the total',
    automated + manual + never === total,
    `${automated}+${manual}+${never}=${total}`,
  );
  check(
    'the percentage matches the automated share',
    percent === Math.round((automated / total) * 100),
    `${percent}% of ${automated}/${total}`,
  );

  const noteText = await page.locator('.note').first().textContent();
  check(
    'the view states what coverage does and does not mean',
    noteText?.includes('automation coverage') && noteText?.includes('no test case at all'),
    noteText?.trim().slice(0, 70),
  );

  // Grouping
  await page.waitForSelector('[data-testid="coverage-groups"]', { timeout: 15000 });
  const groupRows = await page.locator('[data-testid="coverage-groups"] tbody tr').count();
  check('groups by tag', groupRows > 0, `${groupRows} tag groups`);

  const groupTotals = await page.$$eval('[data-testid="coverage-groups"] tbody tr', (rows) =>
    rows.map((r) => {
      const cells = [...r.querySelectorAll('td')].map((c) => c.textContent ?? '');
      return {
        label: cells[0],
        automated: Number((cells[2] ?? '').replace(/[^\d]/g, '')),
        manual: Number((cells[3] ?? '').replace(/[^\d]/g, '')),
        never: Number((cells[4] ?? '').replace(/[^\d]/g, '')),
        total: Number((cells[5] ?? '').replace(/[^\d]/g, '')),
      };
    }),
  );
  check(
    'every group row sums correctly',
    groupTotals.every((g) => g.automated + g.manual + g.never === g.total),
    `${groupTotals.length} rows checked`,
  );
  const untagged = groupTotals.find((g) => g.label?.includes('no tag'));
  check('untagged cases are reported explicitly, not omitted', Boolean(untagged), untagged ? `${untagged.total} untagged` : 'none present');

  await page.getByTestId('coverage-group-suite').click();
  await page.waitForTimeout(1500);
  const suiteRows = await page.locator('[data-testid="coverage-groups"] tbody tr').count();
  check('groups by suite', suiteRows > 0, `${suiteRows} suite groups`);
  await page.getByTestId('coverage-group-tag').click();
  await page.waitForTimeout(1200);

  // Drill-through
  await page.getByTestId('coverage-drill').click();
  await page.waitForSelector('[data-testid="uncovered-table"]', { timeout: 20000 });
  const uncoveredRows = await page.locator('[data-testid="uncovered-table"] tbody tr').count();
  check('drill-through lists cases without automation', uncoveredRows > 0, `${uncoveredRows} rows`);
  const truncated = await page.locator('[data-testid="uncovered-truncation"]').count();
  check('truncation of the drill-through is disclosed', truncated === 1 || manual + never <= 200);

  // Filtering narrows the numbers
  const beforeFilter = total;
  const firstTag = await page.locator('[data-testid^="coverage-tag-"]').first();
  await firstTag.click();
  await page.waitForTimeout(2000);
  const afterFilter = await num(page, 'coverage-total');
  check('a tag filter narrows the scope', afterFilter < beforeFilter && afterFilter > 0, `${beforeFilter} -> ${afterFilter}`);

  check('no uncaught exceptions', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: 'e2e/coverage.png', fullPage: false });
} finally {
  await browser.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
