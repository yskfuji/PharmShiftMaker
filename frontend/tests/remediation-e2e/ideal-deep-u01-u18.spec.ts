import {expect, test, type Page, type TestInfo} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {allOptical, textSpacing} from '../visual/lib/optical';

const API = process.env.PHARMSHIFT_E2E_API_URL ?? 'https://127.0.0.1:18540';
const QUERY = '?scope_id=hospital%2Fpharmacy';
const WIDTHS = [320, 768, 1440] as const;
const USERS = {
  admin: {user: 'admin', password: 'pass-admin'},
  leader: {user: 'leader', password: 'pass-lead'},
  pharmacist: {user: 'pharmacist', password: 'pass-ph'},
  reviewer: {user: 'developer', password: 'pass-dev'},
} as const;

async function signIn(page: Page, who: keyof typeof USERS) {
  const account = USERS[who];
  await page.goto('/login');
  await page.getByLabel('ユーザーID').fill(account.user);
  await page.getByLabel('パスワード').fill(account.password);
  await page.getByRole('button', {name: 'サインイン', exact: true}).click();
  await page.waitForURL((url) => url.pathname === '/workspace/home');
}

async function signOut(page: Page) {
  const menu = page.locator('summary[aria-label="利用者メニュー"]:visible').first();
  if (await menu.isVisible()) await menu.click();
  const logout = page.waitForRequest(
    (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/auth/logout',
  );
  await page.getByRole('button', {name: 'サインアウト', exact: true}).click();
  await logout;
  // A document replacement can make Playwright miss the response event even
  // though logout completed. Verify the durable outcomes instead: the browser
  // returned to the login page and the shared session cookie no longer
  // authenticates an independent request.
  await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
  await expect(page.getByLabel('ユーザーID')).toBeVisible();
  expect((await page.request.get(`${API}/auth/me`)).status()).toBe(401);
}

async function openWorkspace(page: Page, route: string, heading: string) {
  const response = await page.goto(route);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', {level: 1, name: heading, exact: true})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText: /権限|読み込めません/})).toHaveCount(0);
}

async function fillEvidence(scope: ReturnType<Page['locator']>, suffix = '') {
  const reason = scope.getByLabel(/^理由/);
  const reference = scope.getByLabel(/^参照/);
  const reasonValue = `合成受入試験${suffix}`;
  const referenceValue = `SYNTHETIC${suffix || '-E2E'}`;
  // Exercise the same keyboard event sequence as a user. WebKit can complete a
  // one-shot DOM value replacement before React commits the controlled value,
  // which makes fill() a poor model for these newly opened confirmation forms.
  // A 1 ms stream is faster than ordinary input and can drop a multibyte
  // character under load. Keep one deliberate sequence and move focus after
  // each field so the controlled value is committed before the next action.
  await reason.pressSequentially(reasonValue, {delay: 15});
  await expect(reason).toHaveValue(reasonValue);
  await reason.press('Tab');
  await reference.pressSequentially(referenceValue, {delay: 15});
  await expect(reference).toHaveValue(referenceValue);
  await reference.press('Tab');
  await expect(reason).toHaveValue(reasonValue);
}

function sectionWithHeading(page: Page, name: string) {
  return page.locator('section', {has: page.getByRole('heading', {name, exact: true})}).first();
}

async function finishAudit(page: Page, info: TestInfo, id: string, width: number) {
  const layout = await page.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth, userAgent: navigator.userAgent}));
  expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
  const expectedEngine = {chromium: /Chrome\//, firefox: /Firefox\//, webkit: /AppleWebKit\/(?!.*Chrome\/)/}[info.project.name];
  expect(layout.userAgent).toMatch(expectedEngine);
  const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await info.attach(`${id}-axe`, {body: JSON.stringify(axe), contentType: 'application/json'});
  expect(axe.violations, id).toEqual([]);
  const optical = await allOptical(page, width);
  if (width === 320 || width === 1440) {
    const spacing = await textSpacing(page);
    optical.findings.push(...spacing.findings);
    optical.skipped.push(...spacing.skipped);
  }
  await info.attach(`${id}-optical`, {body: JSON.stringify(optical), contentType: 'application/json'});
  expect(optical.findings, `${id}: optical findings`).toEqual([]);
  expect(optical.skipped, `${id}: unmeasured optical checks`).toEqual([]);
  await page.screenshot({path: info.outputPath(`${id}-${width}.png`), fullPage: true});
}

