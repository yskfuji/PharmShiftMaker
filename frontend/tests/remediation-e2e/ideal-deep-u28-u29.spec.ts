import {expect, test, type Page, type TestInfo} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {allOptical, textSpacing} from '../visual/lib/optical';

const API = process.env.PHARMSHIFT_E2E_API_URL ?? 'https://127.0.0.1:18540';
const QUERY = '?scope_id=hospital%2Fpharmacy';
const WIDTHS = [320, 768, 1440] as const;

type Credentials = {user: string; password: string};
const USERS: Record<'admin' | 'leader' | 'pharmacist', Credentials> = {
  admin: {user: 'admin', password: 'pass-admin'},
  leader: {user: 'leader', password: 'pass-lead'},
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
    overflow: [...document.querySelectorAll<HTMLElement>('body *')].map((element) => {
      const rect = element.getBoundingClientRect();
      return {tag: element.tagName.toLowerCase(), className: element.className, label: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 60) ?? '', left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width)};
    }).filter((item) => item.width > 0 && (item.left < -1 || item.right > innerWidth + 1)).sort((a, b) => b.right - a.right).slice(0, 12),
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
      test.setTimeout(Number(process.env.E2E_TEST_TIMEOUT_MS ?? '180000'));
      await page.setViewportSize({width, height: 900});
      await run(page, info, width);
      await finishAudit(page, info, name, width);
    });
  }
}

type LeaveRow = {request_id: string; person_id: string; version: number; kind: string; status: string; payload: {start: string; unit?: string; quantity?: number; interval?: {start: string; end: string}}; decision?: {reference: string} | null};
const CLAIM = '年次有給休暇を請求する（日・半日・時間）';

