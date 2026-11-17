import {test, expect, type Page, type BrowserContext} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The ideal UI as the production entry. The runner states the served frontend's IDEAL_UI
// (--ideal-ui); every case checks the server behaves accordingly, so a mismatch fails.
// Off: the entry does not exist and sign-in lands on /planning, exactly as before.
// On: consent setting → absence covered by the pharmacist → consent → approval → a refusal,
// all in the browser, then the audit timeline names no person.
const IDEAL = process.env.IDEAL_UI === '1';
const USERS = {admin: 'pass-admin', leader: 'pass-lead', pharmacist: 'pass-ph'} as const;
const REASON = '合成の受入試験';
const REFERENCE = 'E2E-IDEAL-1';

async function signIn(page: Page, context: BrowserContext, user: keyof typeof USERS) {
  await context.clearCookies();
  await page.goto('/login');
  await page.getByLabel('ユーザーID').fill(user);
  await page.getByLabel('パスワード').fill(USERS[user]);
  await page.getByRole('button', {name: 'サインイン', exact: true}).click();
  await page.waitForURL((u) => u.pathname === (IDEAL ? '/workspace/home' : '/planning'));
}

async function evidence(scope: ReturnType<Page['locator']>) {
  await scope.getByLabel(/^理由/).fill(REASON);
  await scope.getByLabel(/^参照/).fill(REFERENCE);
}

async function panel(page: Page, heading: string) {
  const title = page.getByRole('heading', {name: heading, exact: true});
  await expect(title).toBeVisible({timeout: 15_000});
  return page.locator('section', {has: title}).first();
}

for (const width of [320, 768, 1440]) test(`ideal workspace entry follows IDEAL_UI ${width}`, async ({page, context}) => {
  test.setTimeout(170_000);
  await page.setViewportSize({width, height: 900});
  await signIn(page, context, 'admin');
  if (!IDEAL) {
    const missing = await page.goto('/workspace/home');
    expect(missing?.status()).toBe(404);
    await page.goto('/planning');
    await expect(page.getByRole('link', {name: 'ホーム（新画面）'})).toHaveCount(0);
    return;
  }
  // administrator: switch the absence consent setting on
  await page.goto('/workspace/settings/absence-consent');
  let area = await panel(page, '代わりに入る人の同意');
  await evidence(area);
  await area.getByRole('button', {name: '同意を求めるようにする'}).click();
  await expect(area.getByRole('status').filter({hasText: '同意を求めるようにしました。'})).toBeVisible({timeout: 15_000});

  // leader (Person 0): record Person 0's first duty as an absence covered by the pharmacist
  await signIn(page, context, 'leader');
  await page.goto('/workspace/operations/cases');
  area = await panel(page, '欠勤を記録して代わりを決める');
  const duty = area.getByLabel('勤務');
  await duty.selectOption({index: 1});
  const cover = area.getByRole('radio', {name: /合成職員・長い氏名/}).first();
  await expect(cover).toBeVisible({timeout: 15_000});
  await cover.check();
  await evidence(area);
  await area.getByRole('button', {name: '申請する'}).click();
  await expect(area.getByRole('status').filter({hasText: '同意を求めた人の返事を待っています'})).toBeVisible({timeout: 15_000});

  // pharmacist: consent from home
  await signIn(page, context, 'pharmacist');
  area = await panel(page, '同意が必要な勤務');
  await area.getByRole('button', {name: '同意する'}).click();
  await evidence(area);
  await area.getByRole('button', {name: '同意する'}).click();
  await expect(page.getByRole('status').filter({hasText: '同意しました。'})).toBeVisible({timeout: 15_000});

  // leader: approve against the publication on screen; a new version is published
  await signIn(page, context, 'leader');
  await page.goto('/workspace/operations/cases');
  area = await panel(page, '進行中のケース');
  await area.getByRole('button', {name: '承認して新しい公開版を作る'}).click();
  await evidence(area);
  await area.getByRole('button', {name: '承認して新しい公開版を作る'}).click();
  await expect(page.getByRole('status').filter({hasText: '承認し、新しい公開版を作成しました。'})).toBeVisible({timeout: 30_000});

  // pharmacist: the duty is theirs now; ask Person 0 to cover it
  await signIn(page, context, 'pharmacist');
  await page.goto('/workspace/requests/mine');
  await page.getByText('新しい欠勤・交換を申請', {exact: true}).click();
  area = await panel(page, '新しい申請');
  await area.getByLabel('勤務').selectOption({index: 1});
  const back = area.getByRole('radio', {name: /Person 0/}).first();
  await expect(back).toBeVisible({timeout: 15_000});
  await back.check();
  await evidence(area);
  await area.getByRole('button', {name: '申請する'}).click();
  await expect(area.getByRole('status').filter({hasText: '同意を求めた人の返事を待っています'})).toBeVisible({timeout: 15_000});

  // leader (Person 0): refuse from home
  await signIn(page, context, 'leader');
  area = await panel(page, '同意が必要な勤務');
  await area.getByRole('button', {name: '同意しない'}).click();
  await evidence(area);
  await area.getByRole('button', {name: '同意しない'}).click();
  await expect(page.getByRole('status').filter({hasText: '同意しないことを記録しました'})).toBeVisible({timeout: 15_000});

  // administrator: the audit timeline records every step and names nobody
  await signIn(page, context, 'admin');
  await page.goto('/workspace/governance/audit');
  area = await panel(page, '監査タイムライン');
  for (const kind of ['change.absence.created', 'change.absence.consented', 'change.approved', 'change.absence.declined', 'compliance.scope_setting']) {
    await expect(area.getByText(kind).first()).toBeVisible();
  }
  expect(await area.innerText()).not.toMatch(/(?<![A-Za-z0-9_])p[0-9]+(?![A-Za-z0-9_])/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
});