function matrix(name: string, run: (page: Page, info: TestInfo, width: number) => Promise<void>) {
  for (const width of WIDTHS) test(`${name} ${width}`, async ({page}, info) => {
    test.setTimeout(Number(process.env.E2E_TEST_TIMEOUT_MS ?? "180000"));
    await page.setViewportSize({width, height: 900});
    await run(page, info, width);
    await finishAudit(page, info, name, width);
  });
}

async function openNewRequest(page: Page, mode: 'mine' | 'swap' = 'mine') {
  await openWorkspace(page, `/workspace/requests/${mode}?period=2026-01`, '申請');
  const summary = page.getByText(mode === 'swap' ? '新しい勤務交換を依頼' : '新しい欠勤・交換を申請', {exact: true});
  await summary.click();
  return page.locator('section', {has: page.getByRole('heading', {name: '新しい申請', exact: true})});
}

async function submitAbsenceWithoutReplacement(page: Page) {
  const form = await openNewRequest(page);
  await form.getByLabel('勤務').selectOption({index: 1});
  const noReplacement = form.getByRole('radio', {name: /代わりを指定しない/});
  // WebKit can observe the controlled radio as checked between click dispatch and
  // Playwright's check() postcondition.  Verify the user-visible final state instead.
  await noReplacement.click();
  await expect(noReplacement).toBeChecked();
  await fillEvidence(form, '-ABSENCE');
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && /\/planning\/change-cases\?/.test(item.url()));
  await form.getByRole('button', {name: '申請する'}).click();
  const created = await response;
  expect(created.status()).toBe(200);
  return created.json() as Promise<{case_id: string; status: string; version: number}>;
}

matrix('ideal-deep-u01-auth-scope', async (page) => {
  await signIn(page, 'admin');
  await expect(page.getByRole('heading', {level: 1, name: '今日'})).toBeVisible();
  await expect(page.locator('.ideal-v3-nav').first()).toContainText('職員');
  const scopes = await page.request.get(`${API}/planning/scopes`);
  expect(scopes.status()).toBe(200);
  expect(await scopes.json()).toEqual(expect.arrayContaining([expect.objectContaining({scope_id: 'hospital/pharmacy', role: 'ADMIN'})]));
  await page.goto('/workspace/home?scope=other%2Fward');
  await expect(page.getByRole('alert', {name: 'この画面は表示できません'})).toContainText('指定された施設・部署の所属がありません');
  await page.goto('/workspace/home?scope=hospital%2Fpharmacy');
  await expect(page.getByRole('heading', {level: 1, name: '今日'})).toBeVisible();
});

matrix('ideal-deep-u02-personal-schedule', async (page) => {
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/schedule?period=2026-01', '勤務表');
  const print = page.getByRole('link', {name: '自分の予定を印刷'});
  const calendar = page.getByRole('link', {name: /カレンダーに追加/});
  await expect(print).toBeVisible(); await expect(calendar).toBeVisible();
  const printResponse = await page.request.get((await print.getAttribute('href'))!);
  const calendarResponse = await page.request.get((await calendar.getAttribute('href'))!);
  expect(printResponse.status()).toBe(200); expect(calendarResponse.status()).toBe(200);
  const html = await printResponse.text(); const ical = await calendarResponse.text();
  expect(html).toContain('自分の勤務表'); expect(ical).toContain('BEGIN:VCALENDAR');
  expect(html).not.toContain('Person 0'); expect(ical).not.toContain('Person 0');
});