// The synthetic leave rules of this journey allow half days and hours
// (PHARMSHIFT_E2E_PARTIAL_DAY_LEAVE=1, set for U28 only by run_ideal_deep_matrix.py).
matrix('ideal-deep-u28-partial-day-leave', async (page, info, width) => {
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/requests/leave', '申請');
  const surface = page.locator('.ideal-confirm');
  const requestsOf = async () => {
    const response = await page.request.get(`${API}/planning/requests${QUERY}`);
    expect(response.status()).toBe(200);
    return (await response.json()) as LeaveRow[];
  };
  const claimPosts: Array<{body: string | null; status: number | null}> = [];
  page.on('request', (request) => { if (request.method() === 'POST' && /\/planning\/compliance\/leave-requests\?/.test(request.url())) claimPosts.push({body: request.postData(), status: null}); });
  const claimed = () => page.waitForResponse((response) => response.request().method() === 'POST' && /\/planning\/compliance\/leave-requests\?/.test(response.url()));
  // The rule the server registered for this person says which units a claim may ask for.
  const records = await (await page.request.get(`${API}/planning/compliance/records${QUERY}`)).json() as Array<{kind: string; entity_id: string; payload: {hourly_enabled?: boolean; half_day_enabled?: boolean}}>;
  expect(records.find((row) => row.kind === 'leave_policy' && row.entity_id === 'lp1')?.payload).toMatchObject({hourly_enabled: true, half_day_enabled: true});

  await page.getByText(CLAIM, {exact: true}).click();
  const claim = page.getByRole('group', {name: CLAIM});
  await claim.getByLabel('年休付与台帳').selectOption('g1');
  // Before a rule is chosen only the day is offered; then the units the rule allows.
  await expect(claim.getByLabel('請求する単位').getByRole('option')).toHaveText(['日']);
  await claim.getByLabel('適用する年休規則').selectOption('lp1');
  await expect(claim.getByLabel('請求する単位').getByRole('option')).toHaveText(['日', '半日', '時間']);
  await claim.getByLabel('請求する単位').selectOption('hour');
  await claim.getByLabel('数量（日・半日は1、時間は取得する時間数）').fill('2');
  const reference = `合成時間単位請求 ${info.project.name} ${width}`;
  await claim.getByLabel('請求内容・根拠の参照').fill(reference);

  // A span that runs backwards is not judged in the browser: it is sent, and the server
  // refuses it in its own words. Nothing is recorded.
  await claim.getByLabel('休暇開始（日本時間）').fill('2026-01-06T15:00');
  await claim.getByLabel('休暇終了（日本時間）').fill('2026-01-06T13:00');
  await claim.getByRole('button', {name: '請求の内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '2. 請求前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface).toContainText('請求する単位：（なし） → 時間');
  await expect(surface).toContainText('数量：（なし） → 2');
  await expect(surface).toContainText('新規登録（第1版を作成）');
  await expect(surface).toContainText('誰にも通知されません。');
  expect(claimPosts).toHaveLength(0);
  const refused = claimed();
  await surface.getByRole('button', {name: 'この内容で請求する', exact: true}).click();
  const refusal = await refused;
  expect(refusal.status()).toBe(422);
  const detail = (await refusal.json()).detail as string;
  expect(detail).toContain('Use a positive half-open interval with whole-second precision');
  await expect(surface).toContainText('保存していません。サーバーが下の理由で受け付けませんでした。');
  await expect(surface.getByRole('alert')).toContainText('Use a positive half-open interval with whole-second precision');
  expect((await requestsOf()).filter((row) => row.kind === 'PAID_LEAVE_V2')).toHaveLength(0);
  // The task with its confirmation and the server's refusal is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u28-partial-day-leave-refused', width);

  // The entries are kept. With the span corrected, the first answer is lost on the way:
  // the outcome is unknown, and the identical request is sent again with the same key.
  await surface.getByRole('button', {name: '入力に戻る', exact: true}).click();
  await expect(claim.getByLabel('請求内容・根拠の参照')).toHaveValue(reference);
  await claim.getByLabel('休暇開始（日本時間）').fill('2026-01-06T13:00');
  await claim.getByLabel('休暇終了（日本時間）').fill('2026-01-06T15:00');
  await claim.getByRole('button', {name: '請求の内容を確認する', exact: true}).click();
  await expect(surface).toContainText('休暇の期間（日本時間）：（なし） → 2026-01-06 13:00 〜 2026-01-06 15:00');
  let lose = true;
  await page.route(/\/planning\/compliance\/leave-requests\?/, async (route) => {
    if (!lose) return route.continue();
    lose = false;
    // The server receives and records the claim; the browser never sees the answer.
    await route.fetch();
    await route.abort('connectionreset');
  });
  await surface.getByRole('button', {name: 'この内容で請求する', exact: true}).click();
  await expect(surface).toContainText('結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます');
  await expect(surface.getByRole('button', {name: 'この内容で請求する', exact: true})).toHaveCount(0);
  // The server did record it once; the screen does not claim so.
  expect((await requestsOf()).filter((row) => row.kind === 'PAID_LEAVE_V2')).toHaveLength(1);
  const accepted = claimed();
  await surface.getByRole('button', {name: '同じ内容を再送する', exact: true}).click();
  const answer = await accepted;
  expect(answer.status()).toBe(200);
  expect(await answer.json()).toMatchObject({status: 'PENDING', version: 1});
  await page.unroute(/\/planning\/compliance\/leave-requests\?/);
  // Three requests left the browser: the refused one, the lost one and its identical resend.
  expect(claimPosts).toHaveLength(3);
  expect(claimPosts[2].body).toBe(claimPosts[1].body);
  expect(JSON.parse(claimPosts[1].body!).idempotency_key).not.toBe(JSON.parse(claimPosts[0].body!).idempotency_key);
  expect(JSON.parse(claimPosts[2].body!)).toMatchObject({expected_revision: 0, payload: {account_id: 'g1', policy_id: 'lp1', unit: 'hour', quantity: 2, interval: {start: '2026-01-06T13:00:00+09:00', end: '2026-01-06T15:00:00+09:00'}, reference}});
  await expect(claim.getByText(/年休の請求を第1版として記録しました（確認待ち）。/)).toBeVisible();
  await expect(surface).toHaveCount(0);
  // The resend was answered from the server's receipt: there is still exactly one claim.
  const mine = (await requestsOf()).filter((row) => row.kind === 'PAID_LEAVE_V2');
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({person_id: 'p1', status: 'PENDING', version: 1, payload: {unit: 'hour', quantity: 2}});
  // The list is the server's next read: the claim with its unit and quantity.
  const own = page.getByRole('region', {name: 'あなたの申請（取下げ済みを除く）'});
  await expect(own.getByRole('row').filter({hasText: '2026-01-06 13:00 〜 2026-01-06 15:00'}).filter({hasText: '2時間'}).filter({hasText: '確認待ち'})).toHaveCount(1);

  // A half day is claimed as well: one request, accepted at once.
  await claim.getByLabel('年休付与台帳').selectOption('g1');
  await claim.getByLabel('適用する年休規則').selectOption('lp1');
  await claim.getByLabel('請求する単位').selectOption('half_day');
  await claim.getByLabel('休暇開始（日本時間）').fill('2026-01-07T09:00');
  await claim.getByLabel('休暇終了（日本時間）').fill('2026-01-07T11:00');
  await claim.getByLabel('請求内容・根拠の参照').fill(`${reference} 半日`);
  await claim.getByRole('button', {name: '請求の内容を確認する', exact: true}).click();
  await expect(surface).toContainText('請求する単位：（なし） → 半日');
  const half = claimed();
  await surface.getByRole('button', {name: 'この内容で請求する', exact: true}).click();
  expect((await half).status()).toBe(200);
  await expect(own.getByRole('row').filter({hasText: '2026-01-07 09:00'}).filter({hasText: '1回（半日）'})).toHaveCount(1);

  // The reviewer is given both claims with their units, and confirms the hourly one.
  await signOut(page);
  await signIn(page, 'leader');
  await openWorkspace(page, '/workspace/requests/leave', '申請');
  const all = page.getByRole('region', {name: '申請の一覧（現在の版）'});
  await expect(all.getByRole('row').filter({hasText: '2026-01-06 13:00 〜 2026-01-06 15:00'}).filter({hasText: '2時間'}).filter({hasText: '確認待ち'})).toHaveCount(1);
  await expect(all.getByRole('row').filter({hasText: '2026-01-07 09:00'}).filter({hasText: '1回（半日）'})).toHaveCount(1);
  await page.getByText('申請を確認する（確認待ち 2件）', {exact: true}).click();
  const review = page.getByRole('group', {name: /^申請を確認する（確認待ち \d+件）$/});
  await review.getByLabel('確認する申請').selectOption(mine[0].request_id);
  await expect(review.getByText('2時間', {exact: true})).toBeVisible();
  await review.getByLabel('判断の根拠・相談記録').fill('合成の時間単位協定と勤務影響を確認');
  await review.getByRole('button', {name: '判断の内容を確認する', exact: true}).click();
  await expect(surface).toContainText('状態：確認待ち → 確認済み');
  const decided = page.waitForResponse((response) => response.request().method() === 'POST' && /\/planning\/requests\/[^/]+\/decision\?/.test(response.url()));
  await surface.getByRole('button', {name: 'この判断を記録する', exact: true}).click();
  expect((await decided).status()).toBe(200);
  await expect(all.getByRole('row').filter({hasText: '2026-01-06 13:00 〜 2026-01-06 15:00'}).filter({hasText: '確認済み'})).toHaveCount(1);
  expect((await requestsOf()).find((row) => row.request_id === mine[0].request_id)).toMatchObject({status: 'APPROVED', version: 2, payload: {unit: 'hour', quantity: 2}, decision: {reference: '合成の時間単位協定と勤務影響を確認'}});
});

type ErasureCandidate = {input_hash: string; input_revision: number; period: {start: string; end: string}; erasable: boolean; blockers: string[]; target_count: number};
type ErasurePlan = {plan_id: string; fingerprint: string; erasable: boolean; blockers: string[]; targets: Array<{table: string; key: string}>; limitations: string[]};
const ERASE_INPUTS = '保存期限を過ぎた旧勤務入力を消去する';
const WITHIN_RETENTION = '保存期限未満または起算条件が未対応です';

// The scope of this journey holds superseded planning inputs, one of them past its retention
// (PHARMSHIFT_E2E_EXPIRED_INPUT=1, set for U29 only by run_ideal_deep_matrix.py).
matrix('ideal-deep-u29-expired-input-erasure', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/governance/privacy', 'ガバナンス');
  const origin = new URL(page.url()).origin;
  const surface = page.locator('.ideal-confirm');
  let dialogs = 0;
  page.on('dialog', (dialog) => { dialogs += 1; void dialog.dismiss(); });
  const candidatesOf = async () => {
    const response = await page.request.get(`${API}/planning/compliance/erasure-candidates${QUERY}`);
    expect(response.status()).toBe(200);
    return ((await response.json()) as {inputs: ErasureCandidate[]}).inputs;
  };
  const send = (path: string, key: string, payload: unknown) => page.request.post(`${API}/planning/compliance/${path}${QUERY}`, {headers: {Origin: origin}, data: {expected_revision: 0, idempotency_key: `${key}-${info.project.name}-${width}`, payload}});
  const posted = (path: RegExp) => page.waitForResponse((response) => response.request().method() === 'POST' && path.test(response.url()));

  // What the server says of each input: one superseded input is past its retention, one is
  // not, and the current version of every period is never erasable.
  const before = await candidatesOf();
  expect(before).toHaveLength(5);
  const expired = before.filter((item) => item.erasable);
  expect(expired).toHaveLength(1);
  const kept = before.find((item) => item.blockers.length === 1 && item.blockers[0] === WITHIN_RETENTION)!;
  expect(kept).toBeTruthy();
  expect(before.filter((item) => item.blockers.includes('現行入力として参照されています'))).toHaveLength(3);

  // The disposable schema before anything is erased: the expired input was planned with
  // once, so a finished job and the draft it produced depend on it. Without them, "what
  // refers to the input is gone" would be true before the erasure.
  const receiptOf = async (inputHash: string) => {
    const response = await page.request.post(`${API}/__e2e/input-erasure-receipt`, {headers: {Origin: origin}, data: {input_hash: inputHash}});
    expect(response.status()).toBe(200);
    return (await response.json()) as {remaining_inputs: number; remaining_drafts: number; remaining_jobs: number; unfinished_jobs: number; input_tombstones: number; executed_plans: number; plan_tombstones: number; other_inputs: number};
  };
  const stored = await receiptOf(expired[0].input_hash);
  expect(stored).toMatchObject({remaining_inputs: 1, unfinished_jobs: 0, input_tombstones: 0, executed_plans: 0, plan_tombstones: 0, other_inputs: 4});
  expect(stored.remaining_drafts).toBeGreaterThan(0);
  expect(stored.remaining_jobs).toBeGreaterThan(0);
  // The server counts them among what it would erase: the input, its job, its draft and
  // the events that name them.
  expect(expired[0].target_count).toBeGreaterThanOrEqual(1 + stored.remaining_drafts + stored.remaining_jobs);

  // The server's refusals, through the real API and before anything is erased.
  const detailOf = async (response: Awaited<ReturnType<typeof send>>) => ((await response.json()) as {detail: string}).detail;
  // A plan that does not exist is not found, whatever fingerprint comes with it.
  const unknownPlan = await send('erasure-execute', 'u29-unknown-plan', {plan_id: 'no-such-plan', fingerprint: '0'.repeat(64)});
  expect(unknownPlan.status()).toBe(404);
  expect(await detailOf(unknownPlan)).toBe('Object not found in authorized scope');
  // A real plan with another fingerprint is a conflict, and erases nothing.
  const early = await send('erasure-preview', 'u29-early-preview', {input_hash: expired[0].input_hash});
  expect(early.status()).toBe(200);
  const earlyPlan = (await early.json()) as ErasurePlan;
  expect([earlyPlan.erasable, earlyPlan.blockers]).toEqual([true, []]);
  for (const table of ['planning_inputs', 'planning_drafts', 'planning_jobs']) expect(earlyPlan.targets.filter((target) => target.table === table).length, table).toBeGreaterThan(0);
  const mismatch = await send('erasure-execute', 'u29-fingerprint-mismatch', {plan_id: earlyPlan.plan_id, fingerprint: '0'.repeat(64)});
  expect(mismatch.status()).toBe(409);
  expect(await detailOf(mismatch)).toBe('Input, version or ledger conflict; refresh and review again');
  // A legal hold placed after the preview: the plan that was erasable is refused with 409,
  // and the server no longer lists the input as erasable. Released, it is erasable again.
  const holdId = `u29-hold-${info.project.name}-${width}`;
  const hold = (expectedRevision: number, active: boolean) => page.request.post(`${API}/planning/compliance/holds${QUERY}`, {headers: {Origin: origin}, data: {expected_revision: expectedRevision, idempotency_key: `u29-hold-${active}-${info.project.name}-${width}`, payload: {hold_id: holdId, person_id: null, active, reason: active ? '合成の法的保全（確認版の作成後）' : '合成の法的保全の解除'}}});
  const placed = await hold(0, true);
  expect(placed.status()).toBe(200);
  const held = await send('erasure-execute', 'u29-held', {plan_id: earlyPlan.plan_id, fingerprint: earlyPlan.fingerprint});
  expect(held.status()).toBe(409);
  expect(await detailOf(held)).toBe('Input, version or ledger conflict; refresh and review again');
  const whileHeld = (await candidatesOf()).find((item) => item.input_hash === expired[0].input_hash)!;
  expect([whileHeld.erasable, whileHeld.blockers]).toEqual([false, [`法的保全が有効です: ${holdId}`]]);
  expect(await receiptOf(expired[0].input_hash)).toEqual(stored);
  const released = await hold(1, false);
  expect(released.status()).toBe(200);
  expect(await candidatesOf()).toEqual(before);

  // Nothing of it is on the first view; the list is read when the task is opened.
  for (const name of ['現在の状態', '次の操作', '履歴']) await expect(page.getByRole('heading', {level: 2, name, exact: true})).toBeVisible();
  await expect(page.getByLabel('確認する勤務入力')).toHaveCount(0);
  await page.getByText(ERASE_INPUTS, {exact: true}).click();
  const task = page.getByRole('group', {name: ERASE_INPUTS});
  const erasableList = task.getByRole('region', {name: 'サーバーが消去できると答えた勤務入力'});
  await expect(erasableList.getByRole('row')).toHaveCount(2);
  await expect(erasableList.getByRole('row').nth(1)).toContainText(`第${expired[0].input_revision}版`);
  await expect(erasableList.getByRole('row').nth(1)).toContainText(`${expired[0].target_count}件`);
  await expect(task.getByRole('list', {name: 'サーバーが消去できないと答えた勤務入力と理由'}).getByRole('listitem')).toHaveCount(4);
  await expect(task.getByRole('list', {name: 'サーバーが消去できないと答えた勤務入力と理由'}).getByRole('listitem').filter({hasText: new RegExp(`：${WITHIN_RETENTION}$`)})).toHaveCount(1);

  // An input within its retention: the server's plan refuses it in its own words, and the
  // screen offers no erasure. The server refuses the execution as well.
  await task.getByLabel('確認する勤務入力').selectOption(kept.input_hash);
  await task.getByRole('button', {name: '確認版の作成内容を確認する', exact: true}).click();
  await expect(surface.getByRole('heading', {name: '2. 確認版の作成前の確認', exact: true})).toBeFocused();
  await expect(surface.getByRole('term')).toHaveText(['変更内容', '作成される版', '通知', '競合・部分失敗']);
  await expect(surface).toContainText('消去の確認版（消去計画）を1件作成します。確認版を作成しても、何も消去されません。');
  await expect(surface).toContainText('誰にも通知されません。');
  const refusedPlan = posted(/\/planning\/compliance\/erasure-preview\?/);
  await surface.getByRole('button', {name: '確認版を作成する', exact: true}).click();
  const refusedResponse = await refusedPlan;
  expect(refusedResponse.status()).toBe(200);
  const refused = (await refusedResponse.json()) as ErasurePlan;
  expect([refused.erasable, refused.blockers]).toEqual([false, [WITHIN_RETENTION]]);
  await expect(task.getByRole('heading', {name: '3. サーバーの確認結果：この入力は消去できません', exact: true})).toBeFocused();
  await expect(task.getByRole('list', {name: 'サーバーが返した消去できない理由'}).getByRole('listitem')).toHaveText([WITHIN_RETENTION]);
  await expect(surface).toHaveCount(0);
  await expect(task.getByRole('button', {name: 'この旧勤務入力を消去する', exact: true})).toHaveCount(0);
  expect((await send('erasure-execute', 'u29-refused', {plan_id: refused.plan_id, fingerprint: refused.fingerprint})).status()).toBe(409);
  expect((await candidatesOf()).map((item) => item.input_hash).sort()).toEqual(before.map((item) => item.input_hash).sort());
  await task.getByRole('button', {name: '入力の選択に戻る', exact: true}).click();

  // The input past its retention: the plan, then the dedicated confirmation with the
  // server's targets, what stays, and the consent.
  await task.getByLabel('確認する勤務入力').selectOption(expired[0].input_hash);
  await task.getByRole('button', {name: '確認版の作成内容を確認する', exact: true}).click();
  const planned = posted(/\/planning\/compliance\/erasure-preview\?/);
  await surface.getByRole('button', {name: '確認版を作成する', exact: true}).click();
  const plannedResponse = await planned;
  expect(plannedResponse.status()).toBe(200);
  expect(plannedResponse.request().postDataJSON()).toMatchObject({expected_revision: 0, payload: {input_hash: expired[0].input_hash}});
  const plan = (await plannedResponse.json()) as ErasurePlan;
  expect([plan.erasable, plan.blockers]).toEqual([true, []]);
  expect(plan.targets.filter((target) => target.table === 'planning_inputs').map((target) => target.key)).toEqual([expired[0].input_hash]);
  await expect(surface.getByRole('heading', {name: '3. 取り消せない操作の確認：旧勤務入力の消去', exact: true})).toBeFocused();
  await expect(surface.getByRole('list', {name: '消去されるもの'}).getByRole('listitem').filter({hasText: 'の勤務入力：1件'})).toHaveCount(1);
  await expect(surface.getByRole('list', {name: '消去されるもの'}).getByRole('listitem')).toHaveCount(new Set(plan.targets.map((target) => target.table)).size);
  await expect(surface.getByRole('list', {name: '残るものと理由'}).getByRole('listitem').first()).toHaveText(`消去済みの記録 ${plan.targets.length}件（表・識別子・消去前の照合値だけを持ち、内容は持ちません）。`);
  for (const limitation of plan.limitations) await expect(surface.getByRole('list', {name: '残るものと理由'})).toContainText(`サーバーが返した制限事項：${limitation}`);
  await expect(surface).toContainText('この操作は取り消せません。消去した勤務入力と、それを参照する計画案・公開版・生成処理・受付記録・通知の記録は復元できません。');
  await expect(surface).toContainText('誰にも通知されません。消去の実行の記録（確認版・件数・操作者・時刻）は監査の履歴に残ります。');
  await expect(surface.getByRole('button', {name: 'この旧勤務入力を消去する', exact: true})).toBeDisabled();
  // The task with its irreversible confirmation is measured as it stands.
  await finishAudit(page, info, 'ideal-deep-u29-expired-input-erasure-confirmation', width);
  await surface.getByLabel('消去される記録と残る記録を確認し、取り消せない消去に同意した').check();

  // The server erases, the answer is lost: the outcome is unknown, and the identical
  // request goes out again with its key. The server answers it from its receipt.
  const executions: Array<string | null> = [];
  let lost = false;
  await page.route(/\/planning\/compliance\/erasure-execute\?/, async (route) => {
    executions.push(route.request().postData());
    if (lost) return route.continue();
    lost = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('connectionreset');
  });
  await surface.getByRole('button', {name: 'この旧勤務入力を消去する', exact: true}).click();
  await expect(surface).toContainText('結果を確認できません。');
  await expect(surface).toContainText('実行されたかどうかは不明です。同じ内容を再送すると、サーバーは同じ受付として扱うため、二重には実行されません。');
  // The server did erase it; the screen does not claim so yet.
  expect((await candidatesOf()).map((item) => item.input_hash)).not.toContain(expired[0].input_hash);
  const executed = posted(/\/planning\/compliance\/erasure-execute\?/);
  await surface.getByRole('button', {name: '同じ内容を再送する', exact: true}).click();
  const executedResponse = await executed;
  expect(executedResponse.status()).toBe(200);
  const result = (await executedResponse.json()) as {status: string; deleted: number; duplicate: boolean};
  await page.unroute(/\/planning\/compliance\/erasure-execute\?/);
  expect(executions).toHaveLength(2);
  expect(executions[1]).toBe(executions[0]);
  expect(JSON.parse(executions[0]!)).toMatchObject({expected_revision: 0, payload: {plan_id: plan.plan_id, fingerprint: plan.fingerprint}});
  expect(result).toMatchObject({status: 'EXECUTED', deleted: plan.targets.length, duplicate: false});
  await expect(task.getByText(`サーバーの結果：${plan.targets.length}件を消去しました（確認版の状態：実行済み）。消去した入力は、一覧から読み込めなくなりました。`, {exact: true})).toBeVisible();
  await expect(surface).toHaveCount(0);
  // The list is the server's next read: nothing is erasable any more.
  await expect(task.getByText('サーバーが消去できると答えた勤務入力はありません。', {exact: true})).toBeVisible();
  await expect(task.getByRole('list', {name: 'サーバーが消去できないと答えた勤務入力と理由'}).getByRole('listitem')).toHaveCount(4);
  expect(dialogs).toBe(0);

  // Through the API: the input is gone and cannot be read back, the others are untouched,
  // the erasure is in the audit trail, and the same plan cannot erase anything again.
  const after = await candidatesOf();
  expect(after.map((item) => item.input_hash).sort()).toEqual(before.filter((item) => item.input_hash !== expired[0].input_hash).map((item) => item.input_hash).sort());
  expect((await page.request.get(`${API}/planning/inputs/latest${QUERY}&input_hash=${expired[0].input_hash}`)).status()).toBe(404);
  expect((await page.request.get(`${API}/planning/inputs/latest${QUERY}&input_hash=${kept.input_hash}`)).status()).toBe(200);
  const again = await send('erasure-execute', 'u29-again', {plan_id: plan.plan_id, fingerprint: plan.fingerprint});
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({status: 'EXECUTED', duplicate: true});
  const gone = await send('erasure-preview', 'u29-gone', {input_hash: expired[0].input_hash});
  expect(gone.status()).toBe(404);
  const audit = await page.request.get(`${API}/planning/audit-timeline${QUERY}&category=privacy&limit=200`);
  expect(audit.status()).toBe(200);
  const kinds = ((await audit.json()) as {entries: Array<{kind: string; actor_role: string | null}>}).entries.map((entry) => entry.kind);
  expect(kinds.filter((kind) => kind === 'erasure.executed')).toHaveLength(1);
  // Three plans were made: the refused one and the executed one on screen, and the one the
  // hold stopped. Only one was executed.
  expect(kinds.filter((kind) => kind === 'erasure.preview')).toHaveLength(3);
  // The disposable schema itself: no row of the input, none of the draft and the job that
  // depended on it (there were some before), and one tombstone per erased row.
  expect(plan.targets.filter((target) => target.table === 'planning_drafts')).toHaveLength(stored.remaining_drafts);
  expect(plan.targets.filter((target) => target.table === 'planning_jobs')).toHaveLength(stored.remaining_jobs);
  expect(await receiptOf(expired[0].input_hash)).toMatchObject({input_hash: expired[0].input_hash, remaining_inputs: 0, remaining_drafts: 0, remaining_jobs: 0, unfinished_jobs: 0, input_tombstones: 1, executed_plans: 1, plan_tombstones: plan.targets.length, other_inputs: 4});
  // The plan the hold stopped stays unexecuted: with the input gone it finds nothing.
  expect((await send('erasure-execute', 'u29-early-after', {plan_id: earlyPlan.plan_id, fingerprint: earlyPlan.fingerprint})).status()).toBe(404);

  // A pharmacist is not offered the task, and the server refuses every step of it.
  const keptPlan = {plan_id: refused.plan_id, fingerprint: refused.fingerprint};
  const refusedFor = async () => {
    expect((await page.request.get(`${API}/planning/compliance/erasure-candidates${QUERY}`)).status()).toBe(403);
    expect((await send('erasure-preview', 'u29-forbidden-preview', {input_hash: kept.input_hash})).status()).toBe(403);
    expect((await send('erasure-execute', 'u29-forbidden-execute', keptPlan)).status()).toBe(403);
  };
  await signOut(page);
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/governance/privacy', 'ガバナンス');
  await expect(page.getByText(/コピーと旧勤務入力の確認と消去は、サーバーが管理者にだけ許可しています。/)).toBeVisible();
  await expect(page.getByText(ERASE_INPUTS, {exact: true})).toHaveCount(0);
  await refusedFor();
  // A leader has no view of the route at all.
  await signOut(page);
  await signIn(page, 'leader');
  await page.goto('/workspace/governance/privacy');
  await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
  await expect(page.getByText(ERASE_INPUTS, {exact: true})).toHaveCount(0);
  await refusedFor();
  expect((await page.request.get(`${API}/planning/inputs/latest${QUERY}&input_hash=${kept.input_hash}`)).status()).toBe(200);
  expect(dialogs).toBe(0);
});
