import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { audit, explicit, FIXED_NOW, scheme, THEMES, WIDTHS } from './lib/audit';

// Every screen of the app with synthetic data (scripts/remediation_test_server.py,
// PHARMSHIFT_E2E_FLEX=1) served for this audit on 127.0.0.1:18531. The theme is set
// the way users set it: the ps-theme cookie, which the server turns into
// <html data-theme> (no cookie for the system themes).
const BASE = process.env.VISUAL_APP_URL ?? 'https://127.0.0.1:18531';
const SCREENS = [
  '/dashboard', '/schedule/2026/1', '/requests', '/settings', '/planning',
  '/planning/workflows/contracts', '/planning/workflows/outside', '/planning/workflows/leave',
  '/planning/workflows/actuals', '/planning/workflows/privacy', '/planning/workflows/recovery',
  '/planning/workflows', '/no-such-page',
];

async function applyTheme(context: BrowserContext, page: Page, theme: string) {
  await context.clearCookies({ name: 'ps-theme' });
  const value = explicit(theme) ?? 'system';
  if (value) await context.addCookies([{ name: 'ps-theme', value, url: BASE, secure: true, sameSite: 'Lax' }]);
  await page.emulateMedia({ colorScheme: scheme(theme) });
}

async function expectServerTheme(page: Page, theme: string) {
  // The server set the attribute from the cookie (explicit themes) or left it off (system).
  const attribute = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(attribute, `data-theme for ${theme}`).toBe(explicit(theme));
}

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('ユーザーID').fill('admin');
  await page.getByLabel('パスワード').fill('pass-admin');
  await page.getByRole('button', { name: 'サインイン', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/planning');
}

test('the sign-in screen passes the optical checks', async ({ page, context }, info) => {
  test.setTimeout(1_800_000);
  await page.clock.setFixedTime(FIXED_NOW);
  const failures: string[] = [];
  for (const theme of THEMES) {
    await applyTheme(context, page, theme);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/login`);
      await expectServerTheme(page, theme);
      const { findings } = await audit(page, info, `app-login-${theme}-${width}`, width, theme);
      failures.push(...findings.map((f) => `/login [${theme} ${width}px] ${f.check} ${f.selector} "${f.text}" ${f.detail}`));
    }
  }
  expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
});

test('every signed-in screen passes the optical checks', async ({ page, context }, info) => {
  test.setTimeout(3_600_000);
  await page.clock.setFixedTime(FIXED_NOW);
  await signIn(page);
  const failures: string[] = [];
  for (const theme of THEMES) {
    await applyTheme(context, page, theme);
    for (const screen of SCREENS) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${BASE}${screen}`);
        await expectServerTheme(page, theme);
        const name = `app${screen.split('/').join('-')}-${theme}-${width}`;
        const { findings } = await audit(page, info, name, width, theme);
        failures.push(...findings.map((f) => `${screen} [${theme} ${width}px] ${f.check} ${f.selector} "${f.text}" ${f.detail}`));
      }
    }
  }
  expect(failures, failures.slice(0, 60).join('\n')).toEqual([]);
});