matrix('ideal-deep-u03-plan-publish', async (page) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/plan/input?period=2026-01', '計画');
  const refresh = page.getByRole('button', {name: '申請・実績を計画に反映'});
  await refresh.click();
  await expect(page.getByRole('status')).toContainText('最新の申請・実績を反映した入力版を作りました');
  await openWorkspace(page, '/workspace/plan/generate?period=2026-01', '計画');
  await page.getByRole('button', {name: '3つの案を作る'}).click();
  const compare = page.getByRole('link', {name: /3案を同じ定義で比較/});
  await expect(compare).toBeVisible({timeout: 40_000});
  await compare.click();
  const figures = page.getByRole('region', {name: '案ごとの数値'});
  await expect(figures).toBeVisible();
  const usable = figures.locator('input[type="radio"]:not(:disabled)');
  await usable.first().check();
  await page.getByRole('link', {name: /選んだ案を確認・編集/}).click();
  await page.getByRole('button', {name: 'サーバーで再検証'}).click();
  await expect(page.getByText(/サーバー検証を通過/)).toBeVisible({timeout: 20_000});
  const published = page.waitForResponse((item) => item.request().method() === 'POST' && /\/planning\/drafts\/[^/]+\/publish\?/.test(item.url()));
  await page.getByRole('button', {name: '確認した案を公開'}).click();
  expect((await published).status()).toBe(200);
  await page.waitForURL((url) => url.pathname === '/workspace/schedule' && Boolean(url.searchParams.get('publication')));
  await expect(page.getByText(/計画を新しい公開版として公開しました/)).toBeVisible();
});

matrix('ideal-deep-u04-stale-input', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/plan/input', '計画');
  await page.getByText('必要配置・資格要件を確認・編集', {exact: true}).click();
  const form = page.getByRole('region', {name: '必要配置の専用操作'});
  await form.getByLabel('編集する対象').selectOption('new');
  await form.getByRole('combobox', {name: '配置する業務', exact: true}).selectOption({index: 1});
  await form.getByRole('combobox', {name: '配置する場所', exact: true}).selectOption({index: 1});
  await form.getByLabel('必須の配置人数').fill('1'); await form.getByLabel('希望する配置人数').fill('1');
  await form.getByLabel('適用開始（日本時間）').fill('2026-01-05T09:00'); await form.getByLabel('適用終了（日本時間）').fill('2026-01-05T17:00');
  const sourceReference = form.getByLabel('原本確認の資料名・参照先');
  const sourceReferenceValue = `SYNTHETIC-U04-${info.project.name}-${width}`;
  await sourceReference.pressSequentially(sourceReferenceValue, {delay: 1});
  await expect(sourceReference).toHaveValue(sourceReferenceValue);
  await form.getByLabel('原本確認の状態').selectOption('verified');
  await expect(sourceReference).toHaveValue(sourceReferenceValue);
  const reviewer = form.getByLabel('原本確認の確認責任者');
  await expect(reviewer).toBeVisible();
  await reviewer.pressSequentially('synthetic-reviewer', {delay: 1});
  // WebKit can finish the controlled-field commit after fill() resolves. Moving
  // focus models the user's completed edit and prevents an unrealistically
  // same-tick submit from racing that commit.
  await reviewer.press('Tab');
  await expect(reviewer).toHaveValue('synthetic-reviewer');
  await expect(sourceReference).toHaveValue(sourceReferenceValue);
  const stored = page.waitForResponse((item) => item.request().method() === 'POST' && /\/planning\/compliance\/records\/demand\?/.test(item.url()));
  await form.getByRole('button', {name: 'この内容を保存・再送'}).click();
  expect((await stored).status()).toBe(200);
  await expect(form.getByText(/記録を保存して再取得しました/)).toBeVisible();
  await expect(page.getByText('再導出が必要', {exact: true})).toBeVisible();
  const derive = page.getByRole('heading', {name: '契約・資格から勤務候補を再導出'}).locator('..');
  await fillEvidence(derive, '-REDERIVE');
  await derive.getByRole('button', {name: '新しい入力版を作る'}).click();
  await expect(derive.getByRole('status')).toContainText('新しい不変の入力版');
  await expect(page.getByText('前提は最新', {exact: true})).toBeVisible();
});

