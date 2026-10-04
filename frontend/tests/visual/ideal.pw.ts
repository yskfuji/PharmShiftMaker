import { readFileSync } from 'node:fs';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { audit, explicit, FIXED_NOW, scheme, THEMES, WIDTHS } from './lib/audit';
import { layout } from './lib/layout';

// The ideal UI showcase (/showcase, synthetic data, enabled with IDEAL_SHOWCASE=1 by
// `run.mjs --ideal`). Every screen each role can open, and every non-ready state, at three
// widths and each theme: a baseline image (chromium, light/dark), the optical checks and
// axe-core with the WCAG 2.x A/AA rules. Automated checks find part of the issues only.
const BASE = process.env.VISUAL_APP_URL ?? 'https://127.0.0.1:18531';
const NAV: Record<string, string[]> = {
  ADMIN: ['home', 'schedule', 'plan', 'operations', 'requests', 'people', 'governance', 'settings'],
  LEADER: ['home', 'schedule', 'plan', 'operations', 'requests', 'people'],
  PHARMACIST: ['home', 'schedule', 'requests'],
};
const ROLE_LABEL: Record<string, string> = { ADMIN: 'システム管理者', LEADER: '薬剤部責任者', PHARMACIST: '薬剤師' };
const STATES = ['empty', 'loading', 'failure', 'conflict', 'forbidden'];
const STATE_LABEL: Record<string, string> = { empty: '空', loading: '読込中', failure: '通信失敗', conflict: '版競合', forbidden: '権限なし' };
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function applyTheme(context: BrowserContext, page: Page, theme: string) {
  await context.clearCookies({ name: 'ps-theme' });
  const value = explicit(theme) ?? 'system';
  await context.addCookies([{ name: 'ps-theme', value, url: BASE, secure: true, sameSite: 'Lax' }]);
  await page.emulateMedia({ colorScheme: scheme(theme) });
}

/** axe-core in the page (evaluated through the driver, so the page CSP is not loosened). */
async function axe(page: Page): Promise<string[]> {
  await page.evaluate(AXE);
  const result = await page.evaluate(async (tags) => {
    const run = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe.run;
    return run(document, { runOnly: { type: 'tag', values: tags } });
  }, AXE_TAGS);
  return result.violations.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
}

/** The app shell sends a page without a session to sign-in, so the showcase is viewed signed in. */
async function signIn(page: Page, user = 'admin', password = 'pass-admin') {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('ユーザーID').fill(user);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'サインイン', exact: true }).click();
  // /planning, or the ideal UI's home when the server runs with IDEAL_UI=1.
  await page.waitForURL((u) => u.pathname === (process.env.VISUAL_IDEAL_UI === '1' ? '/workspace/home' : '/planning'));
}

/**
 * Open a showcase page. WebKit in this environment sometimes loses the session mid-run and the
 * app sends the page to sign-in; the showcase is synthetic and sign-in is not what is judged
 * here, so sign in again once and reopen. Every such recovery is recorded as an annotation.
 */
async function gotoSignedIn(page: Page, url: string, user = 'admin', password = 'pass-admin') {
  const onLogin = () => new URL(page.url()).pathname === '/login';
  let lost = false;
  try { await page.goto(url); } catch (error) { if (!String(error).includes('/login')) throw error; lost = true; }
  if (!lost && !onLogin()) return;
  test.info().annotations.push({ type: 'signed-in-again', description: url });
  await signIn(page, user, password);
  await page.goto(url);
  expect(onLogin(), 'the session was lost twice in a row').toBe(false);
}

async function open(page: Page, screen: string, role: string, state = 'ready') {
  await gotoSignedIn(page, `${BASE}/showcase/${screen}`);
  const lab = page.getByRole('complementary', { name: 'ショーケース設定' });
  // The redirect to sign-in can also come after the page has loaded.
  await Promise.race([lab.waitFor({ timeout: 15_000 }), page.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 })]).catch(() => {});
  if (new URL(page.url()).pathname === '/login') await gotoSignedIn(page, `${BASE}/showcase/${screen}`);
  await lab.getByLabel('役割').selectOption({ label: ROLE_LABEL[role] }, { timeout: 15_000 });
  if (state !== 'ready') await lab.getByLabel('状態').selectOption({ label: STATE_LABEL[state] }, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
}

test('every showcase screen of each role passes the optical and axe checks', async ({ page, context }, info) => {
  test.setTimeout(3_600_000);
  await page.clock.setFixedTime(FIXED_NOW);
  const failures: string[] = [];
  await signIn(page);
  for (const theme of THEMES) {
    await applyTheme(context, page, theme);
    for (const [role, screens] of Object.entries(NAV)) {
      for (const screen of screens) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await open(page, screen, role);
          const name = `ideal-showcase-${role.toLowerCase()}-${screen}-${theme}-${width}`;
          const { findings } = await audit(page, info, name, width, theme);
          failures.push(...findings.map((f) => `${name} ${f.check} ${f.selector} "${f.text}" ${f.detail}`));
          failures.push(...(await axe(page)).map((v) => `${name} axe ${v}`));
          failures.push(...(await layout(page)).map((v) => `${name} layout ${v}`));
        }
      }
    }
  }
  expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
});

