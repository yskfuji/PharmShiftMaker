import {test, expect, type Page, type BrowserContext} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The ideal UI as the production entry. The runner states the served frontend's IDEAL_UI
// (--ideal-ui); every case checks the server behaves accordingly, so a mismatch fails.
// Off: the entry does not exist and sign-in lands on /planning, exactly as before.
// On: consent setting → absence covered by the pharmacist → consent → approval by a person
// in charge who is not part of the case → a refusal, all in the browser, then the audit
// timeline names no person.
const IDEAL = process.env.IDEAL_UI === '1';
// `developer` is the administrator who is neither of the two people on the schedule: the
// server leaves the final approval to someone who did not record the case and whose duty
// it does not change (`admin` and `leader` are both Person 0). The test server gives that
// account a membership only when a journey asks for it. This spec asks with
// PHARMSHIFT_E2E_INDEPENDENT_APPROVER=1, which adds that membership and nothing else
// (PHARMSHIFT_E2E_DEEP=1 and PHARMSHIFT_E2E_FLEX=1, set for other journeys, add it too).
// Without it, nobody in the fixture may approve a case between Person 0 and the pharmacist,
// and the flag-on chain stops at the approval.
const USERS = {admin: 'pass-admin', leader: 'pass-lead', pharmacist: 'pass-ph', developer: 'pass-dev'} as const;
// The month of the synthetic publication. A workspace URL that names no period shows the
// current month, which has no publication.
const PERIOD = '2026-01';
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

// The synthetic publication holds duties of both people, so a duty is chosen by what its
// option says (whose it is, or when it is), not by its place in the list. Returns when.
async function chooseDuty(duty: ReturnType<Page['locator']>, text: RegExp | string) {
  const option = duty.locator('option').filter({hasText: text}).first();
  await expect(option).toBeAttached({timeout: 15_000});
  await duty.selectOption((await option.getAttribute('value')) ?? '');
  return ((await option.textContent()) ?? '').split(' · ')[1] ?? '';
}

for (const width of [320, 768, 1440]) test(`ideal workspace entry follows IDEAL_UI ${width}`, async ({page, context}) => {
  test.setTimeout(170_000);
  await page.setViewportSize({width, height: 900});
  await signIn(page, context, 'admin');
  // What the workspace's own not-found page offers: its level-1 heading, never the older
  // product's navigation, and exactly these links.
  const notFound = async (path: string, links: string[]) => {
    const missing = await page.goto(path);
    expect(missing?.status(), path).toBe(404);
    await expect(page.getByRole('heading', {level: 1, name: 'ページが見つかりません', exact: true})).toBeVisible();
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    await expect(page.getByRole('navigation', {name: '主な画面'})).toHaveCount(0);
    await expect(page.getByRole('link', {name: '勤務計画・公開へ'})).toHaveCount(0);
    expect(await page.getByRole('main').getByRole('link').evaluateAll((items) => items.map((item) => item.getAttribute('href'))), path).toEqual(links);
  };
  if (!IDEAL) {
    // Off, the workspace does not exist: every address under it is a 404 that leads only
    // to the site's entry.
    await notFound('/workspace/home', ['/']);
    await notFound('/workspace/no-such-screen', ['/']);
    await page.goto('/planning');
    await expect(page.getByRole('link', {name: 'ホーム（新画面）'})).toHaveCount(0);
    return;
  }
  // On, an address that names no screen or no view of the route contract is a 404 in the
  // workspace's own frame, with one way on: the workspace's entry.
  await notFound('/workspace/no-such-screen', ['/workspace/home']);
  await notFound('/workspace/home/no-such-view', ['/workspace/home']);
  // administrator: switch the absence consent setting on
  await page.goto('/workspace/settings/absence-consent');
  let area = await panel(page, '代わりに入る人の同意');
  await evidence(area);
  await area.getByRole('button', {name: '同意を求めるようにする'}).click();
  await expect(area.getByRole('status').filter({hasText: '同意を求めるようにしました。'})).toBeVisible({timeout: 15_000});

  // leader (Person 0): record Person 0's first duty as an absence covered by the pharmacist
  await signIn(page, context, 'leader');
  await page.goto(`/workspace/operations/cases?period=${PERIOD}`);
  area = await panel(page, '欠勤を記録して代わりを決める');
  const when = await chooseDuty(area.getByLabel('勤務'), /^Person 0 · /);
  expect(when).not.toBe('');
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

  // leader: the case is about their own duty and they recorded it, so the final decision is
  // not offered to them; they ask another person in charge
  await signIn(page, context, 'leader');
  await page.goto(`/workspace/operations/cases?period=${PERIOD}`);
  area = await panel(page, '進行中のケース');
  await expect(area.getByRole('button', {name: '別担当へ承認を依頼'})).toBeVisible({timeout: 15_000});
  await expect(area.getByRole('button', {name: '承認して新しい公開版を作る'})).toHaveCount(0);
  await area.getByRole('button', {name: '別担当へ承認を依頼'}).click();
  await evidence(area);
  await area.getByRole('button', {name: '別担当へ承認を依頼'}).click();
  await expect(page.getByRole('status').filter({hasText: '別担当の承認待ちにしました。'})).toBeVisible({timeout: 15_000});

  // the other administrator: approve against the case's publication; a new version is
  // published and the schedule opens on it
  await signIn(page, context, 'developer');
  await page.goto(`/workspace/operations/cases?period=${PERIOD}`);
  area = await panel(page, '進行中のケース');
  await area.getByRole('button', {name: '承認して新しい公開版を作る'}).click();
  await evidence(area);
  await area.getByRole('button', {name: '承認して新しい公開版を作る'}).click();
  await expect(page.getByRole('status').filter({hasText: '承認し、新しい公開版を作成しました。'})).toBeVisible({timeout: 30_000});
  await expect(page.getByRole('region', {name: '表示中の業務コンテキスト'})).toContainText('v2');

  // pharmacist: the duty is theirs now; ask Person 0 to cover it
  await signIn(page, context, 'pharmacist');
  await page.goto(`/workspace/requests/mine?period=${PERIOD}`);
  await page.getByText('新しい欠勤・交換を申請', {exact: true}).click();
  area = await panel(page, '新しい申請');
  await chooseDuty(area.getByLabel('勤務'), when);
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
  for (const kind of ['change.absence.created', 'change.absence.consented', 'change.recommended', 'change.approved', 'change.absence.declined', 'compliance.scope_setting']) {
    await expect(area.getByText(kind).first()).toBeVisible();
  }
  expect(await area.innerText()).not.toMatch(/(?<![A-Za-z0-9_])p[0-9]+(?![A-Za-z0-9_])/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
});