matrix('ideal-deep-u05-absence', async (page) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/operations/cases?period=2026-01', '当日運用');
  const form = sectionWithHeading(page, '欠勤を記録して代わりを決める');
  await form.getByLabel('勤務').selectOption({index: 1});
  const replacement = form.locator('.ideal-option').filter({hasText: '検証を通過'}).first().getByRole('radio');
  await replacement.check();
  await fillEvidence(form, '-ABSENCE-COVER');
  const createdResponse = page.waitForResponse((item) => item.request().method() === 'POST' && /\/planning\/change-cases\?/.test(item.url()));
  await form.getByRole('button', {name: '申請する'}).click();
  const created = await (await createdResponse).json();
  expect(created.status).toBe('READY');
  await openWorkspace(page, `/workspace/operations/cases?case=${created.case_id}`, '当日運用');
  const detail = page.locator('.ideal-v3-detail');
  await detail.getByRole('button', {name: '別担当へ承認を依頼'}).click(); await fillEvidence(detail, '-RECOMMEND'); await detail.getByRole('button', {name: '別担当へ承認を依頼'}).click();
  await expect(page.getByText('別担当の承認待ちにしました。', {exact: true})).toBeVisible();
  await signOut(page); await signIn(page, 'reviewer');
  await openWorkspace(page, `/workspace/operations/cases?period=2026-01&case=${created.case_id}`, '当日運用');
  const decision = page.locator('.ideal-v3-detail');
  await decision.getByRole('button', {name: '承認して新しい公開版を作る'}).click(); await fillEvidence(decision, '-APPROVE'); await decision.getByRole('button', {name: '承認して新しい公開版を作る'}).click();
  await page.waitForURL((url) => url.pathname === '/workspace/schedule' && Boolean(url.searchParams.get('publication')));
  await expect(page.getByText(/新しい公開版を作成しました/)).toBeVisible();
});

matrix('ideal-deep-u06-swap', async (page) => {
  await signIn(page, 'pharmacist');
  const form = await openNewRequest(page, 'swap');
  await fillEvidence(form, '-SWAP');
  await form.getByLabel('勤務').selectOption({index: 1});
  const counterpart = form.getByRole('radio', {name: /Person 0/}).first();
  await counterpart.check(); await expect(counterpart).toBeChecked();
  await expect(form.getByRole('button', {name: '申請する'})).toBeEnabled();
  const response = page.waitForResponse((item) => item.request().method() === 'POST' && /\/planning\/change-cases\?/.test(item.url()));
  await form.getByRole('button', {name: '申請する'}).click();
  const created = await (await response).json(); expect(created.status).toBe('AWAITING_CONSENT');
  const requesterConsent = sectionWithHeading(page, '申請中・同意の依頼');
  await requesterConsent.getByRole('button', {name: '同意する'}).click(); await fillEvidence(requesterConsent, '-REQUESTER'); await requesterConsent.getByRole('button', {name: '同意する'}).click();
  await expect(page.getByText('同意しました。', {exact: true})).toBeVisible();
  await signOut(page); await signIn(page, 'leader');
  const consent = sectionWithHeading(page, '同意が必要な勤務');
  await consent.getByRole('button', {name: '同意する'}).click(); await fillEvidence(consent, '-CONSENT'); await consent.getByRole('button', {name: '同意する'}).click();
  await expect(page.getByText('同意しました。', {exact: true})).toBeVisible();
  await openWorkspace(page, `/workspace/operations/cases?period=2026-01&case=${created.case_id}`, '当日運用');
  const recommendation = page.locator('.ideal-v3-detail');
  await recommendation.getByRole('button', {name: '別担当へ承認を依頼'}).click(); await fillEvidence(recommendation, '-RECOMMEND'); await recommendation.getByRole('button', {name: '別担当へ承認を依頼'}).click();
  await expect(page.getByText('別担当の承認待ちにしました。', {exact: true})).toBeVisible();
  await signOut(page); await signIn(page, 'reviewer');
  await openWorkspace(page, `/workspace/operations/cases?period=2026-01&case=${created.case_id}`, '当日運用');
  const decision = page.locator('.ideal-v3-detail');
  await decision.getByRole('button', {name: '承認して新しい公開版を作る'}).click(); await fillEvidence(decision, '-INDEPENDENT'); await decision.getByRole('button', {name: '承認して新しい公開版を作る'}).click();
  await page.waitForURL((url) => url.pathname === '/workspace/schedule' && Boolean(url.searchParams.get('publication')));
  await expect(page.getByText(/新しい公開版を作成しました/)).toBeVisible();
});