test('every non-ready state passes the optical and axe checks', async ({ page, context }, info) => {
  test.setTimeout(1_800_000);
  await page.clock.setFixedTime(FIXED_NOW);
  const failures: string[] = [];
  await signIn(page);
  for (const theme of THEMES) {
    await applyTheme(context, page, theme);
    // Firefox may be sent to sign-in (session refresh answered 401 under the fixed test
    // clock) while it resizes, and then never settles; be on a signed-in page first.
    await gotoSignedIn(page, `${BASE}/showcase/home`);
    for (const state of STATES) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await open(page, 'home', 'LEADER', state);
        const name = `ideal-state-${state}-${theme}-${width}`;
        const { findings } = await audit(page, info, name, width, theme);
        failures.push(...findings.map((f) => `${name} ${f.check} ${f.selector} "${f.text}" ${f.detail}`));
        failures.push(...(await axe(page)).map((v) => `${name} axe ${v}`));
        failures.push(...(await layout(page)).map((v) => `${name} layout ${v}`));
      }
    }
  }
  expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
});

// The API-backed preview (/preview, IDEAL_PREVIEW=1), read-only, as each role of the synthetic API.
const USERS: [string, string][] = [['admin', 'pass-admin'], ['leader', 'pass-lead'], ['pharmacist', 'pass-ph']];

// The screens each role is offered (toModel.ts API_NAV); each is read and changed through the API.
const SCREENS_OF: Record<string, string[]> = {
  admin: ['home', 'schedule', 'plan', 'operations', 'requests', 'people', 'governance', 'settings'],
  leader: ['home', 'schedule', 'plan', 'operations', 'requests', 'settings'],
  pharmacist: ['home', 'schedule', 'requests', 'settings'],
};

/** A page is audited once its heading is shown and every read on it has finished. */
async function settled(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

test('the API preview of each role passes the checks and a pharmacist sees only their own duties', async ({ page, context }, info) => {
  test.setTimeout(1_800_000);
  await page.clock.setFixedTime(FIXED_NOW);
  const failures: string[] = [];
  for (const [user, password] of USERS) {
    await context.clearCookies();
    await signIn(page, user, password);
    for (const theme of THEMES) {
      await applyTheme(context, page, theme);
      for (const screen of SCREENS_OF[user]) {
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await gotoSignedIn(page, `${BASE}/preview/${screen}`, user, password);
          await settled(page);
          await expect(page.getByRole('complementary', { name: 'ショーケース設定' })).toHaveCount(0);
          // Counter-check for the pharmacist assertion below: planners do see Person 0.
          if (screen === 'schedule' && user !== 'pharmacist' && width === 1440) await expect(page.locator('main')).toContainText('Person 0');
          if (screen === 'schedule' && user === 'pharmacist' && width === 1440) {
            const rows = page.getByRole('region', { name: '週間勤務表' }).locator('.ideal-schedule-grid__row');
            const count = await rows.count();
            expect(count, 'a pharmacist sees at most their own row').toBeLessThanOrEqual(1);
            if (count === 1) await expect(rows.first()).toContainText('あなた');
            // The synthetic publication holds only Person 0 (p0); the pharmacist is p1. The
            // other person's name must not reach the page, and the empty week is said in words.
            await expect(page.locator('main')).not.toContainText('Person 0');
            if (count === 0) await expect(page.getByRole('region', { name: '週間勤務表' })).toContainText('あなたの公開済みの勤務はありません');
          }
          const name = `ideal-preview-${user}-${screen}-${theme}-${width}`;
          const { findings } = await audit(page, info, name, width, theme);
          failures.push(...findings.map((f) => `${name} ${f.check} ${f.selector} "${f.text}" ${f.detail}`));
          failures.push(...(await axe(page)).map((v) => `${name} axe ${v}`));
          failures.push(...(await layout(page)).map((v) => `${name} layout ${v}`));
        }
      }
    }
  }
  expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
});

// The production entry (/workspace, IDEAL_UI=1 via run.mjs --ideal-ui): the same screens with
// one URL each and native links carrying the scope. The v3 primary navigation deliberately
// omits the classic-screen escape hatch; compatibility URLs remain available directly.
test('the production entry of each screen passes the checks (IDEAL_UI=1)', async ({ page, context }, info) => {
  test.setTimeout(1_800_000);
  await page.clock.setFixedTime(FIXED_NOW);
  const failures: string[] = [];
  if (process.env.VISUAL_IDEAL_UI !== '1') {
    // Off: the entry does not exist.
    await signIn(page);
    const missing = await page.goto(`${BASE}/workspace/home`);
    expect(missing?.status()).toBe(404);
    return;
  }
  await context.clearCookies();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('ユーザーID').fill('admin');
  await page.getByLabel('パスワード').fill('pass-admin');
  await page.getByRole('button', { name: 'サインイン', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/workspace/home');
  for (const theme of THEMES) {
    await applyTheme(context, page, theme);
    for (const screen of SCREENS_OF.admin) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await gotoSignedIn(page, `${BASE}/workspace/${screen}`);
        await settled(page);
        await expect(page.getByText('従来の画面へ', { exact: true })).toHaveCount(0);
        const name = `ideal-workspace-admin-${screen}-${theme}-${width}`;
        const { findings } = await audit(page, info, name, width, theme);
        failures.push(...findings.map((f) => `${name} ${f.check} ${f.selector} "${f.text}" ${f.detail}`));
        failures.push(...(await axe(page)).map((v) => `${name} axe ${v}`));
        failures.push(...(await layout(page)).map((v) => `${name} layout ${v}`));
      }
    }
  }
  expect(failures, failures.slice(0, 40).join('\n')).toEqual([]);
});
