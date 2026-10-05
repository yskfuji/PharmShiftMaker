import {expect, test, type Page, type TestInfo} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {allOptical, textSpacing} from '../visual/lib/optical';

const API = process.env.PHARMSHIFT_E2E_API_URL ?? 'https://127.0.0.1:18540';
const SCOPE = 'hospital/pharmacy';
const QUERY = '?scope_id=hospital%2Fpharmacy';
const WIDTHS = [320, 768, 1440] as const;

type Credentials = {user: string; password: string};
const USERS: Record<'admin' | 'leader' | 'developer' | 'pharmacist', Credentials> = {
  admin: {user: 'admin', password: 'pass-admin'},
  leader: {user: 'leader', password: 'pass-lead'},
  developer: {user: 'developer', password: 'pass-dev'},
  pharmacist: {user: 'pharmacist', password: 'pass-ph'},
};

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

async function finishAudit(page: Page, info: TestInfo, id: string, width: number) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    userAgent: navigator.userAgent,
    activeName: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim().slice(0, 80) ?? '',
    bodyWidth: document.body.scrollWidth,
    overflow: [...document.querySelectorAll<HTMLElement>('body *')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {tag: element.tagName.toLowerCase(), className: element.className, label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 60) ?? '', left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width)};
    }).filter((item) => item.width > 0 && (item.left < -1 || item.right > innerWidth + 1)).sort((a, b) => b.right - a.right).slice(0, 12),
    internalOverflow: [...document.querySelectorAll<HTMLElement>('body *')].map((element) => ({tag: element.tagName.toLowerCase(), className: String(element.className), label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 60) ?? '', client: element.clientWidth, scroll: element.scrollWidth, overflowX: getComputedStyle(element).overflowX})).filter((item) => item.scroll > item.client + 1).sort((a, b) => (b.scroll - b.client) - (a.scroll - a.client)).slice(0, 12),
  }));
  expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
  const expectedEngine = {
    chromium: /Chrome\//,
    firefox: /Firefox\//,
    webkit: /AppleWebKit\/(?!.*Chrome\/)/,
  }[info.project.name];
  expect(layout.userAgent, `requested project ${info.project.name}`).toMatch(expectedEngine);
  const axe = await new AxeBuilder({page})
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
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

function matrix(
  name: string,
  run: (page: Page, info: TestInfo, width: number) => Promise<void>,
) {
  for (const width of WIDTHS) {
    test(`${name} ${width}`, async ({page}, info) => {
      test.setTimeout(Number(process.env.E2E_TEST_TIMEOUT_MS ?? "180000"));
      await page.setViewportSize({width, height: 900});
      await run(page, info, width);
      await finishAudit(page, info, name, width);
    });
  }
}

type LeaveRow = {request_id: string; person_id: string; version: number; kind: string; status: string; payload: {start: string; unit?: string; quantity?: number}; decision?: {reference: string; verified_by?: string} | null};
const LEAVE_TASKS = {
  wish: '公休の希望を出す',
  claim: '年次有給休暇を請求する（日・半日・時間）',
  withdraw: '自分の申請を取り下げる',
  event: '年休の予約・取得・取消を記録する',
  grant: '付与日数を訂正する',
  asOf: '過去時点の年休台帳と訂正履歴を照会する',
} as const;

/** Opens one task of "next" and returns the group its fields are in. */
async function openTask(page: Page, summary: string | RegExp) {
  await page.getByText(summary, {exact: true}).click();
  return page.getByRole('group', {name: summary});
}