matrix('ideal-deep-u07-withdraw', async (page) => {
  await signIn(page, 'pharmacist');
  const created = await submitAbsenceWithoutReplacement(page);
  await page.goto(`/workspace/requests/mine?case=${created.case_id}`);
  const detail = page.locator('.ideal-v3-detail');
  await detail.getByRole('button', {name: '取り下げる'}).click(); await fillEvidence(detail, '-WITHDRAW'); await detail.getByRole('button', {name: '取り下げる'}).click();
  await expect(page.getByRole('status')).toContainText('取り下げました');
  const list = await page.request.get(`${API}/planning/change-cases${QUERY}`);
  expect((await list.json()).find((item: {case_id: string}) => item.case_id === created.case_id)?.status).toBe('WITHDRAWN');
});

matrix('ideal-deep-u08-absence-consent', async (page) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/settings/absence-consent', '設定');
  const panel = sectionWithHeading(page, '代わりに入る人の同意');
  await fillEvidence(panel, '-SETTING'); await panel.getByRole('button', {name: '同意を求めるようにする'}).click();
  await expect(panel.getByRole('status')).toContainText('同意を求めるようにしました');
  const history = page.getByRole('region', {name: '切り替えの履歴'});
  await expect(history).toContainText('合成受入試験-SETTING'); await expect(history).toContainText('SYNTHETIC-SETTING');
});

matrix('ideal-deep-u09-membership-link', async (page, info, width) => {
  await signIn(page, 'admin'); await openWorkspace(page, '/workspace/people/directory', '職員');
  await page.getByLabel('職員を検索').fill('合成未紐付け職員');
  const unlinked = page.getByRole('list', {name: '職員一覧'}).getByRole('button', {name: /合成未紐付け職員/});
  await expect(unlinked).toContainText('本人アカウント未紐付け');
  await unlinked.click();
  await expect(page.locator('.ideal-v3-detail')).toContainText('契約');
  await expect(page.locator('.ideal-v3-detail')).toContainText('資格');
  await page.locator('.ideal-v3-detail').getByRole('link', {name: '本人アカウント'}).click();
  await expect(page).toHaveURL(/\/workspace\/people\/memberships\?person=p-unlinked/);
  await page.getByText('本人アカウントを紐付ける', {exact: true}).click();
  const form = page.getByRole('heading', {name: 'アカウントを紐付ける'}).locator('..');
  const subject = `synthetic-u09-${info.project.name}-${width}`;
  await expect(form.getByLabel('職員')).toHaveValue('p-unlinked');
  await form.getByLabel('発行者（issuer）').fill('mock'); await form.getByLabel('アカウント（subject）').fill(subject); await form.getByLabel('役割').selectOption('PHARMACIST');
  await fillEvidence(form, '-LINK'); await form.getByRole('button', {name: '紐付ける'}).click();
  await expect(page.getByRole('region', {name: '紐付けの一覧'})).toContainText(subject);
});

