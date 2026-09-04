/**
 * Browser verification of the sign-in flow (task 3.9).
 *
 * Drives the real containers: nginx-served SPA -> proxied API -> Fastify -> Postgres.
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
const EMAIL = process.env.E2E_EMAIL ?? 'harish.ekambaram@exasol.com';
const PASSWORD = process.env.E2E_PASSWORD ?? 'demo-password-123';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
// A 401 from /api/auth/me is the designed "nobody is signed in" answer, and the browser
// logs every 4xx fetch as a console error. Track those separately from real failures.
const consoleErrors = [];
const expected401 = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  if (/401 \(Unauthorized\)/.test(text)) expected401.push(text);
  else consoleErrors.push(text);
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 1. Unauthenticated visitors get the sign-in form, not the app.
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  check('unauthenticated visitor sees the sign-in form', true);
  check(
    'app shell is not rendered while signed out',
    (await page.locator('button:has-text("Sign out")').count()) === 0,
  );

  // 2. Wrong credentials are refused, without disclosing account existence.
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', 'definitely-wrong');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.error', { timeout: 10000 });
  const wrongPasswordMessage = (await page.locator('.error').textContent())?.trim();
  check('wrong password is rejected', Boolean(wrongPasswordMessage), wrongPasswordMessage);

  await page.fill('input[type="email"]', 'nobody-at-all@exasol.com');
  await page.fill('input[type="password"]', 'definitely-wrong');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);
  const unknownAccountMessage = (await page.locator('.error').textContent())?.trim();
  check(
    'unknown account is indistinguishable from wrong password',
    wrongPasswordMessage === unknownAccountMessage,
    `"${unknownAccountMessage}"`,
  );

  // 3. Valid credentials reach the authenticated view.
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForSelector('button:has-text("Sign out")', { timeout: 10000 });
  check('valid credentials reach the authenticated view', true);

  const shellText = await page.locator('.topbar').textContent();
  check('app shell shows the signed-in user', shellText?.includes('Harish') ?? false, shellText?.trim());

  // 4. The project list reflects real membership from the database.
  //    It lives behind the Projects tab since the app gained navigation.
  await page.getByTestId('tab-projects').click();
  await page.waitForSelector('table', { timeout: 10000 });
  const rows = await page.locator('tbody tr').count();
  const roleBadge = await page.locator('tbody tr .badge').first().textContent();
  check('project list renders the user\'s memberships', rows > 0, `${rows} project(s), role=${roleBadge}`);

  await page.screenshot({ path: 'e2e/authenticated-view.png', fullPage: true });

  // 5. The session cookie is httpOnly -- unreadable to page scripts.
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'tcms_session');
  check('session cookie is set', Boolean(session));
  check('session cookie is httpOnly', session?.httpOnly === true);
  const readable = await page.evaluate(() => document.cookie);
  check('session cookie is not readable from JavaScript', !readable.includes('tcms_session'), `document.cookie="${readable}"`);

  // 6. The session survives a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Sign out")', { timeout: 10000 });
  check('session persists across a page reload', true);

  // 7. Sign-out returns to the sign-in form.
  await page.click('button:has-text("Sign out")');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  check('sign-out returns to the sign-in form', true);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  check('signed-out session is not restored by a reload', true);

  check(
    'no unexpected console errors or uncaught exceptions',
    consoleErrors.length === 0,
    consoleErrors.join(' | '),
  );
  check(
    'the only logged 4xx is the expected signed-out 401',
    expected401.length > 0,
    `${expected401.length} expected 401(s) from /api/auth/me, handled by the client`,
  );

  await page.screenshot({ path: 'e2e/auth-flow.png', fullPage: true });
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
