/** Browser verification that an administrator can assign and revoke roles (task 3.10). */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
const rows = () => page.locator('[data-testid="members-table"] tbody tr').count();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'harish.ekambaram@exasol.com');
  await page.fill('input[type="password"]', 'demo-password-123');
  await page.click('button[type="submit"]');
  // Membership administration lives on the Projects tab.
  await page.getByTestId('tab-projects').click();
  await page.waitForSelector('[data-testid="member-admin"]', { timeout: 15000 });

  const before = await rows();
  check('members table renders for an administrator', before >= 1, `${before} member(s)`);
  check('admin sees the grant control', (await page.getByTestId('grant').count()) === 1);

  const candidates = await page.getByTestId('add-member-user').locator('option').count();
  check('assignable non-members are offered', candidates > 1, `${candidates - 1} candidate(s)`);

  // Grant
  const userId = await page
    .getByTestId('add-member-user')
    .locator('option')
    .nth(1)
    .getAttribute('value');
  await page.getByTestId('add-member-user').selectOption(userId);
  await page.getByTestId('add-member-role').selectOption('tester');
  await page.getByTestId('grant').click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="members-table"] tbody tr').length === n + 1,
    before,
    { timeout: 10000 },
  );
  check('granting a role adds the member', (await rows()) === before + 1, `${before} -> ${await rows()}`);
  check(
    'the granted role is shown as assigned',
    (await page.getByTestId(`role-${userId}`).inputValue()) === 'tester',
  );

  // Change the role in place
  await page.getByTestId(`role-${userId}`).selectOption('viewer');
  await page.waitForTimeout(1000);
  check('changing a role does not duplicate the member', (await rows()) === before + 1);
  check(
    'the changed role persists',
    (await page.getByTestId(`role-${userId}`).inputValue()) === 'viewer',
  );

  // Revoke
  await page.getByTestId(`revoke-${userId}`).click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="members-table"] tbody tr').length === n,
    before,
    { timeout: 10000 },
  );
  check('revoking a role removes the member', (await rows()) === before, `back to ${before}`);

  await page.screenshot({ path: 'e2e/member-admin.png', fullPage: true });
} finally {
  await browser.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