matrix('ideal-deep-u10-membership-deactivate', async (page, info, width) => {
  await signIn(page, 'admin'); await openWorkspace(page, '/workspace/people/memberships', '職員');
  await page.getByText('本人アカウントを紐付ける', {exact: true}).click();
  const form = page.getByRole('heading', {name: 'アカウントを紐付ける'}).locator('..'); const subject = `synthetic-u10-${info.project.name}-${width}`;
  await form.getByLabel('発行者（issuer）').fill('mock'); await form.getByLabel('アカウント（subject）').fill(subject); await form.getByLabel('職員').fill('p1'); await form.getByLabel('役割').selectOption('LEADER'); await fillEvidence(form, '-LINK'); await form.getByRole('button', {name: '紐付ける'}).click();
  const row = page.getByRole('row').filter({hasText: subject}); await row.getByRole('button', {name: '無効にする'}).click(); await fillEvidence(row, '-DEACTIVATE'); await row.getByRole('button', {name: '無効にする'}).click();
  await page.getByRole('checkbox', {name: '無効も表示'}).check(); await expect(page.getByRole('row').filter({hasText: subject})).toContainText('無効');
  await expect(page.getByText('自分自身の所属は無効にできません。別の管理者に依頼してください。').first()).toBeVisible();
});

async function createLifecycle(page: Page, kind: 'ONBOARD' | 'OFFBOARD', suffix: string, personId = 'p1') {
  await openWorkspace(page, '/workspace/people/lifecycle', '職員'); await page.getByText('新しい入職・退職手続きを始める', {exact: true}).click();
  const form = page.getByRole('heading', {name: '手続きを始める'}).locator('..');
  await form.getByLabel('職員ID').fill(personId); await form.getByRole('radio', {name: kind === 'ONBOARD' ? '入職' : '退職'}).check(); await form.getByLabel('発効日').fill(kind === 'ONBOARD' ? '2026-02-01' : '2026-01-31'); await fillEvidence(form, suffix); await form.getByRole('button', {name: '始める'}).click();
  await expect(page.getByRole('status')).toContainText('手続きを始めました');
  return page.locator('.ideal-lifecycle-list article').filter({hasText: kind === 'ONBOARD' ? '入職' : '退職'}).first();
}

matrix('ideal-deep-u11-onboarding', async (page) => {
  await signIn(page, 'admin'); const card = await createLifecycle(page, 'ONBOARD', '-ONBOARD');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
  await expect(card).toContainText('雇用契約の確認'); await expect(card).toContainText('勤務候補の生成'); await expect(card).toContainText('すべて完了');
  const cases = await page.request.get(`${API}/planning/lifecycle-cases${QUERY}`);
  const created = (await cases.json()).find((item: {kind: string; person_id: string}) => item.kind === 'ONBOARD' && item.person_id === 'p1');
  expect(created?.status).toBe('READY');
  expect(created?.tasks).toHaveLength(4);
  expect(created?.tasks.every((task: {status: string; source: string; satisfied_by: string[]}) => task.status === 'COMPLETED' && task.source === 'SYSTEM' && task.satisfied_by.length > 0)).toBe(true);
  await page.goto('/workspace/governance/audit');
  await expect(page.getByRole('region', {name: '監査タイムライン'})).toContainText('記録種別 lifecycle.onboard.created');
});

