/**
 * Browser verification of the test repository views (tasks 4.10, 4.11, 4.12) at the
 * design's stated scale of 25,000 cases.
 */
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

  // ---- task 4.10: virtualised list at scale ----
  const listStart = Date.now();
  await page.waitForSelector('[data-testid="case-scroll"]', { timeout: 20000 });
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="case-count"]')?.textContent ?? '').includes('of'),
    null,
    { timeout: 20000 },
  );
  const firstPaint = Date.now() - listStart;
  const countText = await page.getByTestId('case-count').textContent();
  check('case list renders', Boolean(countText), countText?.trim());
  check('first page paints quickly at scale', firstPaint < 8000, `${firstPaint}ms`);

  const totalReported = Number((countText ?? '').match(/of ([\d,]+)/)?.[1]?.replace(/,/g, '') ?? 0);
  // At least the seeded 25,000: other suites (the rehearsal in particular) author cases of
  // their own, so an exact count would fail depending on run order.
  check('reports the full case total', totalReported >= 25000, `${totalReported} cases`);

  // Only a window of rows is in the DOM -- that is the whole point of virtualising.
  const domRows = await page.locator('[data-testid^="case-row-"]').count();
  check(
    'only a viewport window is in the DOM, not all 25,000 rows',
    domRows > 0 && domRows < 120,
    `${domRows} row elements for ${totalReported} cases`,
  );

  // Scroll hard and measure that the list keeps up.
  const scrollStart = Date.now();
  for (const offset of [2000, 6000, 12000, 20000, 4000]) {
    await page.getByTestId('case-scroll').evaluate((el, y) => el.scrollTo(0, y), offset);
    await page.waitForTimeout(120);
  }
  const scrollMs = Date.now() - scrollStart;
  const rowsAfterScroll = await page.locator('[data-testid^="case-row-"]').count();
  check('stays responsive while scrolling', scrollMs < 6000, `${scrollMs}ms for 5 jumps`);
  check('window stays bounded after scrolling', rowsAfterScroll < 120, `${rowsAfterScroll} rows`);

  // ---- filtering ----
  await page.getByTestId('case-scroll').evaluate((el) => el.scrollTo(0, 0));
  await page.getByTestId('case-search').fill('Verify behaviour 12');
  await page.waitForTimeout(1200);
  const filtered = await page.getByTestId('case-count').textContent();
  check('search narrows the list', !filtered?.includes('of 25,000'), filtered?.trim());

  await page.getByTestId('case-search').fill('');
  await page.getByTestId('automation-filter').selectOption('false');
  await page.waitForTimeout(1200);
  const manualOnly = await page.getByTestId('case-count').textContent();
  check('automation filter narrows the list', !manualOnly?.includes('of 25,000'), manualOnly?.trim());
  await page.getByTestId('automation-filter').selectOption('');
  await page.waitForTimeout(800);

  // ---- task 4.11: detail view and editing ----
  // Bulk-generated rows (EXA-10000+) are inserted directly and carry no history by design.
  // Pick a seeded case, which does.
  await page.getByTestId('case-search').fill('EXA-1000');
  await page.waitForTimeout(1200);
  await page.locator('[data-testid^="case-row-"]').first().click();
  await page.waitForSelector('[data-testid="case-detail"]', { timeout: 10000 });
  const title = await page.getByTestId('case-title').textContent();
  check('opens the case detail panel', Boolean(title), title?.trim());
  check('detail shows steps', (await page.locator('ol.steps li').count()) > 0);

  // ---- task 4.12: history is visible ----
  await page.waitForSelector('[data-testid="case-history"] li', { timeout: 10000 });
  const historyEntries = await page.locator('[data-testid="case-history"] li').count();
  check('detail shows change history', historyEntries > 0, `${historyEntries} entr(ies)`);

  // ---- editing round-trip, including tag normalisation preview ----
  await page.getByTestId('edit-case').click();
  // Unique per run: re-applying an identical edit correctly records no history entry,
  // so a fixed title would make this check fail on the second run.
  const editedTitle = `Edited from the browser ${Date.now()}`;
  await page.getByTestId('edit-title').fill(editedTitle);
  await page.getByTestId('edit-priority').selectOption('critical');
  await page.getByTestId('edit-tags').fill('  End-To-End , SMOKE ');
  await page.waitForTimeout(300);
  const preview = await page.getByTestId('tag-preview').textContent();
  check(
    'tag normalisation is previewed before saving',
    preview?.includes('end-to-end') && preview?.includes('smoke'),
    preview?.trim(),
  );

  await page.getByTestId('save-case').click();
  await page.waitForFunction(
    (expected) => document.querySelector('[data-testid="case-title"]')?.textContent === expected,
    editedTitle,
    { timeout: 10000 },
  );
  check('an edit round-trips through the API', true);
  check('priority change persisted', (await page.getByTestId('case-priority').textContent()) === 'critical');
  const savedTags = await page.getByTestId('case-tags').textContent();
  check('tags stored in normalised form', savedTags?.includes('end-to-end'), savedTags?.trim());

  // The history panel refetches after the edit is invalidated; wait for it rather than
  // sampling immediately, which races the refetch.
  await page
    .waitForFunction(
      (before) =>
        document.querySelectorAll('[data-testid="case-history"] li').length > before,
      historyEntries,
      { timeout: 15000 },
    )
    .catch(() => undefined);
  const historyAfter = await page.locator('[data-testid="case-history"] li').count();
  check('the edit appended a history entry', historyAfter > historyEntries, `${historyEntries} -> ${historyAfter}`);

  // Suite tree case counts must be real numbers, not zero for every suite.
  const counts = await page.$$eval('.suite-row .count', (els) =>
    els.map((e) => Number(e.textContent ?? '0')),
  );
  const nonZero = counts.filter((n) => n > 0).length;
  check(
    'suite tree shows real case counts',
    nonZero > 0 && Math.max(...counts) > 100,
    `${nonZero}/${counts.length} suites non-zero, max ${Math.max(...counts)}`,
  );

  check('no uncaught exceptions', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: 'e2e/repository.png', fullPage: false });
} finally {
  await browser.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