matrix('ideal-deep-u19-leave', async (page, info, width) => {
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/requests/leave', '申請');
  const origin = new URL(page.url()).origin;
  const surface = page.locator('.ideal-confirm');
  const requestsOf = async () => {
    const response = await page.request.get(`${API}/planning/requests${QUERY}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as LeaveRow[];
  };
  const posted = (path: RegExp) => page.waitForResponse((response) => response.request().method() === 'POST' && path.test(response.url()));
  const jstDay = (row: LeaveRow) => new Date(row.payload.start).toLocaleDateString('ja-JP', {timeZone: 'Asia/Tokyo'});

  // First the state, the next step and the history. No form is open; a pharmacist is
  // offered neither the confirmation of requests nor the ledger tasks.
  for (const name of ['現在の状態', '次の操作', '履歴']) await expect(page.getByRole('heading', {level: 2, name, exact: true})).toBeVisible();
  await expect(page.getByRole('region', {name: '年休残高'})).toContainText('付与日 2026-01-01');
  await expect(page.getByText('進行中のあなたの申請はありません。', {exact: true})).toBeVisible();
  await expect(page.getByLabel('年休付与台帳')).toBeHidden();
  await expect(page.getByText(/^申請を確認する/)).toHaveCount(0);
  await expect(page.getByText(LEAVE_TASKS.grant, {exact: true})).toHaveCount(0);

  // A wish for a day off is recorded and withdrawn again, each after its confirmation.
  const wish = await openTask(page, LEAVE_TASKS.wish);
  await wish.getByLabel('希望する休みの開始（日本時間）').fill('2026-01-09T09:00');
  await wish.getByLabel('希望する休みの終了（日本時間）').fill('2026-01-09T17:00');
  await wish.getByRole('button', {name: '希望の内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '2. 記録前の確認', exact: true})).toBeFocused();
  const wished = posted(/\/planning\/requests\?/);
  await surface.getByRole('button', {name: 'この希望を記録する', exact: true}).click();
  expect((await wished).status()).toBe(201);
  await expect(wish.getByText('公休の希望を第1版として記録しました（確認待ち）。', {exact: true})).toBeVisible();
  const wishRow = (await requestsOf()).find((row) => row.kind === 'PUBLIC_HOLIDAY_REQUEST' && jstDay(row) === '2026/1/9');
  expect(wishRow).toMatchObject({person_id: 'p1', status: 'PENDING', version: 1});
  const withdraw = await openTask(page, LEAVE_TASKS.withdraw);
  await withdraw.getByLabel('取り下げる申請').selectOption(wishRow!.request_id);
  await withdraw.getByRole('button', {name: '取下げの内容を確認する', exact: true}).click();
  await expect(surface).toContainText('状態：確認待ち → 取下げ済み');
  await expect(surface).toContainText('第1版 → 第2版');
  const withdrawn = posted(/\/planning\/requests\/[^/]+\/withdraw\?/);
  await surface.getByRole('button', {name: 'この申請を取り下げる', exact: true}).click();
  expect((await withdrawn).status()).toBe(200);
  await expect(withdraw.getByText('申請を取り下げました（第2版、取下げ済み）。', {exact: true})).toBeVisible();
  expect((await requestsOf()).find((row) => row.request_id === wishRow!.request_id)).toMatchObject({status: 'CANCELLED', version: 2});

  // A day of paid leave is claimed. The synthetic leave rule allows neither half days nor
  // hours, so the day is the only unit offered.
  const claim = await openTask(page, LEAVE_TASKS.claim);
  await claim.getByLabel('年休付与台帳').selectOption('g1');
  await claim.getByLabel('適用する年休規則').selectOption('lp1');
  await expect(claim.getByLabel('請求する単位').getByRole('option')).toHaveText(['日']);
  await claim.getByLabel('休暇開始（日本時間）').fill('2026-01-06T09:00');
  await claim.getByLabel('休暇終了（日本時間）').fill('2026-01-06T17:00');
  await claim.getByLabel('請求内容・根拠の参照').fill('合成本人請求 U19');
  let claims = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && /\/planning\/compliance\/leave-requests\?/.test(request.url())) claims += 1; });
  await claim.getByRole('button', {name: '請求の内容を確認する', exact: true}).click();
  // Nothing is sent before the confirmation, which says the four things.
  await expect(surface.getByRole('heading', {name: '2. 請求前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface).toContainText('休暇の期間（日本時間）：（なし） → 2026-01-06 09:00 〜 2026-01-06 17:00');
  await expect(surface).toContainText('新規登録（第1版を作成）');
  await expect(surface).toContainText('誰にも通知されません。');
  expect(claims).toBe(0);
  // The task with its confirmation is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u19-leave-confirmation', width);
  const claimed = posted(/\/planning\/compliance\/leave-requests\?/);
  await surface.getByRole('button', {name: 'この内容で請求する', exact: true}).click();
  const claimResponse = await claimed;
  expect(claimResponse.status()).toBe(200);
  expect((claimResponse.request().postDataJSON() as {payload: unknown}).payload).toEqual({account_id: 'g1', policy_id: 'lp1', unit: 'day', quantity: 1, interval: {start: '2026-01-06T09:00:00+09:00', end: '2026-01-06T17:00:00+09:00'}, reference: '合成本人請求 U19'});
  await expect(claim.getByText(/年休の請求を第1版として記録しました（確認待ち）。/)).toBeVisible();
  await expect(surface).toHaveCount(0);
  // The list is the server's next read.
  const own = page.getByRole('region', {name: 'あなたの申請（取下げ済みを除く）'});
  await expect(own.getByRole('row').filter({hasText: '2026-01-06 09:00'}).filter({hasText: '確認待ち'})).toHaveCount(1);
  const pending = (await requestsOf()).find((row) => row.kind === 'PAID_LEAVE_V2' && jstDay(row) === '2026/1/6');
  expect(pending).toMatchObject({person_id: 'p1', status: 'PENDING', version: 1});
  // A pharmacist can neither decide a request nor read or change the ledger's records.
  const selfDecision = await page.request.post(`${API}/planning/requests/${pending!.request_id}/decision${QUERY}`, {headers: {Origin: origin}, data: {version: 1, approved: true, reference: 'self', idempotency_key: `u19-self-${info.project.name}-${width}`}});
  expect(selfDecision.status()).toBe(403);
  expect((await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}`)).status()).toBe(403);
  expect((await page.request.get(`${API}/planning/compliance/grant-assessments/context${QUERY}`)).status()).toBe(403);

  // A leader is given the requests to confirm, not the ledger tasks.
  await signOut(page);
  await signIn(page, 'leader');
  await openWorkspace(page, '/workspace/requests/leave', '申請');
  await expect(page.getByText(/^申請を確認する（確認待ち 1件）$/)).toBeVisible();
  await expect(page.getByText(LEAVE_TASKS.grant, {exact: true})).toHaveCount(0);
  expect((await page.request.get(`${API}/planning/compliance/grant-assessments/context${QUERY}`)).status()).toBe(403);

  await signOut(page);
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/requests/leave', '申請');
  const requestEvents = async () => {
    const response = await page.request.get(`${API}/planning/audit-timeline${QUERY}&limit=200`);
    expect(response.status()).toBe(200);
    return ((await response.json()).entries as Array<{kind: string}>).map((entry) => entry.kind);
  };
  const notificationCount = async () => ((await (await page.request.get(`${API}/planning/notifications${QUERY}`)).json()) as unknown[]).length;
  const notificationsBefore = await notificationCount();
  // The ledger's records are read only when one of its tasks is opened.
  let ledgerReads = 0;
  page.on('request', (request) => { if (request.method() === 'GET' && /\/planning\/compliance\/workflow-context\?/.test(request.url())) ledgerReads += 1; });

  // The administrator confirms the claim with the reference the decision rests on.
  await page.getByText('申請を確認する（確認待ち 1件）', {exact: true}).click();
  // The count in the task's name follows the server's next read.
  const review = page.getByRole('group', {name: /^申請を確認する（確認待ち \d+件）$/});
  await review.getByLabel('確認する申請').selectOption(pending!.request_id);
  await review.getByLabel('判断の根拠・相談記録').fill('合成年休台帳と勤務影響を確認');
  await review.getByRole('button', {name: '判断の内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 記録前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('状態：確認待ち → 確認済み');
  await expect(surface).toContainText('判断の記録：（なし） → 合成年休台帳と勤務影響を確認');
  await expect(surface).toContainText('第1版 → 第2版');
  await expect(surface).toContainText('誰にも通知されません。');
  const decided = posted(/\/planning\/requests\/[^/]+\/decision\?/);
  await surface.getByRole('button', {name: 'この判断を記録する', exact: true}).click();
  expect((await decided).status()).toBe(200);
  await expect(review.getByText(/申請を確認済みとして記録しました。/)).toBeVisible();
  const saved = (await requestsOf()).find((row) => row.request_id === pending!.request_id);
  expect(saved, '送信した本人・種別・日本日付の申請がAPIから再取得できる').toMatchObject({person_id: 'p1', kind: 'PAID_LEAVE_V2', status: 'APPROVED', version: 2, decision: {reference: '合成年休台帳と勤務影響を確認', verified_by: 'admin'}});
  await expect(page.getByRole('region', {name: '申請の一覧（現在の版）'}).getByRole('row').filter({hasText: '2026-01-06 09:00'}).filter({hasText: '確認済み'})).toHaveCount(1);

  // The confirmed leave becomes a reservation when it is applied to the planning input.
  await page.getByRole('link', {name: '計画の「前提・取込」', exact: true}).click();
  await page.waitForURL((url) => url.pathname === '/workspace/plan/input');
  await openWorkspace(page, '/workspace/plan/input?period=2026-01', '計画');
  const refreshResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/planning/inputs/refresh?'));
  await page.getByRole('button', {name: '申請・実績を計画に反映'}).click();
  const refreshResponse = await refreshResponsePromise;
  expect(refreshResponse.status(), await refreshResponse.text()).toBe(200);
  await expect(page.getByRole('status')).toContainText('最新の申請・実績を反映した入力版を作りました');
  const latestResponse = await page.request.get(`${API}/planning/inputs/latest${QUERY}`);
  expect(latestResponse.status()).toBe(200);
  const latest = await latestResponse.json();
  expect(latest.snapshot.leave_records).toEqual(expect.arrayContaining([
    expect.objectContaining({account_id: 'g1', policy_id: 'lp1', kind: 'reserve', quantity: 1, unit: 'day'}),
  ]));

  await openWorkspace(page, '/workspace/requests/leave', '申請');
  expect(ledgerReads).toBe(0);
  // Leave actually taken is added to the ledger of the grant, against the grant's revision.
  const event = await openTask(page, LEAVE_TASKS.event);
  await event.getByLabel('対象の付与原本').selectOption('g1');
  await event.getByLabel('対象者・雇用主の取得規則').selectOption('lp1');
  await event.getByLabel('年休イベント').selectOption('take');
  await event.getByLabel('イベントの効力日').fill('2026-01-06');
  await event.getByLabel('対象区間の開始（日本時間）').fill('2026-01-06T09:00');
  await event.getByLabel('対象区間の終了（日本時間）').fill('2026-01-06T17:00');
  await event.getByLabel('原本確認の資料名・参照先').fill('合成勤怠原本 U19');
  await event.getByLabel('原本確認の状態').selectOption('verified');
  await event.getByLabel('原本確認の確認責任者').fill('synthetic-reviewer');
  await event.getByRole('button', {name: '保存内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '2. 保存前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('年休イベント：（なし） → 実際に取得した');
  await expect(surface).toContainText(/付与台帳の版：第\d+版 → 第\d+版/);
  await expect(surface).toContainText('誰にも通知されません。');
  const added = posted(/\/planning\/compliance\/leave-events\?/);
  await surface.getByRole('button', {name: 'このイベントを記録する', exact: true}).click();
  const addedResponse = await added;
  expect(addedResponse.status(), await addedResponse.text()).toBe(200);
  await expect(event.getByText(/年休イベントを記録し、付与台帳は第\d+版になりました。/)).toBeVisible();
  const contextResponse = await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}`);
  expect(contextResponse.status()).toBe(200);
  const context = await contextResponse.json();
  expect(context.leave_records).toEqual(expect.arrayContaining([expect.objectContaining({account_id: 'g1', kind: 'take', quantity: 1, unit: 'day'})]));

  // The days of the grant are corrected from the HR source; the original stays.
  const correction = await openTask(page, LEAVE_TASKS.grant);
  await correction.getByLabel('訂正する原本').selectOption('g1');
  await correction.getByLabel('訂正後の付与日数').fill('4');
  await correction.getByLabel('そのうち法定付与日数').fill('4');
  await correction.getByLabel('訂正を把握した日時（日本時間）').fill('2026-01-07T12:00');
  await correction.getByLabel('訂正理由').fill('合成原本の訂正を通し確認');
  await correction.getByLabel('照合した人事資料の参照').fill('SYNTHETIC-U19-GRANT');
  await correction.getByLabel('根拠の確認者').fill('synthetic-reviewer');
  await correction.getByRole('button', {name: '訂正の内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 記録前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('付与日数：5日 → 4日');
  await expect(surface).toContainText('外部人事の原本改定：第1改定 → 第2改定');
  await expect(surface).toContainText('元の原本は上書きされず、そのまま残ります。');
  const corrected = posted(/\/planning\/compliance\/grant-amendments\?/);
  await surface.getByRole('button', {name: 'この訂正を記録する', exact: true}).click();
  const correctedResponse = await corrected;
  expect(correctedResponse.status(), await correctedResponse.text()).toBe(200);
  await expect(correction.getByText(/訂正を記録しました。/)).toBeVisible();

  // The ledger at a past day and recording cut-off shows the correction the server traced.
  const ledger = await openTask(page, LEAVE_TASKS.asOf);
  await ledger.getByLabel('対象日').fill('2026-01-07');
  await ledger.getByLabel('記録の締切（日本時間）').fill('2026-01-07T13:00');
  await ledger.getByRole('button', {name: '指定時点の台帳を照会', exact: true}).click();
  await expect(ledger.getByRole('list', {name: '指定時点の年休残高'})).toContainText('残高');
  await expect(ledger.getByRole('list', {name: '年休訂正の履歴'})).toContainText('5日 → 4日');

  // Each change is one audit event; nobody was notified of any of them.
  const kinds = await requestEvents();
  for (const kind of ['request.submit', 'request.withdraw', 'leave.request', 'request.decision', 'compliance.leave_record', 'compliance.grant_amendment']) expect(kinds, kind).toContain(kind);
  expect(await notificationCount()).toBe(notificationsBefore);
});

type RosterRow = {kind: string; entity_id: string; revision: number; payload: Record<string, unknown>};
const ROSTER_TASKS = {
  contract: '契約を登録・改定する',
  capability: '資格・監督条件を登録する',
  agreement: '36協定を登録・変更する',
  decision: '改定規則の公開判断を記録する',
} as const;

matrix('ideal-deep-u20-contracts', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/people/contracts', '職員');
  const origin = new URL(page.url()).origin;
  const surface = page.locator('.ideal-confirm');
  const tag = `${info.project.name}-${width}`;
  const recordsOf = async (kind: string) => {
    const response = await page.request.get(`${API}/planning/compliance/records${QUERY}`);
    expect(response.status()).toBe(200);
    return ((await response.json()) as RosterRow[]).filter((row) => row.kind === kind);
  };
  const posted = (kind: string) => page.waitForResponse((response) => response.request().method() === 'POST' && new RegExp(`/planning/compliance/records/${kind}\\?`).test(response.url()));
  // The audit timeline names no record: the events are told apart by kind and version, newest first.
  const rosterEvents = async () => {
    const response = await page.request.get(`${API}/planning/audit-timeline${QUERY}&category=compliance&limit=200`);
    expect(response.status()).toBe(200);
    return (await response.json()).entries as Array<{kind: string; version: number | null; actor_role: string | null}>;
  };
  const notificationCount = async () => ((await (await page.request.get(`${API}/planning/notifications${QUERY}`)).json()) as unknown[]).length;
  const eventsBefore = (await rosterEvents()).length;
  const notificationsBefore = await notificationCount();
  let saves = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && /\/planning\/compliance\/records\//.test(request.url())) saves += 1; });

  // First the state, the next step and the history. No form is open and nobody is chosen.
  for (const name of ['現在の状態', '次の操作', '履歴']) await expect(page.getByRole('heading', {level: 2, name, exact: true})).toBeVisible();
  await expect(page.getByText('サーバーの検証で不整合なし', {exact: true})).toBeVisible();
  const overview = page.getByRole('region', {name: 'この部署の契約の一覧'});
  await expect(overview.getByRole('row').filter({hasText: '合成職員・長い氏名・薬剤部の画面評価'})).toHaveText(/直接雇用常勤一般制2024-12-01 00:00 〜 2027-02-16 00:00確認済み確認済み第1版$/);
  // The two people of the input and the person whose contract has ended, under the heading.
  await expect(overview.getByRole('row')).toHaveCount(4);
  await expect(overview.getByRole('row').filter({hasText: '合成退職確認職員'})).toContainText('2025-01-01 00:00 〜 2025-12-31 23:59');
  for (const summary of Object.values(ROSTER_TASKS)) {
    await expect(page.getByText(summary, {exact: true})).toBeVisible();
    await expect(page.getByRole('group', {name: summary})).toHaveCount(0);
  }
  await expect(surface).toHaveCount(0);
  await expect(page.getByRole('link', {name: '監査の履歴を開く', exact: true})).toHaveAttribute('href', /^\/workspace\/governance\/audit/);
  await expect(page.getByText(/以前の版の内容は、APIが返さないため、この画面では表示できません。/)).toBeVisible();

  // A contract is revised: chosen, changed, confirmed, saved.
  const contract = await openTask(page, ROSTER_TASKS.contract);
  await contract.getByLabel('編集する対象').selectOption('c1');
  await expect(contract.getByLabel('最大連続勤務日数')).toHaveValue('6');
  // The task with its form is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u20-contracts-task', width);
  await contract.getByLabel('最大連続勤務日数').fill('5');
  await contract.getByRole('button', {name: '保存内容を確認する', exact: true}).click();
  // Nothing is sent before the confirmation, which says the four things.
  await expect(surface.getByRole('heading', {name: '3. 保存前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface.getByRole('listitem')).toHaveText(['最大連続勤務日数：6日 → 5日']);
  await expect(surface).toContainText('第1版 → 第2版');
  await expect(surface).toContainText('誰にも通知されません。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。');
  await expect(surface).toContainText('保存前の時点では検出されていません。');
  expect(saves).toBe(0);
  const revised = posted('contract');
  await surface.getByRole('button', {name: 'この内容で保存する', exact: true}).click();
  const first = await revised;
  expect(first.status(), await first.text()).toBe(200);
  expect((await first.json()).revision).toBe(2);
  const sent = first.request().postDataJSON() as {expected_revision: number; payload: Record<string, unknown>};
  expect(sent.expected_revision).toBe(1);
  expect(sent.payload).toMatchObject({revision_id: 'c1', person_id: 'p1', max_consecutive_days: 5, rest_seconds: 39600});
  // What was saved is said from the server's answer, with where the plan's input is derived again.
  const saved = contract.getByRole('status').filter({hasText: '契約を第2版として保存しました。'});
  await expect(saved).toContainText('計画の入力には自動で反映されません。');
  await expect(saved.getByRole('link', {name: '計画の「前提・取込」', exact: true})).toHaveAttribute('href', /^\/workspace\/plan\/input/);
  await expect(surface).toHaveCount(0);
  expect((await recordsOf('contract')).find((row) => row.entity_id === 'c1')).toMatchObject({revision: 2, payload: {max_consecutive_days: 5}});
  // The list is the server's next read.
  await expect(overview.getByRole('row').filter({hasText: '合成職員・長い氏名・薬剤部の画面評価'})).toContainText('第2版');

  // Another session changes the contract. The edit made here conflicts and is not merged.
  const concurrent = await page.request.post(`${API}/planning/compliance/records/contract${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 2, idempotency_key: `u20-concurrent-${tag}`, payload: {...sent.payload, rest_seconds: 43200}},
  });
  expect(concurrent.status(), await concurrent.text()).toBe(200);
  expect((await concurrent.json()).revision).toBe(3);
  await contract.getByLabel('編集する対象').selectOption('c1');
  await contract.getByLabel('最大連続勤務日数').fill('4');
  await contract.getByRole('button', {name: '保存内容を確認する', exact: true}).click();
  await expect(surface).toContainText('第2版 → 第3版');
  const refused = posted('contract');
  await surface.getByRole('button', {name: 'この内容で保存する', exact: true}).click();
  expect((await refused).status()).toBe(409);
  await expect(surface.getByRole('alert')).toContainText('現在の版は第3版です。編集中の内容は保持しています。');
  const review = surface.getByRole('region', {name: '三つの内容の比較'});
  await expect(review.getByRole('row').filter({hasText: '勤務間休息時間'})).toHaveText('勤務間休息時間39600秒（11時間0分）43200秒（12時間0分）39600秒（11時間0分）あり');
  await expect(review.getByRole('row').filter({hasText: '最大連続勤務日数'})).toHaveText('最大連続勤務日数5日5日4日あり');
  await expect(surface.getByRole('button', {name: 'この内容で保存する', exact: true})).toBeDisabled();
  expect((await recordsOf('contract')).find((row) => row.entity_id === 'c1')?.revision).toBe(3);
  // The task with its confirmation and the three contents is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u20-contracts-confirmation', width);
  // Saving again needs the review, and goes against the current version.
  await surface.getByRole('button', {name: '三つの内容を確認し、現在の版に対して確認し直す', exact: true}).click();
  await expect(surface.getByRole('status')).toContainText('現在の第3版との差分に更新しました。');
  await expect(surface).toContainText('第3版 → 第4版');
  const accepted = posted('contract');
  await surface.getByRole('button', {name: 'この内容で保存する', exact: true}).click();
  const second = await accepted;
  expect(second.status(), await second.text()).toBe(200);
  expect((second.request().postDataJSON() as {expected_revision: number}).expected_revision).toBe(3);
  await expect(contract.getByRole('status').filter({hasText: '契約を第4版として保存しました。'})).toBeVisible();
  expect((await recordsOf('contract')).find((row) => row.entity_id === 'c1')).toMatchObject({revision: 4, payload: {max_consecutive_days: 4, rest_seconds: 39600}});

  // The person the URL names is chosen at first. A step of adding a person starts the task
  // that registers the record, on a new record of that person.
  await openWorkspace(page, '/workspace/people/contracts?person=p1', '職員');
  await expect(page.getByRole('list', {name: '職員一覧'}).getByRole('button', {name: /合成職員・長い氏名・薬剤部の画面評価/})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', {name: /の契約$/}).getByRole('row')).toHaveCount(2);
  const stepList = page.getByRole('list', {name: '新しい職員を追加する手順'});
  await expect(stepList.getByRole('listitem').filter({hasText: '3. 雇用関係を登録する'})).toContainText('記録あり');
  await stepList.getByRole('button', {name: '資格の登録を始める', exact: true}).click();
  const capability = page.getByRole('group', {name: ROSTER_TASKS.capability});
  await expect(capability.getByRole('heading', {name: '2. 資格の内容と根拠を入力する', exact: true})).toBeFocused();
  await expect(capability.getByLabel('編集する対象')).toHaveValue('new');
  await expect(capability.getByLabel('対象職員')).toHaveValue('p1');
  await capability.getByLabel('適用開始（日本時間）').fill('2026-01-05T00:00');
  await capability.getByLabel('適用終了（日本時間）').fill('2026-01-12T00:00');
  await capability.getByRole('combobox', {name: '担当業務', exact: true}).selectOption({index: 1});
  await capability.getByRole('combobox', {name: '勤務場所', exact: true}).selectOption({index: 1});
  const reference = `合成資格原本 ${tag}`;
  await capability.getByLabel('原本確認の資料名・参照先').fill(reference);
  await capability.getByLabel('原本確認の状態').selectOption('verified');
  await capability.getByLabel('原本確認の確認責任者').fill('synthetic-reviewer');
  await capability.getByRole('button', {name: '保存内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 保存前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText(`原本確認の資料：（なし） → ${reference}`);
  await expect(surface).toContainText('新規登録（第1版を作成）');
  const registered = posted('capability');
  await surface.getByRole('button', {name: 'この内容で保存する', exact: true}).click();
  const capabilityResponse = await registered;
  expect(capabilityResponse.status(), await capabilityResponse.text()).toBe(200);
  const capabilityBody = capabilityResponse.request().postDataJSON() as {expected_revision: number; payload: Record<string, unknown>};
  expect(capabilityBody.expected_revision).toBe(0);
  expect(capabilityBody.payload).toMatchObject({person_id: 'p1', start: '2026-01-04T15:00:00.000Z', end: '2026-01-11T15:00:00.000Z', evidence: {reference, status: 'verified', verified_by: 'synthetic-reviewer', valid_until: null}});
  await expect(capability.getByRole('status').filter({hasText: '資格を第1版として保存しました。'})).toBeVisible();
  expect((await recordsOf('capability')).filter((row) => (row.payload.evidence as {reference: string}).reference === reference)).toHaveLength(1);
  await expect(page.getByRole('region', {name: /の資格$/}).getByRole('row').filter({hasText: '2026-01-05 00:00 〜 2026-01-12 00:00'})).toContainText('第1版');

  // What is lawful is the server's to say: an agreement beyond the bounds of an ordinary
  // agreement is sent as entered and refused in the server's words; nothing is saved.
  const agreement = await openTask(page, ROSTER_TASKS.agreement);
  await agreement.getByLabel('編集する対象').selectOption('new');
  await agreement.getByLabel('適用開始（日本時間）').fill('2026-01-05T00:00');
  await agreement.getByLabel('適用終了（日本時間）').fill('2026-01-12T00:00');
  await agreement.getByRole('combobox', {name: '協定を適用する事業場', exact: true}).selectOption({index: 1});
  await agreement.getByLabel('協定年の起算日').fill('2026-01-01');
  await agreement.getByLabel('協定月の起算日').fill('2026-01-01');
  await agreement.getByLabel('協定の月時間外上限（秒）').fill('180000');
  await agreement.getByLabel('協定の年時間外上限（秒）').fill('1440000');
  await agreement.getByLabel('原本確認の資料名・参照先').fill(`合成協定書 ${tag}`);
  await agreement.getByRole('button', {name: '保存内容を確認する', exact: true}).click();
  await expect(surface).toContainText('協定の月時間外上限：（なし） → 180000秒（50時間0分）');
  const unlawful = posted('agreement');
  await surface.getByRole('button', {name: 'この内容で保存する', exact: true}).click();
  expect((await unlawful).status()).toBe(422);
  await expect(surface).toContainText('保存していません。サーバーが下の理由で受け付けませんでした。');
  await expect(surface.getByRole('alert')).toContainText('Ordinary agreement is limited to 45h/month and 360h/year');
  expect(await recordsOf('agreement')).toHaveLength(0);
  await surface.getByRole('button', {name: '入力に戻る', exact: true}).click();
  await agreement.getByRole('button', {name: '入力を破棄する', exact: true}).click();

  // A decision on a revised rule is bound to the impact the server lists for its review.
  const reviewId = `u20-review-${tag}`;
  const reviewed = await page.request.post(`${API}/planning/compliance/records/rule_review${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 0, idempotency_key: `u20-review-${tag}`, payload: {
      review_id: reviewId, rule_id: 'general-test-v2', source_url: 'synthetic:u20', document_version: `合成改正 ${tag}`, source_sha256: 'a'.repeat(64), provision: '合成の条項', transitional_provision: '経過措置なし',
      reviewed_on: '2026-01-02', next_review_on: '2026-07-01', start: '2026-01-01T00:00:00+09:00', end: '2027-01-01T00:00:00+09:00', evidence: {reference: `合成一次資料 ${tag}`, status: 'verified', verified_by: 'synthetic-reviewer', valid_until: null},
    }},
  });
  expect(reviewed.status(), await reviewed.text()).toBe(200);
  const impact = await (await page.request.get(`${API}/planning/compliance/rule-impact/${reviewId}${QUERY}`)).json() as {impact_hash: string; impact_count: number; publications: unknown[]};
  expect(impact.publications.length).toBeGreaterThan(0);
  await openWorkspace(page, '/workspace/people/contracts', '職員');
  let impactReads = 0;
  page.on('request', (request) => { if (request.method() === 'GET' && /\/planning\/compliance\/rule-impact\//.test(request.url())) impactReads += 1; });
  const decision = await openTask(page, ROSTER_TASKS.decision);
  await decision.getByLabel('編集する対象').selectOption('new');
  expect(impactReads).toBe(0);
  await decision.getByLabel('判断する制度確認（資料のハッシュ付き）').selectOption(reviewId);
  await expect(decision.getByRole('group', {name: 'サーバーが返した影響の一覧'})).toContainText(`（合計 ${impact.impact_count}件）`);
  await expect(decision.getByRole('group', {name: 'サーバーが返した影響の一覧'}).getByRole('listitem').first()).toContainText(/^公開した勤務表 .+（規則版 general-test-v1）$/);
  expect(impactReads).toBe(1);
  await decision.getByLabel('判断日').fill('2026-01-05');
  await decision.getByLabel('原本確認の資料名・参照先').fill(`合成判断記録 ${tag}`);
  await decision.getByRole('button', {name: '保存内容を確認する', exact: true}).click();
  // The list is read again for the confirmation and shown there before anything is saved.
  await expect(surface.getByRole('heading', {name: '3. 保存前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('group', {name: 'サーバーが返した影響の一覧'})).toContainText(`この判断に結び付ける影響の一覧：公開 ${impact.publications.length}件`);
  await expect(surface).toContainText(`判断に結び付ける影響の一覧：（なし） → ${impact.impact_count}件（照合値 ${impact.impact_hash.slice(0, 12)}…）`);
  expect(impactReads).toBe(2);
  const decided = posted('rule_decision');
  await surface.getByRole('button', {name: 'この内容で保存する', exact: true}).click();
  const decisionResponse = await decided;
  expect(decisionResponse.status(), await decisionResponse.text()).toBe(200);
  expect((decisionResponse.request().postDataJSON() as {payload: Record<string, unknown>}).payload).toMatchObject({review_id: reviewId, rule_id: 'general-test-v2', source_sha256: 'a'.repeat(64), impact_hash: impact.impact_hash, impact_count: impact.impact_count, decision: 'hold', decided_on: '2026-01-05'});
  await expect(decision.getByRole('status').filter({hasText: '改定規則の公開判断を第1版として保存しました。'})).toBeVisible();
  expect(await recordsOf('rule_decision')).toHaveLength(1);

  // Each save is one audit event with its version; the refused agreement left none; nobody was notified.
  const events = await rosterEvents();
  expect(events).toHaveLength(eventsBefore + 6);
  expect(events.slice(0, 6).map((entry) => `${entry.kind} ${entry.version} ${entry.actor_role}`)).toEqual(['compliance.rule_decision 1 ADMIN', 'compliance.rule_review 1 ADMIN', 'compliance.capability 1 ADMIN', 'compliance.contract 4 ADMIN', 'compliance.contract 3 ADMIN', 'compliance.contract 2 ADMIN']);
  expect(events.map((entry) => entry.kind)).not.toContain('compliance.agreement');
  expect(await notificationCount()).toBe(notificationsBefore);

  // The saved records are not in the plan's input until it is derived again there.
  await decision.getByRole('status').getByRole('link', {name: '計画の「前提・取込」', exact: true}).click();
  await page.waitForURL((url) => url.pathname === '/workspace/plan/input');
  await expect(page.getByText('再導出が必要', {exact: true})).toBeVisible();

  // The screen without a view shows an administrator the first view the role has.
  await openWorkspace(page, '/workspace/people', '職員');
  await expect(page.getByRole('list', {name: '職員一覧'})).toBeVisible();
  await expect(page.getByLabel('職員を検索')).toBeVisible();
  await expect(page.getByRole('heading', {level: 2, name: '次の操作', exact: true})).toHaveCount(0);

  // A leader may read the records but is not given the route and cannot save a record.
  await signOut(page);
  await signIn(page, 'leader');
  await page.goto('/workspace/people/contracts');
  await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
  await expect(page.getByText(ROSTER_TASKS.contract, {exact: true})).toHaveCount(0);
  await expect(surface).toHaveCount(0);
  // The screen without a view is refused in the same way: a leader has no view of it.
  expect((await page.goto('/workspace/people'))?.status()).toBe(200);
  await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
  expect((await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}`)).status()).toBe(200);
  expect((await page.request.get(`${API}/planning/compliance/rule-impact/${reviewId}${QUERY}`)).status()).toBe(403);
  const leaderSave = await page.request.post(`${API}/planning/compliance/records/contract${QUERY}`, {headers: {Origin: origin}, data: {expected_revision: 4, idempotency_key: `u20-leader-${tag}`, payload: {...sent.payload, max_consecutive_days: 3}}});
  expect(leaderSave.status()).toBe(403);

  // A pharmacist can neither open the route nor read or save the records behind it.
  await signOut(page);
  await signIn(page, 'pharmacist');
  await page.goto('/workspace/people/contracts?person=p1');
  await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
  await expect(page.getByText(ROSTER_TASKS.contract, {exact: true})).toHaveCount(0);
  expect((await page.goto('/workspace/people'))?.status()).toBe(200);
  await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
  expect((await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}`)).status()).toBe(403);
  const pharmacistSave = await page.request.post(`${API}/planning/compliance/records/contract${QUERY}`, {headers: {Origin: origin}, data: {expected_revision: 4, idempotency_key: `u20-pharmacist-${tag}`, payload: {...sent.payload, max_consecutive_days: 3}}});
  expect(pharmacistSave.status()).toBe(403);
  expect((await page.request.get(`${API}/planning/compliance/records${QUERY}`)).status()).toBe(200);
});

type DemandRow = {kind: string; entity_id: string; revision: number; payload: {demand_id: string; minimum: number; target: number; evidence: Record<string, unknown>}};

matrix('ideal-deep-u21-demand', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/plan/input', '計画');
  const origin = new URL(page.url()).origin;
  const inputHash = (await (await page.request.get(`${API}/planning/inputs/latest${QUERY}`)).json()).input_hash as string;
  const demandOf = async (demandId: string) => {
    const response = await page.request.get(`${API}/planning/compliance/records${QUERY}&input_hash=${inputHash}`);
    expect(response.status()).toBe(200);
    return ((await response.json()) as DemandRow[]).find((row) => row.kind === 'demand' && row.entity_id === demandId);
  };
  const saveResponse = () => page.waitForResponse((response) => response.request().method() === 'POST' && /\/planning\/compliance\/records\/demand\?/.test(response.url()));
  // The audit timeline names no record: the demand events are told apart by kind, newest first.
  const demandEvents = async () => {
    const response = await page.request.get(`${API}/planning/audit-timeline${QUERY}&category=compliance&limit=200`);
    expect(response.status()).toBe(200);
    return ((await response.json()).entries as Array<{kind: string; version: number | null; actor_role: string | null}>).filter((entry) => entry.kind === 'compliance.demand');
  };
  const notificationCount = async () => ((await (await page.request.get(`${API}/planning/notifications${QUERY}`)).json()) as unknown[]).length;
  const eventsBefore = (await demandEvents()).length;
  const notificationsBefore = await notificationCount();

  // First what is registered, the next step and the versions. The form is not open.
  await page.getByText('必要配置・資格要件を確認・編集', {exact: true}).click();
  for (const name of ['現在の必要配置', '次の操作', '版と履歴']) await expect(page.getByRole('heading', {level: 3, name, exact: true})).toBeVisible();
  await expect(page.getByLabel('編集する対象')).toBeHidden();
  await expect(page.getByRole('link', {name: /監査の履歴を開く/})).toHaveAttribute('href', /^\/workspace\/governance\/audit/);

  // The task opens from the next step.
  await page.getByText('必要配置を登録・変更する', {exact: true}).click();
  await page.getByLabel('編集する対象').selectOption('new');
  await page.getByRole('combobox', {name: '配置する業務', exact: true}).selectOption({index: 1});
  await page.getByRole('combobox', {name: '配置する場所', exact: true}).selectOption({index: 1});
  await page.getByLabel('必須の配置人数').fill('1');
  await page.getByLabel('希望する配置人数').fill('2');
  await page.getByLabel('適用開始（日本時間）').fill('2026-01-05T09:00');
  await page.getByLabel('適用終了（日本時間）').fill('2026-01-05T17:00');
  const reference = `合成配置表 ${info.project.name} ${width}`;
  await page.getByLabel('原本確認の資料名・参照先').fill(reference);
  await page.getByLabel('原本確認の状態').selectOption('verified');
  await page.getByLabel('原本確認の確認責任者').fill('synthetic-reviewer');
  let requests = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && /\/planning\/compliance\/records\/demand\?/.test(request.url())) requests += 1; });
  await page.getByRole('button', {name: '保存内容を確認する'}).click();

  // Nothing is sent before the confirmation, which says the four things.
  const surface = page.locator('.ideal-confirm');
  await expect(surface.getByRole('heading', {name: '3. 保存前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface).toContainText(`原本確認の資料：（なし） → ${reference}`);
  await expect(surface).toContainText('新規登録（第1版を作成）');
  await expect(surface).toContainText('誰にも通知されません。');
  await expect(surface).toContainText('保存前の時点では検出されていません。');
  expect(requests).toBe(0);
  const created = saveResponse();
  await surface.getByRole('button', {name: 'この内容で保存する'}).click();
  const first = await created;
  expect(first.status()).toBe(200);
  expect((await first.json()).revision).toBe(1);
  const sent = first.request().postDataJSON() as {expected_revision: number; input_hash: string; payload: DemandRow['payload']};
  expect(sent.expected_revision).toBe(0);
  expect(sent.input_hash).toBe(inputHash);
  expect(sent.payload.evidence).toEqual({reference, status: 'verified', verified_by: 'synthetic-reviewer', valid_until: null});
  await expect(page.getByText(/必要配置を第1版として保存しました/)).toBeVisible();
  await expect(surface).toHaveCount(0);
  const demandId = sent.payload.demand_id;
  expect(await demandOf(demandId)).toMatchObject({revision: 1, payload: {minimum: 1, target: 2, evidence: {reference, status: 'verified'}}});
  // The list is the server's next read.
  const registered = page.getByRole('region', {name: '登録されている必要配置'});
  const saved = registered.getByRole('row').filter({hasText: '2026-01-05 09:00 〜 2026-01-05 17:00'});
  await expect(saved.filter({hasText: '第1版'})).toHaveCount(1);
  await expect(page.getByText('再導出が必要', {exact: true})).toBeVisible();

  // Another session changes the record. The edit made here conflicts and is not merged.
  const concurrent = await page.request.post(`${API}/planning/compliance/records/demand${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 1, input_hash: inputHash, idempotency_key: `u21-concurrent-${info.project.name}-${width}`, payload: {...sent.payload, minimum: 2}},
  });
  expect(concurrent.status()).toBe(200);
  expect((await concurrent.json()).revision).toBe(2);
  await page.getByLabel('編集する対象').selectOption(demandId);
  await expect(page.getByLabel('必須の配置人数')).toHaveValue('1');
  await page.getByLabel('希望する配置人数').fill('3');
  await page.getByRole('button', {name: '保存内容を確認する'}).click();
  await expect(surface).toContainText('希望する配置人数：2名 → 3名');
  await expect(surface).toContainText('第1版 → 第2版');
  const refused = saveResponse();
  await surface.getByRole('button', {name: 'この内容で保存する'}).click();
  expect((await refused).status()).toBe(409);
  await expect(surface.getByRole('alert')).toContainText('現在の版は第2版です。編集中の内容は保持しています。');
  const review = surface.getByRole('region', {name: '三つの内容の比較'});
  await expect(review.getByRole('row').filter({hasText: '必須の配置人数'})).toHaveText('必須の配置人数1名2名1名あり');
  await expect(review.getByRole('row').filter({hasText: '希望する配置人数'})).toHaveText('希望する配置人数2名2名3名あり');
  await expect(surface.getByRole('button', {name: 'この内容で保存する'})).toBeDisabled();
  expect((await demandOf(demandId))?.revision).toBe(2);
  // The confirmation with its three-way review is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u21-demand-confirmation', width);

  // Saving again needs the review, and goes against the current version.
  await surface.getByRole('button', {name: '三つの内容を確認し、現在の版に対して確認し直す'}).click();
  await expect(surface.getByRole('status')).toContainText('現在の第2版との差分に更新しました。');
  await expect(surface).toContainText('必須の配置人数：2名 → 1名');
  await expect(surface).toContainText('第2版 → 第3版');
  const accepted = saveResponse();
  await surface.getByRole('button', {name: 'この内容で保存する'}).click();
  const second = await accepted;
  expect(second.status()).toBe(200);
  expect((await second.json()).revision).toBe(3);
  expect((second.request().postDataJSON() as {expected_revision: number}).expected_revision).toBe(2);
  await expect(page.getByText(/必要配置を第3版として保存しました/)).toBeVisible();
  expect(await demandOf(demandId)).toMatchObject({revision: 3, payload: {minimum: 1, target: 3, evidence: {reference, status: 'verified'}}});
  await expect(saved.filter({hasText: '第3版'})).toHaveCount(1);

  // Each of the three saves is one audit event with its version; nobody is notified of them.
  const events = await demandEvents();
  expect(events).toHaveLength(eventsBefore + 3);
  expect(events.slice(0, 3)).toMatchObject([3, 2, 1].map((version) => ({kind: 'compliance.demand', version, actor_role: 'ADMIN'})));
  expect(await notificationCount()).toBe(notificationsBefore);

  // A leader may register; the audit history is the administrator's.
  await signOut(page);
  await signIn(page, 'leader');
  await openWorkspace(page, '/workspace/plan/input', '計画');
  await page.getByText('必要配置・資格要件を確認・編集', {exact: true}).click();
  await expect(page.getByRole('region', {name: '登録されている必要配置'}).getByRole('row').filter({hasText: '2026-01-05 09:00 〜 2026-01-05 17:00'}).filter({hasText: '第3版'})).toHaveCount(1);
  await expect(page.getByText('必要配置を登録・変更する', {exact: true})).toBeVisible();
  await expect(page.getByRole('link', {name: /監査の履歴を開く/})).toHaveCount(0);
  await expect(page.getByRole('heading', {name: '契約・資格から勤務候補を再導出'})).toHaveCount(0);
  expect((await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}&input_hash=${inputHash}`)).status()).toBe(200);
  expect((await page.request.get(`${API}/planning/audit-timeline${QUERY}&category=compliance`)).status()).toBe(403);

  // A pharmacist can neither open the route nor read or save the records behind it.
  await signOut(page);
  await signIn(page, 'pharmacist');
  await page.goto('/workspace/plan/input');
  await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
  await expect(page.getByText('必要配置を登録・変更する', {exact: true})).toHaveCount(0);
  await expect(page.locator('.ideal-confirm')).toHaveCount(0);
  expect((await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}&input_hash=${inputHash}`)).status()).toBe(403);
  const forbidden = await page.request.post(`${API}/planning/compliance/records/demand${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 3, input_hash: inputHash, idempotency_key: `u21-pharmacist-${info.project.name}-${width}`, payload: {...sent.payload, target: 9}},
  });
  expect(forbidden.status()).toBe(403);
});

function monthRange(info: TestInfo, width: number) {
  const project = {chromium: 0, firefox: 1, webkit: 2}[info.project.name] ?? 0;
  const offset = project * 3 + WIDTHS.indexOf(width as (typeof WIDTHS)[number]);
  const start = new Date(Date.UTC(2027, offset, 1));
  const end = new Date(Date.UTC(2027, offset + 1, 0));
  return {start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10)};
}

type FlexAction = {allowed: boolean; refusal: string | null};
type FlexAdoptionRow = {entity_id: string; revision: number; payload: {target_scope: string; status: string; created_by: string; reviewed_by?: string; decided_by?: string; end_reason?: string}; settlement_starts: {participant_start: string[]; end_on: string[]}; actions: Record<'confirm' | 'withdraw' | 'end' | 'add_participant', FlexAction>};
type FlexListing = {viewer: string; can_manage: boolean; adoptions: FlexAdoptionRow[]; enrollments: Array<{entity_id: string; payload: {adoption_id: string; person_id: string; status: string}; actions: Record<'confirm' | 'withdraw', FlexAction>}>};

matrix('ideal-deep-u22-flextime', async (page, info, width) => {
  // The browser's clock offers nothing here: every day and every permitted step is the server's
  // (its clock is fixed by the fixture at 2026-01-05 09:00 JST).
  await page.clock.install({time: new Date('2026-01-05T00:00:00+09:00')});
  const period = monthRange(info, width);
  const scopeText = `薬剤部の常勤薬剤師 ${info.project.name} ${width}`;
  const SELF = '登録した管理者本人は確認できません。別の管理者が確認してください。';
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/settings/flextime', '設定');
  const origin = new URL(page.url()).origin;
  const surface = page.locator('.ideal-confirm');
  const listingOf = async () => {
    const response = await page.request.get(`${API}/planning/compliance/flex-adoptions${QUERY}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as FlexListing;
  };
  const posted = (path: RegExp) => page.waitForResponse((response) => response.request().method() === 'POST' && path.test(response.url()));
  let registrations = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && /\/planning\/compliance\/flex-adoptions\?/.test(request.url())) registrations += 1; });

  // First the state (with the settlement), the next step and the history. No form is open.
  for (const name of ['現在の状態', '次の操作', '履歴']) await expect(page.getByRole('heading', {level: 2, name, exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {level: 3, name: 'フレックスタイム制の清算', exact: true})).toBeVisible();
  await expect(page.getByLabel('対象労働者の範囲')).toBeHidden();
  await expect(page.getByText('取り下げた採用・終了した採用はありません。', {exact: true})).toBeVisible();
  await expect(page.getByRole('link', {name: '監査の履歴を開く'})).toBeVisible();

  // The registration opens from the next step. A start the server refuses (its day is past).
  const register = await openTask(page, 'フレックスタイム制の採用を登録する');
  await register.getByLabel('事業場').selectOption('site-hospital');
  await register.getByLabel('対象労働者の範囲').fill(scopeText);
  await register.getByLabel('清算期間の起算日（採用の開始日）').fill('2026-01-01');
  await register.getByLabel('採用の最終日（この日を含む）').fill(period.end);
  await register.getByLabel('協定で定めた総労働時間').fill('清算期間の暦日数 ÷ 7 × 40時間');
  await register.getByLabel(/^標準となる1日の労働時間/).fill('8:00');
  await register.getByLabel('フレキシブルタイムの開始').fill('07:00');
  await register.getByLabel('フレキシブルタイムの終了').fill('20:00');
  await register.getByLabel('コアタイムの開始').fill('10:00');
  await register.getByLabel('コアタイムの終了').fill('15:00');
  for (const name of ['就業規則の規定', '労使協定']) {
    await register.getByLabel(`${name}の資料名・参照先`).fill(`合成原本 ${width}`);
    await register.getByLabel(`${name}の状態`).selectOption('verified');
    await register.getByLabel(`${name}の確認責任者`).fill('synthetic-reviewer');
  }
  await register.getByLabel('Person 0', {exact: true}).check();
  await register.getByRole('button', {name: '入力内容を確認する', exact: true}).click();
  // Nothing is sent before the confirmation, which says the four things.
  await expect(surface.getByRole('heading', {name: '2. 登録前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface).toContainText(`対象労働者の範囲：（なし） → ${scopeText}`);
  await expect(surface).toContainText('参加者（起算日から参加）：（なし） → Person 0');
  await expect(surface).toContainText('採用の記録を新規登録します（第1版、確認待ち）。参加者 1人の参加の記録も、それぞれ第1版（確認待ち）として登録します。');
  await expect(surface).toContainText('誰にも通知されません。');
  expect(registrations).toBe(0);
  const refused = posted(/\/planning\/compliance\/flex-adoptions\?/);
  await surface.getByRole('button', {name: 'この内容で登録する（確認待ち）', exact: true}).click();
  expect((await refused).status()).toBe(422);
  // The server's refusal returns to the fields under a heading that takes focus, at its field.
  const past = '採用は、将来の清算期間の初日から始めてください（さかのぼる採用はできません）。';
  await expect(register.getByRole('heading', {name: 'サーバーが登録を受け付けませんでした（1件）', exact: true})).toBeFocused();
  await expect(surface).toHaveCount(0);
  await register.getByRole('button', {name: past, exact: true}).click();
  await expect(register.getByLabel('清算期間の起算日（採用の開始日）')).toBeFocused();
  expect((await listingOf()).adoptions.some((row) => row.payload.target_scope === scopeText)).toBe(false);
  await register.getByLabel('清算期間の起算日（採用の開始日）').fill(period.start);
  await register.getByRole('button', {name: '入力内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '2. 登録前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText(`起算日（採用の開始日）：（なし） → ${period.start}`);
  // The task with its confirmation is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u22-flextime-confirmation', width);
  const created = posted(/\/planning\/compliance\/flex-adoptions\?/);
  const enrolled = posted(/\/planning\/compliance\/flex-enrollments\?/);
  await surface.getByRole('button', {name: 'この内容で登録する（確認待ち）', exact: true}).click();
  const registered = await created;
  expect(registered.status()).toBe(200);
  expect((await enrolled).status()).toBe(200);
  const sent = registered.request().postDataJSON() as {payload: {adoption_id: string; start: string; end: string; target_scope: string}};
  expect(sent.payload).toMatchObject({target_scope: scopeText, start: `${period.start}T00:00:00+09:00`, establishment_id: 'site-hospital', employer_id: 'hospital', standard_day_seconds: 28800});
  expect(sent.payload).not.toHaveProperty('status');
  const adoptionId = sent.payload.adoption_id;
  await expect(register.getByRole('status')).toContainText('採用を第1版として登録しました（確認待ち）。別の管理者が影響を確認して確認するまで、フレックスタイム制は有効になりません。');
  await expect(register.getByRole('list', {name: '参加者の登録結果'})).toContainText('Person 0：参加を登録しました（確認待ち）。');
  await expect(surface).toHaveCount(0);

  // The list is the server's next read. The registering administrator may not confirm: the
  // server says so on the record, the screen shows its words and offers no control for it.
  const mine = (await listingOf()).adoptions.find((row) => row.entity_id === adoptionId)!;
  expect(mine).toMatchObject({revision: 1, payload: {status: 'registered', created_by: 'admin'}, actions: {confirm: {allowed: false, refusal: SELF}}});
  const card = page.getByRole('region', {name: new RegExp(`${period.start} から`)});
  await expect(card).toContainText('確認待ち');
  await expect(card).toContainText('登録：あなた／確認：まだ確認されていません');
  await expect(card).toContainText(`この採用の確認について、サーバーの回答：${SELF}`);
  const confirmTask = await openTask(page, '採用を確認する（影響の確認）');
  await expect(confirmTask.getByText('あなたが確認できる採用はありません。', {exact: true})).toBeVisible();
  await expect(confirmTask.getByRole('list', {name: '確認できない採用'})).toContainText(SELF);
  await expect(confirmTask.getByRole('button')).toHaveCount(0);
  const impactOf = async () => (await (await page.request.get(`${API}/planning/compliance/flex-adoptions/${adoptionId}/impact${QUERY}`)).json()) as {impact_hash: string; people: unknown[]};
  const own = await page.request.post(`${API}/planning/compliance/flex-adoptions/${adoptionId}/confirm${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 1, impact_hash: (await impactOf()).impact_hash, idempotency_key: `u22-self-confirm-${info.project.name}-${width}`},
  });
  expect(own.status()).toBe(403);

  // Another administrator reads the impact and confirms exactly what was shown.
  await signOut(page);
  await signIn(page, 'developer');
  await openWorkspace(page, '/workspace/settings/flextime', '設定');
  expect((await listingOf()).adoptions.find((row) => row.entity_id === adoptionId)!.actions.confirm).toEqual({allowed: true, refusal: null});
  const impact = await impactOf();
  const confirmAgain = await openTask(page, '採用を確認する（影響の確認）');
  await confirmAgain.getByLabel('確認する採用').selectOption(adoptionId);
  await confirmAgain.getByRole('button', {name: '確認の前に影響を表示する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '2. 確認すると変わること', exact: true})).toBeFocused();
  await expect(surface).toContainText('状態：確認待ち → 採用中');
  await expect(surface).toContainText('第1版 → 第2版');
  await expect(surface).toContainText('参加者 1人：Person 0');
  await expect(surface.getByRole('list', {name: '確認の後に行うこと'}).getByRole('listitem')).toHaveCount(2);
  const confirmed = posted(new RegExp(`/flex-adoptions/${adoptionId}/confirm\\?`));
  await surface.getByRole('button', {name: '内容と影響を確認して採用する', exact: true}).click();
  const confirmation = await confirmed;
  expect(confirmation.status()).toBe(200);
  expect(confirmation.request().postDataJSON()).toMatchObject({expected_revision: 1, impact_hash: impact.impact_hash});
  await expect(confirmAgain.getByRole('status')).toContainText('採用を確認しました（第2版、採用中）。');
  await expect(card).toContainText('採用中');
  await expect(card).toContainText('登録：別の管理者／確認：あなた');
  await expect(card).toContainText('Person 0');
  const after = await listingOf();
  expect(after.adoptions.find((row) => row.entity_id === adoptionId)).toMatchObject({revision: 2, payload: {status: 'confirmed', created_by: 'admin', reviewed_by: 'developer'}});
  expect(after.enrollments.find((row) => row.payload.adoption_id === adoptionId)).toMatchObject({payload: {person_id: 'p0', status: 'confirmed'}});

  // A started adoption ends on one of the days the server lists, with a reason.
  const runningId = `flex-end-${info.project.name}-${width}`;
  const running = after.adoptions.find((row) => row.entity_id === runningId)!;
  expect(running.actions.end).toEqual({allowed: true, refusal: null});
  expect(running.settlement_starts.end_on[0]).toBe('2026-02-01');
  const endTask = await openTask(page, '採用を終了する');
  await endTask.getByLabel('終了する採用').selectOption(runningId);
  await expect(endTask.getByLabel('終了日（この日から採用しない）').getByRole('option')).toHaveText(['選んでください', ...running.settlement_starts.end_on]);
  await endTask.getByLabel('終了日（この日から採用しない）').selectOption('2026-02-01');
  await endTask.getByLabel('終了する理由（必須）').fill('合成の清算期間境界で終了');
  await endTask.getByRole('button', {name: '内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 終了前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('採用の期間：2026-01-01 〜 2026-11-30 → 2026-01-01 〜 2026-01-31');
  await expect(surface).toContainText('第1版 → 第2版');
  const ending = posted(new RegExp(`/flex-adoptions/${runningId}/end\\?`));
  await surface.getByRole('button', {name: '理由を記録して終了する', exact: true}).click();
  const endResponse = await ending;
  expect(endResponse.status()).toBe(200);
  expect(endResponse.request().postDataJSON()).toMatchObject({expected_revision: 1, end_on: '2026-02-01', reason: '合成の清算期間境界で終了'});
  await expect(endTask.getByRole('status')).toContainText('採用を 2026-02-01 で終了します（第2版）。');
  const ended = page.getByRole('region', {name: /2026-01-01 から 2026-01-31 まで/});
  await expect(ended).toHaveCount(1);
  await expect(ended).toContainText(`終了確認 ${info.project.name} ${width}`);
  await expect(ended).toContainText('終了：あなた（合成の清算期間境界で終了）');
  await expect(page.getByRole('region', {name: '取り下げた採用・終了した採用'}).getByRole('row').filter({hasText: '合成の清算期間境界で終了'})).toHaveCount(1);
  const recordsResponse = await page.request.get(`${API}/planning/compliance/records${QUERY}`);
  expect(recordsResponse.status()).toBe(200);
  const endedRecord = (await recordsResponse.json()).find(
    (record: {kind: string; entity_id: string}) => record.kind === 'flex_adoption' && record.entity_id === runningId,
  );
  expect(endedRecord?.payload).toEqual(expect.objectContaining({decided_by: 'developer', end_reason: '合成の清算期間境界で終了'}));
  // The server no longer offers an end for it, and the screen offers none.
  const endable = (await listingOf()).adoptions.filter((row) => row.actions.end.allowed).length;
  expect(endable).toBe(after.adoptions.filter((row) => row.actions.end.allowed).length - 1);
  await expect(endTask.getByLabel('終了する採用').getByRole('option')).toHaveCount(endable + 1);
  await expect(endTask.getByRole('list', {name: '終了できない採用'})).toContainText(`終了確認 ${info.project.name} ${width}`);

  // The settlement the server computes is what the section shows.
  const settlementsResponse = await page.request.get(`${API}/planning/compliance/flex-settlements${QUERY}`);
  expect(settlementsResponse.status()).toBe(200);
  const settlements = (await settlementsResponse.json()) as {input_hash: string; people: Array<{name: string; settlements: unknown[]}>; findings: unknown[]};
  expect(settlements).toEqual(expect.objectContaining({input_hash: expect.any(String), people: expect.any(Array), findings: expect.any(Array)}));
  const settled = settlements.people.filter((person) => person.settlements.length > 0);
  if (settled.length === 0) await expect(page.getByText('清算の対象となる実績はまだありません。', {exact: true})).toBeVisible();
  else for (const person of settled) await expect(page.getByRole('region', {name: '職員別・清算期間別の清算'}).getByRole('row').filter({hasText: person.name})).not.toHaveCount(0);
});

type ActualRow = {external_id: string; revision: number; reviewed: boolean; duty: {duty_id: string; relationship_id: string; work: Array<{start: string; end: string}>}};
type ActualContext = {role: string; can_correct_actuals: boolean; actuals: ActualRow[]; employments: Array<{revision_id: string; relationship_id: string}>; records: Array<{kind: string; entity_id: string; revision: number; payload: Record<string, unknown>}>};

matrix('ideal-deep-u23-actuals', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/governance/actuals', 'ガバナンス');
  const origin = new URL(page.url()).origin;
  const surface = page.locator('.ideal-confirm');
  const registered = page.getByRole('region', {name: '登録済みの実績'});
  const contextOf = async () => {
    const response = await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as ActualContext;
  };
  const clockOf = (context: ActualContext) => context.actuals.find((item) => item.external_id === 'synthetic-clock')!;
  const termsOf = (context: ActualContext, dutyId: string) => context.records.find((item) => item.kind === 'work_terms' && item.entity_id === dutyId);
  const posted = (path: RegExp) => page.waitForResponse((response) => response.request().method() === 'POST' && path.test(response.url()));
  let dialogs = 0;
  page.on('dialog', (dialog) => { dialogs += 1; void dialog.dismiss(); });
  const context = await contextOf();
  const actual = clockOf(context);
  expect(context).toMatchObject({role: 'ADMIN', can_correct_actuals: true});
  expect(actual).toMatchObject({revision: 1, reviewed: false});
  const terms = termsOf(context, actual.duty.duty_id)?.payload ?? {
    duty_id: actual.duty.duty_id,
    employment_revision_id: context.employments.find((item) => item.relationship_id === actual.duty.relationship_id)!.revision_id,
    scheduled_work: actual.duty.work,
  };

  // First the state, the next step and the history. No form is open.
  for (const name of ['現在の状態', '次の操作', '履歴']) await expect(page.getByRole('heading', {level: 2, name, exact: true})).toBeVisible();
  await expect(registered.getByRole('row').filter({hasText: '第1版'}).filter({hasText: '未記録'})).toHaveCount(1);
  await expect(page.getByText(/サーバーが返したあなたの権限：部署管理者。実績の取込・記録・訂正と、照合内容の記録ができます。/)).toBeVisible();
  await expect(page.getByLabel('実績原本ファイル')).toBeHidden();
  await expect(page.getByRole('link', {name: '監査の履歴を開く'})).toBeVisible();

  // The import opens from the next step. The server finds the row errors; nothing is saved.
  const importTask = await openTask(page, '実績原本のファイルを取り込む');
  const invalid = JSON.stringify({format: 'pharmshift-actuals-v1', events: [{}, {}]});
  await importTask.getByLabel('実績原本ファイル').setInputFiles({name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(invalid)});
  await importTask.getByRole('button', {name: '原本と保存済み実績を照合する', exact: true}).click();
  await expect(importTask.getByRole('list', {name: '実績原本の行別エラー'}).getByRole('listitem')).toHaveCount(2);
  await expect(surface).toHaveCount(0);

  // Another file replaces the first without a dialog; the server's check is then confirmed.
  const body = JSON.stringify({format: 'pharmshift-actuals-v1', events: [{external_id: actual.external_id, revision: actual.revision + 1, duty: actual.duty, work_terms: terms}]});
  await importTask.getByLabel('実績原本ファイル').setInputFiles({name: `actual-${info.project.name}-${width}.json`, mimeType: 'application/json', buffer: Buffer.from(body)});
  await expect(importTask.getByRole('list', {name: '実績原本の行別エラー'})).toHaveCount(0);
  let attempts = 0;
  let first = '';
  await page.route('**/actual-import/commit?*', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      first = route.request().postData() ?? '';
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else {
      expect(route.request().postData()).toBe(first);
      await route.continue();
    }
  });
  await importTask.getByRole('button', {name: '原本と保存済み実績を照合する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '2. 取込前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface).toContainText('1行目 Person 0');
  await expect(surface).toContainText('第1版 → 第2版');
  await expect(surface).toContainText('誰にも通知されません。');
  await expect(surface).toContainText('全件を保存するか、1件も保存しないかのどちらかで、一部だけが保存されることはありません。');
  expect(attempts).toBe(0);
  // The task with its confirmation is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u23-actuals-confirmation', width);
  // The server saves, the response is lost: the outcome is unknown and the identical body goes out again.
  await surface.getByRole('button', {name: 'この内容で取り込む', exact: true}).click();
  await expect(surface).toContainText('結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます');
  await surface.getByRole('button', {name: '同じ内容を再送する', exact: true}).click();
  await expect(importTask.getByRole('status')).toContainText('1件を保存しました');
  expect(attempts).toBe(2);
  expect(JSON.parse(first)).toMatchObject({expected_revision: 0, payload: {source_text: body}});
  await expect(surface).toHaveCount(0);
  await page.unroute('**/actual-import/commit?*');
  // The list is the server's next read: one new revision, although two requests were sent.
  await expect(registered.getByRole('row').filter({hasText: '第2版'}).filter({hasText: '未記録'})).toHaveCount(1);
  expect(clockOf(await contextOf())).toMatchObject({revision: 2, reviewed: false});

  // A correction of the registered actual, confirmed before it is saved.
  const correct = await openTask(page, '登録済みの実績を訂正する');
  await correct.getByLabel('訂正する実績').selectOption('synthetic-clock');
  await expect(correct.getByRole('heading', {name: '2. 実労働・休憩・所定労働と雇用条件を入力する', exact: true})).toBeFocused();
  const revisedEnd = new Date(new Date(actual.duty.work[0].end).getTime() + (width + 1) * 1000);
  const revisedLocalEnd = new Date(revisedEnd.getTime() + 9 * 3600_000).toISOString().slice(0, 19);
  await correct.getByLabel('実労働1 終了', {exact: true}).fill(revisedLocalEnd);
  await correct.getByRole('button', {name: '保存内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 保存前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('第2版 → 第3版');
  await expect(surface).toContainText('誰にも通知されません。');
  const saving = posted(/\/planning\/compliance\/actual-events\?/);
  await surface.getByRole('button', {name: 'この内容で保存する', exact: true}).click();
  const saved = await saving;
  expect(saved.status()).toBe(200);
  const savedBody = saved.request().postDataJSON() as {expected_revision: number; payload: {revision: number; duty: {end: string; work: Array<{end: string}>}; expected_work_terms_revision: number}};
  expect(savedBody).toMatchObject({expected_revision: 2, payload: {revision: 3, duty: {end: revisedEnd.toISOString(), work: [{end: revisedEnd.toISOString()}]}}});
  await expect(correct.getByRole('status')).toContainText('実績を第3版として保存し、所定区分も保存しました。');
  await expect(correct.getByRole('link', {name: '計画の入力に反映する'})).toBeVisible();
  await expect(registered.getByRole('row').filter({hasText: '第3版'}).filter({hasText: '未記録'})).toHaveCount(1);
  expect(dialogs).toBe(0);

  // A reconciliation note, confirmed first. Meanwhile the actual is corrected again (the same
  // administrator, through the API): the note meets a conflict and is reviewed before it is
  // recorded against the revision the server holds now.
  const review = await openTask(page, '照合内容を記録する');
  await review.getByLabel('照合する実績').selectOption('synthetic-clock');
  const reason = `合成実績の照合 ${info.project.name} ${width}`;
  await review.getByLabel('照合内容・差異の理由').fill(reason);
  await review.getByRole('button', {name: '記録内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 記録前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('照合の記録：未記録 → 第3版に対する記録を1件追加');
  await expect(surface).toContainText('実績は第3版のままです。照合の記録を1件追加します。');
  await expect(surface).toContainText('誰にも通知されません。');
  const current = await contextOf();
  const stale = clockOf(current);
  const staleTerms = termsOf(current, stale.duty.duty_id)!;
  const correction = await page.request.post(`${API}/planning/compliance/actual-events${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 3, idempotency_key: `u23-concurrent-${info.project.name}-${width}`, payload: {external_id: 'synthetic-clock', revision: 4, duty: stale.duty, work_terms: staleTerms.payload, expected_work_terms_revision: staleTerms.revision}},
  });
  expect(correction.status()).toBe(200);
  const refusedNote = posted(/\/planning\/compliance\/actual-reviews\?/);
  await surface.getByRole('button', {name: 'この照合内容を記録する', exact: true}).click();
  expect((await refusedNote).status()).toBe(409);
  await expect(surface).toContainText('現在の版は第4版です。編集中の内容は保持しています。自動では統合しません。');
  await expect(surface.getByRole('region', {name: '三つの内容の比較'}).getByRole('row').filter({hasText: '実績の版'})).toContainText('第3版第4版第3版');
  await expect(surface.getByRole('button', {name: 'この照合内容を記録する', exact: true})).toBeDisabled();
  await surface.getByRole('button', {name: '三つの内容を確認し、現在の版に対して確認し直す', exact: true}).click();
  await expect(surface).toContainText('現在の第4版に対する記録として確認し直します。');
  const noted = posted(/\/planning\/compliance\/actual-reviews\?/);
  await surface.getByRole('button', {name: 'この照合内容を記録する', exact: true}).click();
  const note = await noted;
  expect(note.status()).toBe(200);
  expect(note.request().postDataJSON()).toMatchObject({expected_revision: 4, payload: {external_id: 'synthetic-clock', reason}});
  await expect(review.getByRole('status')).toContainText('照合内容を、実績の第4版に対して記録しました。');
  await expect(registered.getByRole('row').filter({hasText: '第4版'}).filter({hasText: '現在の版に記録あり'})).toHaveCount(1);
  expect(clockOf(await contextOf())).toMatchObject({revision: 4, reviewed: true});
  expect(dialogs).toBe(0);

  // A leader is given the note and nothing else: the server says so, and refuses a correction.
  await signOut(page);
  await signIn(page, 'leader');
  await openWorkspace(page, '/workspace/governance/actuals', 'ガバナンス');
  expect(await contextOf()).toMatchObject({role: 'LEADER', can_correct_actuals: false});
  await expect(page.getByText(/サーバーが返したあなたの権限：部署責任者。照合内容の記録ができます。/)).toBeVisible();
  await expect(page.getByText('実績の取込・記録・訂正は、サーバーが管理者にだけ許可しています。あなたは照合内容を記録できます。', {exact: true})).toBeVisible();
  await expect(page.getByText('実績原本のファイルを取り込む', {exact: true})).toHaveCount(0);
  await expect(page.getByText('登録済みの実績を訂正する', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('link', {name: '監査の履歴を開く'})).toHaveCount(0);
  await expect(registered.getByRole('row').filter({hasText: '第4版'}).filter({hasText: '現在の版に記録あり'})).toHaveCount(1);
  const leaderReview = await openTask(page, '照合内容を記録する');
  await leaderReview.getByLabel('照合する実績').selectOption('synthetic-clock');
  await leaderReview.getByLabel('照合内容・差異の理由').fill(`${reason}（責任者）`);
  await leaderReview.getByRole('button', {name: '記録内容を確認する', exact: true}).click();
  await expect(surface).toContainText('照合の記録：現在の版に記録あり → 第4版に対する記録を1件追加');
  const leaderNoted = posted(/\/planning\/compliance\/actual-reviews\?/);
  await surface.getByRole('button', {name: 'この照合内容を記録する', exact: true}).click();
  expect((await leaderNoted).status()).toBe(200);
  await expect(leaderReview.getByRole('status')).toContainText('照合内容を、実績の第4版に対して記録しました。');
  const forbidden = await page.request.post(`${API}/planning/compliance/actual-events${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 4, idempotency_key: `u23-leader-${info.project.name}-${width}`, payload: {external_id: 'synthetic-clock', revision: 5, duty: stale.duty, work_terms: staleTerms.payload, expected_work_terms_revision: staleTerms.revision}},
  });
  expect(forbidden.status()).toBe(403);
  expect(dialogs).toBe(0);
});

type OutsideRow = {entity_id: string; revision: number; payload: {person_id: string; status: string; review_evidence: {reference: string; verified_by: string | null} | null}; actions: {change: {allowed: boolean; refusal: string | null}}};

matrix('ideal-deep-u24-outside', async (page, info, width) => {
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/requests/outside', '申請');
  const origin = new URL(page.url()).origin;
  const saveResponse = () => page.waitForResponse((response) => response.request().method() === 'POST' && /\/planning\/compliance\/outside-declarations\?/.test(response.url()));
  const declarationOf = async (declarationId: string) => {
    const response = await page.request.get(`${API}/planning/compliance/declaration-context${QUERY}`);
    expect(response.status()).toBe(200);
    return ((await response.json()).declarations as OutsideRow[]).find((row) => row.entity_id === declarationId);
  };
  const surface = page.locator('.ideal-confirm');
  const current = page.getByRole('region', {name: '現在の申告'});

  // First the state, the next step and the history. No form is open; the comparison is not offered.
  for (const name of ['現在の状態', '次の操作', '履歴']) await expect(page.getByRole('heading', {level: 2, name, exact: true})).toBeVisible();
  await expect(page.getByText('現在の申告はありません。', {exact: true})).toBeVisible();
  await expect(page.getByLabel('編集する対象')).toBeHidden();
  await expect(page.getByText('申告を他社資料と照合する（管理者）', {exact: true})).toHaveCount(0);
  await expect(page.getByText(/この画面が受け取るのは現在の版だけ/)).toBeVisible();

  // The task opens from the next step.
  await page.getByText('申告を登録・訂正する', {exact: true}).click();
  await page.getByLabel('編集する対象').selectOption('new');
  await page.getByRole('combobox', {name: '他の雇用主・活動先', exact: true}).selectOption({index: 1});
  await page.getByRole('combobox', {name: '申告する事業場', exact: true}).selectOption({index: 1});
  await page.getByLabel('適用開始（日本時間）', {exact: true}).fill('2026-01-01T00:00');
  await page.getByLabel('適用終了（日本時間）', {exact: true}).fill('2027-01-01T00:00');
  await page.getByRole('button', {name: '所定労働の区間を追加', exact: true}).click();
  await page.getByLabel('所定労働の開始 1', {exact: true}).fill('2026-01-06T09:00');
  await page.getByLabel('所定労働の終了 1', {exact: true}).fill('2026-01-06T12:00');
  await page.getByRole('checkbox', {name: 'この期間の労働区間をすべて記載した', exact: true}).check();
  const reference = `合成申告原本 ${info.project.name} ${width}`;
  await page.getByLabel('契約・所定時間・所定外時間の照合資料').fill(reference);
  let sentCount = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && /\/planning\/compliance\/outside-declarations\?/.test(request.url())) sentCount += 1; });
  await page.getByRole('button', {name: '保存内容を確認する', exact: true}).click();

  // Nothing is sent before the confirmation, which says the four things.
  await expect(surface.getByRole('heading', {name: '3. 保存前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface).toContainText(`照合資料：（なし） → ${reference}`);
  await expect(surface).toContainText('状態：（なし） → 照合待ち');
  await expect(surface).toContainText('新規登録（第1版を作成）');
  await expect(surface).toContainText('誰にも通知されません。');
  expect(sentCount).toBe(0);
  // The task with its confirmation is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u24-outside-confirmation', width);
  const created = saveResponse();
  await surface.getByRole('button', {name: 'この内容で保存する', exact: true}).click();
  const first = await created;
  expect(first.status()).toBe(200);
  expect(await first.json()).toMatchObject({revision: 1, status: 'SUBMITTED'});
  const sent = first.request().postDataJSON() as {expected_revision: number; payload: Record<string, unknown> & {declaration_id: string}};
  expect(sent.expected_revision).toBe(0);
  expect(sent.payload).toMatchObject({person_id: 'p1', status: 'SUBMITTED', review_evidence: null, work_report_complete: true, scheduled_work: [{start: '2026-01-06T00:00:00.000Z', end: '2026-01-06T03:00:00.000Z'}]});
  await expect(page.getByText('申告を第1版として記録しました（照合待ち）。', {exact: true})).toBeVisible();
  await expect(surface).toHaveCount(0);
  const declaration = sent.payload.declaration_id;
  // The list is the server's next read.
  await expect(current.getByRole('row').filter({hasText: '照合待ち'}).filter({hasText: '第1版'})).toHaveCount(1);
  expect(await declarationOf(declaration)).toMatchObject({revision: 1, payload: {person_id: 'p1', status: 'SUBMITTED'}, actions: {change: {allowed: true, refusal: null}}});
  // The person cannot record the comparison: the server refuses it.
  const selfReview = await page.request.post(`${API}/planning/compliance/outside-declarations${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 1, idempotency_key: `u24-self-review-${info.project.name}-${width}`, payload: {...sent.payload, status: 'REVIEWED', review_evidence: {reference: 'self', status: 'verified', verified_by: 'self', valid_until: null}}},
  });
  expect(selfReview.status()).toBe(403);

  await signOut(page);
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/requests/outside', '申請');
  const outsideEvents = async () => {
    const response = await page.request.get(`${API}/planning/audit-timeline${QUERY}&category=compliance&limit=200`);
    expect(response.status()).toBe(200);
    return ((await response.json()).entries as Array<{kind: string; version: number | null; actor_role: string | null}>).filter((entry) => entry.kind === 'compliance.outside_declaration');
  };
  const notificationCount = async () => ((await (await page.request.get(`${API}/planning/notifications${QUERY}`)).json()) as unknown[]).length;
  const eventsBefore = await outsideEvents();
  expect(eventsBefore[0]).toMatchObject({version: 1, actor_role: 'PHARMACIST'});
  const notificationsBefore = await notificationCount();
  // The administrator is given the person's declaration and the comparison.
  await expect(current.getByRole('row').filter({hasText: '照合待ち'}).filter({hasText: '第1版'})).toHaveCount(1);
  await page.getByText('申告を他社資料と照合する（管理者）', {exact: true}).click();
  await page.getByLabel('照合する申告').selectOption(declaration);
  const weekly = page.getByRole('region', {name: '週別の単純合計（月曜始まり・日本時間）'});
  await expect(weekly.getByRole('row').filter({hasText: '2026-01-05'})).toContainText('3時間0分');
  await expect(page.getByText(/労働時間の通算や法令上の判定ではありません/)).toBeVisible();
  await page.getByLabel('照合根拠', {exact: true}).fill('合成管理者による原本照合。実施設の証拠ではない。');
  await page.getByRole('button', {name: '判断の内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 記録前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('状態：照合待ち → 確認済み');
  await expect(surface).toContainText('照合担当者：（なし） → サインイン中の管理者（サーバーが記録）');
  await expect(surface).toContainText('第1版 → 第2版');
  await expect(surface).toContainText('誰にも通知されません。');
  expect(sentCount).toBe(1);
  const decided = saveResponse();
  await surface.getByRole('button', {name: 'この判断を記録する', exact: true}).click();
  const second = await decided;
  expect(second.status()).toBe(200);
  expect(await second.json()).toMatchObject({revision: 2, status: 'REVIEWED'});
  expect((second.request().postDataJSON() as {expected_revision: number}).expected_revision).toBe(1);
  await expect(page.getByText('照合判断を第2版として記録しました（確認済み）。', {exact: true})).toBeVisible();
  await expect(current.getByRole('row').filter({hasText: '確認済み'}).filter({hasText: '第2版'})).toHaveCount(1);

  const recordResponse = await page.request.get(`${API}/planning/compliance/records${QUERY}`);
  const record = (await recordResponse.json()).find((item: {entity_id: string}) => item.entity_id === declaration);
  expect(record.payload.person_id).toBe('p1');
  expect(record.payload.status).toBe('REVIEWED');
  // The reviewer is the signed-in administrator, whatever the browser sent.
  expect(record.payload.review_evidence.verified_by).toBe('admin');
  // Each save is one audit event with its version; nobody is notified of them.
  const events = await outsideEvents();
  expect(events).toHaveLength(eventsBefore.length + 1);
  expect(events[0]).toMatchObject({kind: 'compliance.outside_declaration', version: 2, actor_role: 'ADMIN'});
  expect(await notificationCount()).toBe(notificationsBefore);

  // The reviewed declaration is closed to the person by the server; the screen says so in
  // the server's words and offers no change of it.
  await signOut(page);
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/requests/outside', '申請');
  const refusal = '照合済みの申告は本人では変更・取り下げできません。終了日などの訂正は管理者に依頼してください。';
  expect(await declarationOf(declaration)).toMatchObject({revision: 2, actions: {change: {allowed: false, refusal}}});
  await expect(page.getByText(refusal).first()).toBeVisible();
  await page.getByText('申告を取り下げる', {exact: true}).click();
  await expect(page.getByText('取り下げられる申告はありません。', {exact: true})).toBeVisible();
  await expect(page.getByRole('list', {name: '取り下げられない申告'})).toContainText(refusal);
  const withdrawal = await page.request.post(`${API}/planning/compliance/outside-declarations${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 2, idempotency_key: `u24-self-withdraw-${info.project.name}-${width}`, payload: {...record.payload, status: 'WITHDRAWN', review_evidence: null}},
  });
  expect(withdrawal.status()).toBe(422);
  expect((await withdrawal.json()).detail).toBe(refusal);
});

type PrivacyCase = {case_id: string; revision: number; status: string; payload: {person_id: string; kind: string; reason: string}; allowed_next: string[]; result_reference_required: string[]};
type RetentionRuleRow = {key: string; revision: number; payload: {category: string; anchor: string; retention_days: number; evidence: {status: string; verified_by: string | null}}};
type CopyPreviewAnswer = {plan_id: string; revision: number; targets: Array<{copy_id: string; medium: string; blockers: string[]; will_process: boolean}>};
type PrivacyListing = {cases: PrivacyCase[]; rules: RetentionRuleRow[]; holds: Array<{hold_id: string; active: boolean; person_id: string | null}>; people: Array<{person_id: string; name: string}>};
type SubjectControl = {person_id: string; revision: number; state: string; applicable_cases: Array<{case_id: string; revision: number; reason: string}>; inventory: {targets: Array<{copy_id: string; revision: number; state: string; medium: string; blockers: string[]; will_process: boolean}>}};
const PRIVACY_TASKS = {
  request: '個人情報の開示・訂正・利用停止・消去を請求する',
  decide: '請求を判断する',
  rule: '保存規則を改定する',
  copies: '職員ごとのコピーの残存を確認し、消去可能分を実行する',
  hold: '法的保全を記録・解除する',
  control: '承認済みの消去請求に人物制御を適用する',
  plan: '人物制御後の消去計画を作成し、実行可能分を消去する',
} as const;
const PRIVACY_STATUS: Record<string, string> = {REQUESTED: '受付', VERIFIED: '本人確認済み', APPROVED: '実施承認', COMPLETED: '実施完了', REJECTED: '理由を付して不承認', RELEASED: '利用停止を解除'};

matrix('ideal-deep-u25-privacy-erasure', async (page, info, width) => {
  const accessReason = `開示対象 ${info.project.name} ${width}`;
  const eraseReason = `消去対象 ${info.project.name} ${width}`;
  const surface = page.locator('.ideal-confirm');
  let dialogs = 0;
  page.on('dialog', (dialog) => { dialogs += 1; void dialog.dismiss(); });
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/governance/privacy?person=p-erasure', 'ガバナンス');
  const origin = new URL(page.url()).origin;
  const listingOf = async () => {
    const response = await page.request.get(`${API}/planning/compliance/privacy${QUERY}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as PrivacyListing;
  };
  const controlOf = async () => {
    const response = await page.request.get(`${API}/planning/compliance/subject-controls/p-erasure${QUERY}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as SubjectControl;
  };
  const posted = (path: RegExp) => page.waitForResponse((response) => response.request().method() === 'POST' && path.test(response.url()));
  const requests = page.getByRole('region', {name: '本人対応の請求'});

  // First the state, the next step and the history. No form is open; nothing an
  // administrator's task needs has been read.
  for (const name of ['現在の状態', '次の操作', '履歴']) await expect(page.getByRole('heading', {level: 2, name, exact: true})).toBeVisible();
  await expect(page.getByText('請求の対象として選択中の職員：合成消去対象。この職員の請求を、管理者として代わりに出せます。', {exact: true})).toBeVisible();
  await expect(page.getByText('この部署の請求はありません。', {exact: true})).toBeVisible();
  await expect(page.getByLabel('請求の種類')).toBeHidden();
  await expect(page.getByRole('link', {name: '監査の履歴を開く'})).toBeVisible();

  // The administrator files two requests for the person the URL names. Each is confirmed
  // first; the answer to the second is lost on the way, and the identical request is resent.
  const request = await openTask(page, PRIVACY_TASKS.request);
  const file = async (kind: 'access' | 'erase', reason: string, lose: boolean) => {
    await request.getByLabel('請求の種類').selectOption(kind);
    await request.getByLabel('対象と理由').fill(reason);
    await request.getByRole('button', {name: '請求の内容を確認する', exact: true}).click();
    await expect(surface.getByRole('heading', {name: '2. 請求前の確認', exact: true})).toBeFocused();
    await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
    await expect(surface).toContainText('請求の対象：（なし） → 合成消去対象');
    await expect(surface).toContainText('新規登録（第1版を作成）');
    await expect(surface).toContainText('誰にも通知されません。');
    const bodies: Array<string | null> = [];
    if (lose) {
      let first = true;
      await page.route(/\/planning\/compliance\/privacy\/requests\?/, async (route) => {
        bodies.push(route.request().postData());
        if (!first) return route.continue();
        first = false;
        // The server records the request; the browser never sees the answer.
        await route.fetch();
        await route.abort('connectionreset');
      });
      await surface.getByRole('button', {name: 'この内容で請求する', exact: true}).click();
      await expect(surface).toContainText('結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます');
    }
    const saved = posted(/\/planning\/compliance\/privacy\/requests\?/);
    await surface.getByRole('button', {name: lose ? '同じ内容を再送する' : 'この内容で請求する', exact: true}).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    if (lose) {
      await page.unroute(/\/planning\/compliance\/privacy\/requests\?/);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
    }
    await expect(request.getByText(/請求を受け付けました（第1版・受付）。/)).toBeVisible();
    await expect(surface).toHaveCount(0);
    return (await response.json()).case_id as string;
  };
  const accessCase = await file('access', accessReason, false);
  const eraseCase = await file('erase', eraseReason, true);
  // The resend was answered from the server's receipt: there are exactly two requests.
  expect((await listingOf()).cases.map((item) => [item.payload.person_id, item.payload.kind, item.status]).sort()).toEqual([['p-erasure', 'access', 'REQUESTED'], ['p-erasure', 'erase', 'REQUESTED']]);
  await expect(requests.getByRole('row').filter({hasText: eraseReason}).filter({hasText: '合成消去対象'}).filter({hasText: '受付'})).toHaveCount(1);

  // A decision is chosen among those the server lists for the request, with the identity
  // evidence, and confirmed before it is recorded.
  const decide = await openTask(page, PRIVACY_TASKS.decide);
  const decision = async (caseId: string, status: string) => {
    const before = (await listingOf()).cases.find((item) => item.case_id === caseId)!;
    await decide.getByLabel('判断する請求').selectOption(caseId);
    await expect(decide.getByLabel('次の判断').getByRole('option')).toHaveText(['選んでください', ...before.allowed_next.map((next) => PRIVACY_STATUS[next])]);
    await decide.getByLabel('次の判断').selectOption(status);
    await expect(decide.getByLabel(before.result_reference_required.includes(status) ? '実施結果の参照（この判断では必須）' : '実施結果の参照（任意）')).toBeVisible();
    await decide.getByLabel('判断理由').fill(`合成判断 ${status}`);
    await decide.getByLabel('本人確認の根拠').fill('synthetic-identity-proof');
    await decide.getByLabel('本人確認者').fill('synthetic-reviewer');
    await decide.getByRole('button', {name: '判断の内容を確認する', exact: true}).click();
    await expect(surface.getByRole('heading', {name: '3. 記録前の確認', exact: true})).toBeFocused();
    await expect(surface).toContainText(`状態：${PRIVACY_STATUS[before.status]} → ${PRIVACY_STATUS[status]}`);
    await expect(surface).toContainText(`第${before.revision}版 → 第${before.revision + 1}版`);
    return before;
  };
  const record = async (status: string, revision: number) => {
    const saved = posted(/\/planning\/compliance\/privacy\/cases\/[^/]+\?/);
    await surface.getByRole('button', {name: 'この判断を記録する', exact: true}).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    await expect(decide.getByText(`判断を記録しました（第${revision}版・${PRIVACY_STATUS[status]}）。`, {exact: true})).toBeVisible();
  };
  await decision(accessCase, 'VERIFIED');
  await record('VERIFIED', 2);
  // While a rejection of the erasure is being confirmed, the same administrator records its
  // identity check through the API: the screen meets a conflict, shows the three contents
  // and, only after the review, confirms again against the revision the server holds now.
  await decision(eraseCase, 'REJECTED');
  const concurrent = await page.request.post(`${API}/planning/compliance/privacy/cases/${eraseCase}${QUERY}`, {
    headers: {Origin: origin},
    data: {expected_revision: 1, idempotency_key: `u25-concurrent-${info.project.name}-${width}`, payload: {expected_revision: 1, status: 'VERIFIED', reason: '合成判断 VERIFIED（API）', result_reference: null, identity_evidence: {reference: 'synthetic-identity-proof', status: 'verified', verified_by: 'synthetic-reviewer'}}},
  });
  expect(concurrent.status()).toBe(200);
  const refused = posted(/\/planning\/compliance\/privacy\/cases\/[^/]+\?/);
  await surface.getByRole('button', {name: 'この判断を記録する', exact: true}).click();
  expect((await refused).status()).toBe(409);
  await expect(surface).toContainText('現在の版は第2版です。編集中の内容は保持しています。自動では統合しません。');
  await expect(surface.getByRole('region', {name: '三つの内容の比較'}).getByRole('row').filter({hasText: '状態'})).toContainText('受付本人確認済み理由を付して不承認');
  await expect(surface.getByRole('button', {name: 'この判断を記録する', exact: true})).toBeDisabled();
  await surface.getByRole('button', {name: '三つの内容を確認し、現在の版に対して確認し直す', exact: true}).click();
  await expect(surface).toContainText('現在の第2版に対する判断として確認し直します。');
  await expect(surface).toContainText('第2版 → 第3版');
  await expect(surface.getByRole('button', {name: 'この判断を記録する', exact: true})).toBeEnabled();
  // The administrator does not reject after all: back to the entry, which is discarded.
  await surface.getByRole('button', {name: '入力に戻る', exact: true}).click();
  await expect(decide.getByLabel('判断理由')).toHaveValue('合成判断 REJECTED');
  await decide.getByRole('button', {name: '入力を破棄する', exact: true}).click();
  await expect(surface).toHaveCount(0);
  expect((await listingOf()).cases.find((item) => item.case_id === eraseCase)).toMatchObject({status: 'VERIFIED', revision: 2});
  await decision(eraseCase, 'APPROVED');
  await record('APPROVED', 3);
  expect((await listingOf()).cases.find((item) => item.case_id === eraseCase)).toMatchObject({status: 'APPROVED', revision: 3, allowed_next: ['COMPLETED', 'RELEASED'], result_reference_required: ['COMPLETED']});
  await expect(requests.getByRole('row').filter({hasText: eraseReason}).filter({hasText: '実施承認'}).filter({hasText: '第3版'})).toHaveCount(1);

  // A retention rule is revised on its own confirmation: the rule of the control records
  // (the erasure below does not count from it) goes from the first version to the second,
  // and no other rule changes.
  const ruleOf = (listing: PrivacyListing, category: string, anchor: string) => listing.rules.filter((item) => item.payload.category === category && item.payload.anchor === anchor).sort((left, right) => right.revision - left.revision)[0];
  const rulesBefore = await listingOf();
  const controlRule = ruleOf(rulesBefore, 'control', 'case_closed');
  expect(controlRule).toMatchObject({revision: 1, payload: {retention_days: 365}});
  const rule = await openTask(page, PRIVACY_TASKS.rule);
  await rule.getByLabel('対象データ種別').selectOption('control');
  await rule.getByLabel('保存期間の起算').selectOption('case_closed');
  await rule.getByRole('button', {name: 'この規則の内容を入力する', exact: true}).click();
  await expect(rule.getByRole('heading', {name: '2. 規則と根拠を入力する', exact: true})).toBeFocused();
  await expect(rule.getByText(/消去・保全・復元制御・本人対応の終了：現在は第1版です。/)).toBeVisible();
  // The entries start from the rule the server holds.
  await expect(rule.getByLabel('保存日数', {exact: true})).toHaveValue('365');
  await rule.getByLabel('保存日数', {exact: true}).fill('400');
  await rule.getByLabel('保存根拠の確認者').fill('synthetic-reviewer');
  await rule.getByLabel('今回の適用範囲・期間・根拠を確認した').check();
  await rule.getByRole('button', {name: '改定の内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 改定前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface).toContainText('保存日数：365日 → 400日');
  await expect(surface).toContainText('第1版 → 第2版');
  await expect(surface).toContainText('誰にも通知されません。改定の記録（規則の版・操作者・時刻）は監査の履歴に残ります。');
  await expect(surface).toContainText('規則を登録しても、記録は自動では消去されません。');
  expect(ruleOf(await listingOf(), 'control', 'case_closed').revision).toBe(1);
  const ruleSaved = posted(/\/planning\/compliance\/retention-rules\?/);
  await surface.getByRole('button', {name: 'この内容で改定を記録する', exact: true}).click();
  const ruleResponse = await ruleSaved;
  expect(ruleResponse.status()).toBe(200);
  expect(ruleResponse.request().postDataJSON()).toMatchObject({expected_revision: 1, payload: {category: 'control', anchor: 'case_closed', retention_days: 400, evidence: {status: 'verified', verified_by: 'synthetic-reviewer'}}});
  expect(await ruleResponse.json()).toMatchObject({revision: 2});
  await expect(rule.getByText('保存規則の改定を第2版として記録しました。', {exact: true})).toBeVisible();
  await expect(surface).toHaveCount(0);
  const rulesAfter = await listingOf();
  expect(ruleOf(rulesAfter, 'control', 'case_closed')).toMatchObject({revision: 2, payload: {retention_days: 400, evidence: {status: 'verified'}}});
  // The earlier version is still listed, and the rule of the compliance records is as it was.
  expect(rulesAfter.rules).toHaveLength(rulesBefore.rules.length + 1);
  expect(ruleOf(rulesAfter, 'compliance', 'last_activity')).toEqual(ruleOf(rulesBefore, 'compliance', 'last_activity'));

  // The copies of one person: a confirmation version is made, and the screen shows the
  // server's targets, its reasons and what it says it would process. It is not executed.
  const copyExecutions: string[] = [];
  const watchExecution = (request: {method(): string; url(): string}) => { if (request.method() === 'POST' && /\/planning\/compliance\/copies\/execute\?/.test(request.url())) copyExecutions.push(request.url()); };
  page.on('request', watchExecution);
  const inventoryBefore = (await controlOf()).inventory.targets;
  const copies = await openTask(page, PRIVACY_TASKS.copies);
  await copies.getByLabel('コピーを確認する職員').selectOption('p-erasure');
  await copies.getByRole('button', {name: '確認版の作成内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '2. 確認版の作成前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('コピーの確認版（消去計画）を1件作成します。確認版を作成しても、何も消去されません。');
  const previewed = posted(/\/planning\/compliance\/copies\/preview\?/);
  await surface.getByRole('button', {name: '確認版を作成する', exact: true}).click();
  const previewResponse = await previewed;
  expect(previewResponse.status()).toBe(200);
  expect(previewResponse.request().postDataJSON()).toMatchObject({expected_revision: 0, payload: {person_id: 'p-erasure'}});
  const preview = (await previewResponse.json()) as CopyPreviewAnswer;
  expect(preview.targets.length).toBeGreaterThanOrEqual(1);
  // The server states for every copy whether executing would process it.
  for (const target of preview.targets) expect(typeof target.will_process, target.copy_id).toBe('boolean');
  const toProcess = preview.targets.filter((target) => target.will_process);
  expect(toProcess.length).toBeGreaterThanOrEqual(1);
  await expect(copies.getByRole('heading', {name: '3. 対象と残存理由を確かめる', exact: true})).toBeFocused();
  await expect(copies.getByText(`確認版（第${preview.revision}版）を作成しました。`, {exact: false})).toBeVisible();
  const listed = copies.getByRole('list', {name: 'コピーの消去対象と残存理由'}).getByRole('listitem');
  await expect(listed).toHaveCount(preview.targets.length);
  // Each copy in the server's order, with where it is kept and whether it gave a reason.
  const MEDIUM: Record<string, string> = {database: 'DB記録', backup: 'バックアップ', external: '外部コピー', file: '管理ファイル'};
  for (const [index, target] of preview.targets.entries()) {
    await expect(listed.nth(index)).toContainText(`保存物 ${index + 1}（${MEDIUM[target.medium]}）：残存理由 `);
    if (target.blockers.length === 0) await expect(listed.nth(index)).toContainText('残存理由 なし'); else await expect(listed.nth(index)).not.toContainText('残存理由 なし');
  }
  await expect(copies.getByRole('term').filter({hasText: 'サーバーが処理の対象と答えたコピー'}).locator('xpath=following-sibling::dd[1]')).toHaveText(`${toProcess.length}件`);
  // The dedicated confirmation lists what the server said it would process, and nothing is sent.
  await copies.getByRole('button', {name: '取り消せない操作の確認へ進む', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '4. 取り消せない操作の確認：消去可能分の実行', exact: true})).toBeFocused();
  await expect(surface.getByRole('list', {name: '消去されるもの'}).getByRole('listitem')).toHaveCount(toProcess.length);
  await expect(surface.getByRole('button', {name: 'この確認版の消去可能分を実行する', exact: true})).toBeDisabled();
  await surface.getByRole('button', {name: '実行せずに戻る', exact: true}).click();
  await expect(surface).toHaveCount(0);
  await copies.getByRole('button', {name: '実行せずに確認版を破棄する', exact: true}).click();
  await expect(copies.getByText('この確認版は実行していません。', {exact: true})).toBeVisible();
  page.off('request', watchExecution);
  expect(copyExecutions).toEqual([]);
  // Nothing was erased or queued: the person's copies are as they were.
  const inventoryAfter = new Map((await controlOf()).inventory.targets.map((target) => [target.copy_id, target]));
  for (const target of inventoryBefore) expect([inventoryAfter.get(target.copy_id)?.revision, inventoryAfter.get(target.copy_id)?.state], target.copy_id).toEqual([target.revision, target.state]);

  // Which decision a person control accepts is the server's answer. Under a legal hold it
  // lists none, and the screen offers none; once the hold is released it lists the approved one.
  const hold = await openTask(page, PRIVACY_TASKS.hold);
  const holdOf = async (target: string, active: 'hold' | 'release', reason: string) => {
    await hold.getByLabel('対象の保全記録').selectOption(target);
    if (target === 'new') await hold.getByLabel('保全の対象').selectOption('p-erasure');
    await hold.getByLabel('保全操作').selectOption(active);
    await hold.getByLabel('判断理由').fill(reason);
    await hold.getByRole('button', {name: '保全判断の内容を確認する', exact: true}).click();
    await expect(surface.getByRole('heading', {name: '3. 記録前の確認', exact: true})).toBeFocused();
    await expect(surface).toContainText(`保全の状態：${active === 'hold' ? '（なし） → 保全中' : '保全中 → 解除済み'}`);
    const saved = posted(/\/planning\/compliance\/holds\?/);
    await surface.getByRole('button', {name: 'この保全判断を記録する', exact: true}).click();
    const response = await saved;
    expect(response.status()).toBe(200);
    await expect(hold.getByText(/保全判断を記録しました（第\d+版）。/)).toBeVisible();
    return (await response.json()).hold_id as string;
  };
  const holdId = await holdOf('new', 'hold', '合成の係争保全');
  expect((await controlOf()).applicable_cases).toEqual([]);
  const control = await openTask(page, PRIVACY_TASKS.control);
  await control.getByLabel('人物制御の対象職員').selectOption('p-erasure');
  await expect(control.getByText(/合成消去対象の人物制御：未適用（サーバーの回答）。/)).toBeVisible();
  await expect(control.getByText(/サーバーは、この職員に人物制御を適用できる判断を返していません。/)).toBeVisible();
  await expect(control.getByLabel('承認済みの消去判断')).toHaveCount(0);
  await holdOf(holdId, 'release', '合成の係争保全の解除');
  const applicable = await controlOf();
  expect(applicable).toMatchObject({revision: 0, state: 'NOT_APPLIED', applicable_cases: [{case_id: eraseCase, revision: 3, reason: eraseReason}]});

  // The person control: what remains is listed from the server's inventory, and the
  // operation is confirmed on its own surface with an explicit consent.
  await control.getByLabel('人物制御の対象職員').selectOption('');
  await control.getByLabel('人物制御の対象職員').selectOption('p-erasure');
  await expect(control.getByLabel('承認済みの消去判断').getByRole('option')).toHaveText(['選んでください', `承認済み判断 1：${eraseReason}（第3版）`]);
  await expect(control.getByRole('list', {name: '残存コピーの照合情報'}).getByRole('listitem')).toHaveCount(applicable.inventory.targets.length);
  await control.getByLabel('承認済みの消去判断').selectOption(eraseCase);
  await control.getByLabel('人物制御の実施理由').fill('隔離された専用合成人物の承認済み消去');
  await control.getByRole('button', {name: '取り消せない操作の確認へ進む', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 取り消せない操作の確認：人物制御の適用', exact: true})).toBeFocused();
  await expect(surface).toContainText('この操作では、記録もコピーも消去されません。');
  await expect(surface).toContainText('この操作は取り消せません。適用すると、サーバーは合成消去対象の職員IDを使う記録の再作成とコピーの新規登録を拒否し続けます。');
  await expect(surface).toContainText('誰にも通知されません。独立した制御サービスに、この職員の制御が登録されます。');
  await expect(surface.getByRole('button', {name: '人物制御を適用する', exact: true})).toBeDisabled();
  // The task with its irreversible confirmation is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u25-privacy-erasure-control-confirmation', width);
  await surface.getByLabel('対象の職員・適用する判断・残る記録を確認し、取り消せない人物制御の適用に同意した').check();
  const applied = posted(/\/planning\/compliance\/subject-controls\/p-erasure\?/);
  await surface.getByRole('button', {name: '人物制御を適用する', exact: true}).click();
  const appliedResponse = await applied;
  expect(appliedResponse.status()).toBe(200);
  expect(appliedResponse.request().postDataJSON()).toMatchObject({expected_revision: 0, case_id: eraseCase, case_revision: 3, reason: '隔離された専用合成人物の承認済み消去'});
  await expect(control.getByText(/人物制御を適用しました（サーバーの状態：適用済み（コピーの残存あり））。記録とコピーの消去は完了していません/)).toBeVisible();
  await expect(control.getByText(/合成消去対象の人物制御：適用済み（コピーの残存あり）（サーバーの回答）。/)).toBeVisible();
  expect(await controlOf()).toMatchObject({revision: 1, state: 'CONTROL_APPLIED_REMAINS', applicable_cases: []});

  // The erasure plan: made after its own confirmation, read as the server's list, and
  // executed on a dedicated confirmation that says what is erased and what stays.
  const plan = await openTask(page, PRIVACY_TASKS.plan);
  await plan.getByLabel('消去計画の対象職員').selectOption('p-erasure');
  await plan.getByRole('button', {name: '消去計画の作成内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '3. 消去計画の作成前の確認', exact: true})).toBeFocused();
  await expect(surface).toContainText('消去計画を1件作成します。計画を作成しても、何も消去されません。');
  const planned = posted(/\/planning\/compliance\/subject-controls\/p-erasure\/plans\?/);
  await surface.getByRole('button', {name: '消去計画を作成する', exact: true}).click();
  const plannedResponse = await planned;
  expect(plannedResponse.status()).toBe(200);
  expect(plannedResponse.request().postDataJSON()).toMatchObject({expected_revision: 1});
  await expect(plan.getByRole('heading', {name: '4. 計画の内容を確かめる', exact: true})).toBeFocused();
  const inventory = (await controlOf()).inventory;
  // What will be erased is the server's statement per copy, not derived from its reasons.
  for (const target of inventory.targets) expect(typeof target.will_process, target.copy_id).toBe('boolean');
  const erasable = inventory.targets.filter((target) => target.will_process);
  expect(erasable.length).toBeGreaterThanOrEqual(1);
  await expect(plan.getByRole('list', {name: '消去計画の対象と残存理由'}).getByRole('listitem')).toHaveCount(inventory.targets.length);
  await plan.getByRole('button', {name: '取り消せない操作の確認へ進む', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '5. 取り消せない操作の確認：消去計画の実行', exact: true})).toBeFocused();
  await expect(surface.getByRole('list', {name: '消去されるもの'}).getByRole('listitem')).toHaveCount(erasable.length);
  await expect(surface.getByRole('list', {name: '消去されるもの'}).getByRole('listitem').first()).toContainText('DB記録）：この操作で消去します');
  await expect(surface.getByRole('list', {name: '残るものと理由'})).toContainText('人物制御の記録、消去計画、消去済みの記録（再作成の防止と復元時の照合に使われます）。');
  await expect(surface).toContainText('この操作は取り消せません。消去したDB記録と、ワーカーが消去した管理ファイルは復元できません。');
  await expect(surface.getByRole('button', {name: 'この計画の実行可能分を消去する', exact: true})).toBeDisabled();
  await finishAudit(page, info, 'ideal-deep-u25-privacy-erasure-execution-confirmation', width);
  await surface.getByLabel('対象と残存理由を確認し、実行可能分だけの処理に同意した').check();
  // The server erases, the answer is lost: the outcome is unknown and the identical body goes out again.
  const executions: Array<string | null> = [];
  let lost = false;
  await page.route(/\/planning\/compliance\/subject-controls\/p-erasure\/execute\?/, async (route) => {
    executions.push(route.request().postData());
    if (lost) return route.continue();
    lost = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('connectionreset');
  });
  await surface.getByRole('button', {name: 'この計画の実行可能分を消去する', exact: true}).click();
  await expect(surface).toContainText('結果を確認できません。');
  await expect(surface).toContainText('実行されたかどうかは不明です。同じ内容を再送すると、サーバーは同じ受付として扱うため、二重には実行されません。');
  const executed = posted(/\/planning\/compliance\/subject-controls\/p-erasure\/execute\?/);
  await surface.getByRole('button', {name: '同じ内容を再送する', exact: true}).click();
  const executedResponse = await executed;
  expect(executedResponse.status()).toBe(200);
  const result = (await executedResponse.json()) as {erased_database_count: number; preserved_archive_count: number; queued_count: number; all_copies_erased: boolean};
  await page.unroute(/\/planning\/compliance\/subject-controls\/p-erasure\/execute\?/);
  expect(executions).toHaveLength(2);
  expect(executions[1]).toBe(executions[0]);
  expect(result.erased_database_count).toBeGreaterThanOrEqual(1);
  expect(result.all_copies_erased).toBe(false);
  await expect(plan.getByText(`サーバーの結果：DB記録の消去 ${result.erased_database_count}件、部分履歴の保全 ${result.preserved_archive_count}件、管理ファイルの消去待ち ${result.queued_count}件。全コピーの消去は完了していません（サーバーの回答）。残存を照合し直してください。`, {exact: true})).toBeVisible();
  await expect(surface).toHaveCount(0);
  expect(dialogs).toBe(0);

  expect(await controlOf()).toEqual(expect.objectContaining({person_id: 'p-erasure', revision: 1, state: 'CONTROL_APPLIED_REMAINS'}));
  const receiptResponse = await page.request.post(`${API}/__e2e/erasure-receipt`, {
    headers: {Origin: 'https://127.0.0.1:18541'},
  });
  expect(receiptResponse.status()).toBe(200);
  const receipt = await receiptResponse.json();
  expect(receipt).toEqual(expect.objectContaining({
    person_id: 'p-erasure',
    remaining_entities: 0,
    remaining_revisions: 0,
    subject_control_count: 1,
    reintroduction_blocked: true,
  }));
  expect(receipt.database_erasure_tombstone_count).toBeGreaterThanOrEqual(2);

  // A pharmacist is given their own requests and one task, and the server refuses the rest.
  await signOut(page);
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/governance/privacy', 'ガバナンス');
  await expect(page.getByText('あなたの請求はありません。', {exact: true})).toBeVisible();
  await expect(page.getByText(/請求の判断、保存規則の改定、法的保全、人物制御、コピーと旧勤務入力の確認と消去は、サーバーが管理者にだけ許可しています。/)).toBeVisible();
  for (const summary of [PRIVACY_TASKS.decide, PRIVACY_TASKS.hold, PRIVACY_TASKS.control, PRIVACY_TASKS.plan]) await expect(page.getByText(summary, {exact: true})).toHaveCount(0);
  await expect(page.getByRole('link', {name: '監査の履歴を開く'})).toHaveCount(0);
  const own = await openTask(page, PRIVACY_TASKS.request);
  await own.getByLabel('請求の種類').selectOption('access');
  await own.getByLabel('対象と理由').fill(`本人の開示請求 ${info.project.name} ${width}`);
  await own.getByRole('button', {name: '請求の内容を確認する', exact: true}).click();
  await expect(surface).toContainText('（あなた）');
  const ownSaved = posted(/\/planning\/compliance\/privacy\/requests\?/);
  await surface.getByRole('button', {name: 'この内容で請求する', exact: true}).click();
  const ownResponse = await ownSaved;
  expect(ownResponse.status()).toBe(200);
  expect(ownResponse.request().postDataJSON()).toMatchObject({expected_revision: 0, payload: {person_id: 'p1', kind: 'access'}});
  await expect(requests.getByRole('row').filter({hasText: `本人の開示請求 ${info.project.name} ${width}`}).filter({hasText: '受付'})).toHaveCount(1);
  const mine = await listingOf();
  expect(mine.cases.map((item) => [item.payload.person_id, item.allowed_next])).toEqual([['p1', []]]);
  expect([mine.rules, mine.holds, mine.people.map((person) => person.person_id)]).toEqual([[], [], ['p1']]);
  const forOther = await page.request.post(`${API}/planning/compliance/privacy/requests${QUERY}`, {headers: {Origin: origin}, data: {expected_revision: 0, idempotency_key: `u25-other-${info.project.name}-${width}`, payload: {person_id: 'p0', kind: 'access', reason: '他人の請求'}}});
  expect(forOther.status()).toBe(403);
  expect((await forOther.json()).detail).toBe('本人の請求だけを登録できます。');
  expect((await page.request.get(`${API}/planning/compliance/subject-controls/p-erasure${QUERY}`)).status()).toBe(403);
  const decideAsPharmacist = await page.request.post(`${API}/planning/compliance/privacy/cases/${accessCase}${QUERY}`, {headers: {Origin: origin}, data: {expected_revision: 2, idempotency_key: `u25-pharmacist-${info.project.name}-${width}`, payload: {expected_revision: 2, status: 'APPROVED', reason: '権限外', result_reference: null, identity_evidence: {reference: 'x', status: 'verified', verified_by: 'x'}}}});
  expect(decideAsPharmacist.status()).toBe(403);
  expect(dialogs).toBe(0);
});

matrix('ideal-deep-u26-recovery', async (page) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/governance/recovery', 'ガバナンス');
  await expect(page.getByRole('heading', {name: '復元先の状態'})).toBeVisible();
  await expect(page.getByText('復元実行の記録なし', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: /復元|バックアップ/})).toHaveCount(0);
  const response = await page.request.get(`${API}/planning/compliance/recovery-status${QUERY}`);
  expect(response.status()).toBe(200);
  expect((await response.json()).state).toBe('NO_RESTORE_RECORDED');

  await signOut(page);
  await signIn(page, 'pharmacist');
  await page.goto('/workspace/governance/recovery');
  await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
});

matrix('ideal-deep-u27-advanced-planning', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/plan/input', '計画');
  const refresh = page.getByRole('button', {name: '申請・実績を計画に反映'});
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(page.getByRole('status')).toContainText('最新の申請・実績を反映した入力版を作りました');
  const latestResponse = await page.request.get(`${API}/planning/inputs/latest${QUERY}`);
  expect(latestResponse.status()).toBe(200);
  const latest = await latestResponse.json();
  const picker = page.getByLabel('JSONを選ぶ');
  const changed = structuredClone(latest.snapshot) as typeof latest.snapshot;
  changed.source_revision += 1;
  await picker.setInputFiles({name: `input-${info.project.name}-${width}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed))});
  const preview = page.locator('.ideal-confirm', {hasText: `input-${info.project.name}-${width}.json`});
  await expect(preview).toContainText('既存入力は上書きせず、新しい入力版を作ります');
  await preview.getByRole('button', {name: 'この内容で登録'}).click();
  await expect(page.getByText('入力を登録しました。', {exact: true})).toBeVisible();
  const derive = page.getByRole('heading', {name: '契約・資格から勤務候補を再導出'}).locator('..');
  await derive.getByLabel(/^理由/).fill('取込後の候補を承認済み原本から再構築');
  await derive.getByLabel(/^参照/).fill(`SYNTHETIC-U27-${info.project.name}-${width}`);
  await derive.getByRole('button', {name: '新しい入力版を作る'}).click();
  await expect(derive.getByRole('status')).toContainText('新しい不変の入力版を作りました');

  await page.goto('/workspace/plan/generate');
  const queuedJobs: Array<{job_id: string; status: string}> = [];
  page.on('response', async (response) => {
    if (response.request().method() === 'POST' && /\/planning\/jobs\?/.test(response.url()) && response.status() === 202) {
      queuedJobs.push(await response.json());
    }
  });
  await page.getByRole('button', {name: '3つの案を作る'}).click();
  await expect(page.getByRole('button', {name: '中止'})).toHaveCount(3);
  await expect.poll(() => queuedJobs.length).toBe(3);
  const cancel = page.getByRole('button', {name: '中止'}).last();
  await cancel.click();
  await expect(page.getByRole('status')).toContainText('案 3 の生成を中止しました');
  const cancelledJob = await page.request.get(`${API}/planning/jobs/${queuedJobs[2].job_id}${QUERY}`);
  expect(cancelledJob.status()).toBe(200);
  expect((await cancelledJob.json()).status).toBe('CANCELLED');

  await expect(page.getByRole('button', {name: '3つの案を作る'})).toBeEnabled({timeout: 40_000});
  await page.getByRole('button', {name: '3つの案を作る'}).click();
  const compare = page.getByRole('link', {name: /3案を同じ定義で比較/});
  await expect(compare).toBeVisible({timeout: 60_000});
  await compare.click();
  const figures = page.getByRole('region', {name: '案ごとの数値'});
  const choice = figures.locator('input[type="radio"]:not(:disabled)').first();
  await expect(choice).toBeVisible();
  await choice.check();
  await page.getByRole('link', {name: /選んだ案を確認・編集/}).click();
  const draftId = new URL(page.url()).searchParams.get('draft');
  expect(draftId).toBeTruthy();
  await expect(page.getByRole('heading', {name: '割当を確認・編集'})).toBeVisible();
  const draftResponse = await page.request.get(`${API}/planning/drafts/${draftId}${QUERY}`);
  const draft = await draftResponse.json();
  const assignment = page.getByRole('region', {name: '勤務案の割当'}).getByRole('checkbox').first();
  await assignment.click();
  const concurrent = await page.request.put(`${API}/planning/drafts/${draftId}${QUERY}`, {
    headers: {Origin: new URL(page.url()).origin},
    data: {
      version: draft.version,
      proposal: draft.proposal,
      idempotency_key: `concurrent-${info.project.name}-${width}`,
    },
  });
  expect(concurrent.status()).toBe(200);
  await page.getByRole('button', {name: '編集を保存'}).click();
  await expect(page.getByRole('heading', {name: '勤務案の更新競合'})).toBeVisible();
  await page.getByRole('button', {name: '三つの勤務案を確認して編集を続ける'}).click();
  await expect(page.getByRole('heading', {name: '勤務案の更新競合'})).toHaveCount(0);
  await page.getByRole('button', {name: '編集を保存'}).click();
  await expect(page.getByText('編集を保存しました。検証は解除されています。', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'サーバーで再検証'}).click();
  await expect(page.getByText(/サーバー検証を通過しました|公開できない指摘/).last()).toBeVisible();

  await page.goto('/workspace/plan/publications');
  const cancellationReason = `合成取消 ${info.project.name} ${width}`;
  const publication = page.locator('.ideal-record-list article').first();
  await publication.getByRole('button', {name: '公開を取り消す'}).click();
  await publication.getByLabel('理由').fill(cancellationReason);
  await publication.getByRole('button', {name: '理由を記録して公開取消'}).click();
  await expect(page.getByText('公開を取り消し、通知を記録しました。', {exact: true})).toBeVisible();
  await page.goto('/workspace/settings/notifications');
  const unreadButtons = page.getByRole('button', {name: '確認しました'});
  await expect(unreadButtons.first()).toBeVisible();
  const unreadCount = await unreadButtons.count();
  expect(unreadCount).toBeGreaterThan(0);
  const unread = unreadButtons.first();
  const readResponse = page.waitForResponse((response) => response.request().method() === 'POST' && /\/planning\/notifications\/[^/]+\/read\?/.test(response.url()));
  await unread.click();
  expect((await readResponse).status()).toBe(200);
  await expect(unreadButtons).toHaveCount(unreadCount - 1);
  const notifications = await page.request.get(`${API}/planning/notifications${QUERY}`);
  expect(notifications.status()).toBe(200);
  expect((await notifications.json()).some((item: {read: boolean}) => item.read)).toBe(true);
});