matrix('ideal-deep-u12-offboarding', async (page) => {
  await signIn(page, 'admin'); const card = await createLifecycle(page, 'OFFBOARD', '-OFFBOARD', 'p-offboard');
  await expect(card).toContainText('契約終了の確認'); await expect(card).toContainText('アカウントの無効化');
  const manual = card.getByRole('button', {name: /確認を記録/}).first();
  await expect(manual).toBeVisible(); await manual.click(); await fillEvidence(card, '-ATTEST'); await card.getByRole('button', {name: '完了にする'}).click(); await expect(card.getByRole('status')).toContainText('完了にしました');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
  await expect(card).toContainText('すべて完了');
  const cases = await page.request.get(`${API}/planning/lifecycle-cases${QUERY}`);
  const created = (await cases.json()).find((item: {kind: string; person_id: string}) => item.kind === 'OFFBOARD' && item.person_id === 'p-offboard');
  expect(created?.status).toBe('READY');
  expect(created?.tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({key: 'contract_end', status: 'COMPLETED', source: 'SYSTEM'}),
    expect.objectContaining({key: 'candidate_exclusion', status: 'COMPLETED', source: 'SYSTEM'}),
    expect.objectContaining({key: 'balance_review', status: 'COMPLETED', source: 'ATTESTATION'}),
    expect.objectContaining({key: 'membership_deactivation', status: 'COMPLETED', source: 'SYSTEM'}),
  ]));
  await page.goto('/workspace/governance/audit');
  const timeline = page.getByRole('region', {name: '監査タイムライン'});
  await expect(timeline).toContainText('記録種別 lifecycle.offboard.created');
  await expect(timeline).toContainText('記録種別 lifecycle.task.completed');
});

matrix('ideal-deep-u13-audit', async (page) => {
  await signIn(page, 'admin'); await openWorkspace(page, '/workspace/settings/absence-consent', '設定');
  const settings = sectionWithHeading(page, '代わりに入る人の同意'); await fillEvidence(settings, '-AUDIT'); await settings.getByRole('button', {name: '同意を求めるようにする'}).click(); await expect(settings.getByRole('status')).toContainText('同意を求めるようにしました');
  await page.goto('/workspace/governance/audit'); const timeline = page.getByRole('region', {name: '監査タイムライン'}); await expect(timeline).toContainText('欠勤同意設定を変更'); await expect(timeline).toContainText('記録種別 compliance.scope_setting');
  const text = await timeline.innerText(); expect(text).not.toMatch(/\bp\d+\b/); expect(text).not.toContain('合成職員・長い氏名');
});

matrix('ideal-deep-u14-failure-retry', async (page) => {
  await signIn(page, 'admin'); await openWorkspace(page, '/workspace/settings/absence-consent', '設定');
  const panel = sectionWithHeading(page, '代わりに入る人の同意'); await fillEvidence(panel, '-RETRY');
  let notificationFailureArmed = false;
  await page.route('**/planning/notifications?*', async (route) => {
    if (notificationFailureArmed) {
      notificationFailureArmed = false;
      await route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({detail: '合成の通知読取り障害'})});
    }
    else await route.continue();
  });
  let attempts = 0; let first = '';
  await page.route('**/scope-settings/absence-consent?*', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      first = route.request().postData() ?? '';
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.abort('failed');
    } else {
      expect(route.request().postData()).toBe(first);
      notificationFailureArmed = true;
      await route.continue();
    }
  });
  await panel.getByRole('button', {name: '同意を求めるようにする'}).click(); await expect(panel.getByRole('alert')).toContainText(/反映されたかは不明|通信/);
  await panel.getByRole('button', {name: '同意を求めるようにする'}).click(); await expect(panel.getByRole('status')).toContainText('同意を求めるようにしました'); expect(attempts).toBe(2);
  await expect(page.getByRole('status').filter({hasText: '一部の情報を更新できませんでした'})).toContainText('通知（503）');
  const conflict = await page.request.post(`${API}/planning/scope-settings/absence-consent${QUERY}`, {headers: {Origin: new URL(page.url()).origin}, data: {enabled: false, expected_version: 0, evidence: {reason: 'stale', reference: 'stale'}, idempotency_key: 'synthetic-stale-u14'}}); expect(conflict.status()).toBe(409);
  const invalid = await page.request.post(`${API}/planning/change-cases${QUERY}`, {headers: {Origin: new URL(page.url()).origin}, data: {}}); expect(invalid.status()).toBe(422);
  await signOut(page);
  const unauthenticated = await page.request.post(`${API}/planning/scope-settings/absence-consent${QUERY}`, {headers: {Origin: new URL(page.url()).origin}, data: {enabled: false, expected_version: 1, evidence: {reason: 'signed-out', reference: 'synthetic'}, idempotency_key: 'synthetic-unauthenticated-u14'}});
  expect(unauthenticated.status()).toBe(401);
  await signIn(page, 'pharmacist'); await page.goto('/workspace/people/memberships'); await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
});

matrix('ideal-deep-u15-monthly-schedule', async (page, _info, width) => {
  await signIn(page, 'admin'); await openWorkspace(page, '/workspace/schedule?period=2026-01', '勤務表');
  await expect(page.getByText(/公開版 v/).first()).toBeVisible(); const filters = page.getByRole('region', {name: '勤務表の表示条件'}); await filters.getByLabel('職員名').fill('Person 0'); await expect(filters.getByRole('status')).toContainText('1名');
  // The responsive contract switches to the agenda through 1180px; assert the
  // representation the user actually receives instead of treating 768px as desktop.
  if (width <= 1180) await expect(page.getByRole('region', {name: '日別勤務予定'})).toBeVisible(); else await expect(page.getByRole('region', {name: '月間勤務表'})).toBeVisible();
  await page.getByText('部署の公開版を出力', {exact: false}).click(); await expect(page.getByRole('region', {name: '公開版の登録済み出力'})).toBeVisible();
});

matrix('ideal-deep-u16-daily-operations', async (page) => {
  await signIn(page, 'pharmacist'); const created = await submitAbsenceWithoutReplacement(page); await signOut(page); await signIn(page, 'leader');
  await openWorkspace(page, '/workspace/operations/today', '当日運用'); await expect(page.getByRole('heading', {name: '予定上の勤務'})).toBeVisible(); await expect(page.getByText('在席・出勤実績ではありません', {exact: true})).toBeVisible();
  const snapshot = await page.request.get(`${API}/planning/daily-operations${QUERY}&day=2026-01-05`); expect(snapshot.status()).toBe(200); expect((await snapshot.json()).open_case_count).toBeGreaterThanOrEqual(1);
  await page.goto(`/workspace/operations/cases?case=${created.case_id}`); await expect(page.locator('.ideal-v3-detail')).toContainText(`ケース版 ${created.version}`);
});

matrix('ideal-deep-u17-role-home', async (page) => {
  await signIn(page, 'admin'); await expect(page.getByRole('heading', {name: '次に判断すること'})).toBeVisible(); await expect(page.getByText('本日の予定勤務')).toBeVisible(); await signOut(page);
  await signIn(page, 'pharmacist'); await expect(page.getByText('次の勤務', {exact: true})).toBeVisible(); await expect(page.getByText(/あなたに同意を求めている申請はありません/)).toBeVisible(); await expect(page.locator('.ideal-v3-nav').first()).not.toContainText('職員');
});

matrix('ideal-deep-u18-settings', async (page) => {
  await signIn(page, 'admin'); await openWorkspace(page, '/workspace/settings/appearance', '設定');
  const appearance = sectionWithHeading(page, '外観と動き');
  await appearance.getByLabel('配色').selectOption('dark'); await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await page.goto('/workspace/settings/notifications'); const read = page.getByRole('button', {name: '確認しました'}).first(); if (await read.isVisible()) { await read.click(); await expect(read).toHaveCount(0); }
  await page.goto('/workspace/settings/absence-consent'); await expect(page.getByText(/切り替えは、切り替えた後に作るケースから適用/)).toBeVisible();
  await page.goto('/workspace/settings/flextime'); await expect(page.getByText(/第一管理者|別の管理者/).first()).toBeVisible();
});
