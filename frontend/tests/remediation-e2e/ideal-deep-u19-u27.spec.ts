import {expect, test, type Page, type TestInfo} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {allOptical, textSpacing} from '../visual/lib/optical';

const API = process.env.PHARMSHIFT_E2E_API_URL ?? 'https://127.0.0.1:18540';
const SCOPE = 'hospital/pharmacy';
const QUERY = '?scope_id=hospital%2Fpharmacy';
const WIDTHS = [320, 768, 1440] as const;

type Credentials = {user: string; password: string};
const USERS: Record<'admin' | 'developer' | 'pharmacist', Credentials> = {
  admin: {user: 'admin', password: 'pass-admin'},
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

matrix('ideal-deep-u19-leave', async (page) => {
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/requests/leave', '申請');
  const request = page.getByRole('region', {name: '希望休・年休の申請'});
  await request.getByLabel('日付').fill('2026-01-06');
  await request.getByLabel('種類').selectOption('PAID_LEAVE_V2');
  await request.getByLabel('年休付与台帳').selectOption('g1');
  await request.getByLabel('適用する年休規則').selectOption('lp1');
  await request.getByLabel('請求内容・根拠の参照').fill('合成本人請求 U19');
  await request.getByRole('button', {name: '申請を記録'}).click();
  const row = request.locator('li').filter({hasText: '2026/1/6'}).last();
  await expect(row).toContainText('PENDING');
  await signOut(page);

  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/requests/leave', '申請');
  const review = page.getByRole('region', {name: '希望休・年休の申請'});
  await review.getByLabel('判断の根拠・相談記録').fill('合成年休台帳と勤務影響を確認');
  const pending = review.locator('li').filter({hasText: '2026/1/6'}).last();
  await pending.getByRole('button', {name: '取得予定として確認'}).click();
  await expect(pending).toContainText('APPROVED');
  const requests = await page.request.get(`${API}/planning/requests${QUERY}`);
  expect(requests.status()).toBe(200);
  const saved = (await requests.json()).find((item: {person_id: string; kind: string; payload: {start: string}}) =>
    item.person_id === 'p1'
      && item.kind === 'PAID_LEAVE_V2'
      && new Date(item.payload.start).toLocaleDateString('ja-JP', {timeZone: 'Asia/Tokyo'}) === '2026/1/6',
  );
  expect(saved, '送信した本人・種別・日本日付の申請がAPIから再取得できる').toBeDefined();
  expect(saved?.status).toBe('APPROVED');

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

  const administration = page.getByRole('region', {name: '年休原本の専用操作'});
  await administration.getByLabel('登録する業務').selectOption('leave_record');
  await administration.getByLabel('編集する対象').selectOption('new');
  await administration.getByLabel('対象の付与原本').selectOption('g1');
  await administration.getByLabel('対象者・雇用主の取得規則').selectOption('lp1');
  await administration.getByLabel('年休イベント').selectOption('take');
  await administration.getByLabel('イベントの効力日').fill('2026-01-06');
  await administration.getByLabel('対象区間の開始（日本時間）').fill('2026-01-06T09:00');
  await administration.getByLabel('対象区間の終了（日本時間）').fill('2026-01-06T17:00');
  await administration.getByLabel('原本確認の資料名・参照先').fill('合成勤怠原本 U19');
  await administration.getByLabel('原本確認の状態').selectOption('verified');
  await administration.getByLabel('原本確認の確認責任者').fill('synthetic-reviewer');
  await administration.getByRole('button', {name: 'この内容を保存・再送'}).click();
  await expect(administration.getByRole('status')).toContainText('記録を保存して再取得しました');

  const contextResponse = await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}`);
  expect(contextResponse.status()).toBe(200);
  const context = await contextResponse.json();
  expect(context.leave_records).toEqual(expect.arrayContaining([expect.objectContaining({account_id: 'g1', kind: 'take', quantity: 1, unit: 'day'})]));

  const correction = page.getByText('人事原本と照合して年休の付与・取得を訂正', {exact: true}).locator('..');
  if (!(await correction.evaluate((element) => (element as HTMLDetailsElement).open))) await correction.getByText('人事原本と照合して年休の付与・取得を訂正', {exact: true}).click();
  await correction.getByLabel('訂正する原本').selectOption('g1');
  await correction.getByLabel('訂正後の付与日数').fill('4');
  await correction.getByLabel('そのうち法定付与日数').fill('4');
  await correction.getByLabel('訂正を把握した日時（日本時間）').fill('2026-01-07T12:00');
  await correction.getByLabel('訂正理由').fill('合成原本の訂正を通し確認');
  await correction.getByLabel('照合した人事資料の参照').fill('SYNTHETIC-U19-GRANT');
  await correction.getByLabel('根拠の確認者').fill('synthetic-reviewer');
  await correction.getByRole('button', {name: '原本を保持して訂正を記録'}).click();
  await expect(correction.getByRole('status').filter({hasText: '訂正を記録しました'})).toBeVisible();

  const ledger = page.getByText('過去時点の年休台帳と訂正履歴を確認', {exact: true}).locator('..');
  await ledger.getByText('過去時点の年休台帳と訂正履歴を確認', {exact: true}).click();
  await ledger.getByLabel('対象日').fill('2026-01-07');
  await ledger.getByLabel('記録の締切（日本時間）').fill('2026-01-07T13:00');
  await ledger.getByRole('button', {name: '指定時点の台帳を照会'}).click();
  await expect(ledger.getByLabel('過去時点の年休残高')).toContainText('残高');
  await expect(ledger.getByLabel('年休訂正の履歴')).toContainText('5日 → 4日');
});

matrix('ideal-deep-u20-contracts', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/people/contracts', '職員');
  const form = page.getByRole('region', {name: '職員と契約の専用操作'});
  await expect(form.getByLabel('編集する対象')).toBeVisible();

  await form.getByLabel('登録する業務').selectOption('contract');
  await form.getByLabel('編集する対象').selectOption({index: 2});
  await form.getByLabel('最大連続勤務日数').fill('5');
  await form.getByRole('button', {name: 'この内容を保存・再送'}).click();
  await expect(form.getByText(/記録を保存して再取得しました/)).toBeVisible();

  await form.getByLabel('登録する業務').selectOption('capability');
  await form.getByLabel('編集する対象').selectOption('new');
  await form.getByLabel('対象職員').selectOption('p1');
  await form.getByLabel('適用開始（日本時間）').fill('2026-01-05T00:00');
  await form.getByLabel('適用終了（日本時間）').fill('2026-01-12T00:00');
  await form.getByRole('combobox', {name: '担当業務', exact: true}).selectOption({index: 1});
  await form.getByRole('combobox', {name: '勤務場所', exact: true}).selectOption({index: 1});
  await form.getByLabel('原本確認の資料名・参照先').fill(`合成資格原本 ${info.project.name} ${width}`);
  await form.getByLabel('原本確認の状態').selectOption('verified');
  await form.getByLabel('原本確認の確認責任者').fill('synthetic-reviewer');
  await form.getByRole('button', {name: 'この内容を保存・再送'}).click();
  await expect(form.getByText(/記録を保存して再取得しました/)).toBeVisible();
});

matrix('ideal-deep-u21-demand', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/plan/input', '計画');
  await page.getByText('必要配置・資格要件を確認・編集', {exact: true}).click();
  const form = page.getByRole('region', {name: '必要配置の専用操作'});
  await form.getByLabel('編集する対象').selectOption('new');
  await form.getByRole('combobox', {name: '配置する業務', exact: true}).selectOption({index: 1});
  await form.getByRole('combobox', {name: '配置する場所', exact: true}).selectOption({index: 1});
  await form.getByLabel('必須の配置人数').fill('1');
  await form.getByLabel('希望する配置人数').fill('2');
  await form.getByLabel('適用開始（日本時間）').fill('2026-01-05T09:00');
  await form.getByLabel('適用終了（日本時間）').fill('2026-01-05T17:00');
  await form.getByLabel('原本確認の資料名・参照先').fill(`合成配置表 ${info.project.name} ${width}`);
  await form.getByLabel('原本確認の状態').selectOption('verified');
  await form.getByLabel('原本確認の確認責任者').fill('synthetic-reviewer');
  await form.getByRole('button', {name: 'この内容を保存・再送'}).click();
  await expect(form.getByText(/記録を保存して再取得しました/)).toBeVisible();

  await signOut(page);
  await signIn(page, 'pharmacist');
  await page.goto('/workspace/plan/input');
  await expect(page.getByRole('heading', {name: 'この画面は、あなたの役割では開けません'})).toBeVisible();
  await expect(page.getByRole('region', {name: '必要配置の専用操作'})).toHaveCount(0);
});

function monthRange(info: TestInfo, width: number) {
  const project = {chromium: 0, firefox: 1, webkit: 2}[info.project.name] ?? 0;
  const offset = project * 3 + WIDTHS.indexOf(width as (typeof WIDTHS)[number]);
  const start = new Date(Date.UTC(2027, offset, 1));
  const end = new Date(Date.UTC(2027, offset + 1, 0));
  return {start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10)};
}

matrix('ideal-deep-u22-flextime', async (page, info, width) => {
  await page.clock.install({time: new Date('2026-01-05T00:00:00+09:00')});
  const period = monthRange(info, width);
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/settings/flextime', '設定');
  await page.getByRole('button', {name: 'フレックスタイム制の採用を登録する'}).click();
  await page.getByRole('button', {name: '入力内容を確認する'}).click();
  await expect(page.getByRole('heading', {name: /入力内容に誤りがあります/})).toBeVisible();
  await page.getByLabel('事業場').selectOption('site-hospital');
  await page.getByLabel('対象労働者の範囲').fill(`薬剤部の常勤薬剤師 ${info.project.name} ${width}`);
  await page.getByLabel('清算期間の起算日（採用の開始日）').fill(period.start);
  await page.getByLabel('採用の最終日（この日を含む）').fill(period.end);
  await page.getByLabel('フレキシブルタイムの開始').fill('07:00');
  await page.getByLabel('フレキシブルタイムの終了').fill('20:00');
  await page.getByLabel('コアタイムの開始').fill('10:00');
  await page.getByLabel('コアタイムの終了').fill('15:00');
  for (const groupName of ['就業規則の規定（始業・終業の時刻を労働者に委ねる定め）', '労使協定']) {
    const group = page.getByRole('group', {name: groupName});
    await group.getByLabel('資料名・保管場所').fill(`合成原本 ${width}`);
    await group.getByLabel('原本との照合').selectOption('verified');
    await group.getByLabel('原本を確認した人').fill('synthetic-reviewer');
  }
  await page.getByLabel('Person 0').check();
  await page.getByRole('button', {name: '入力内容を確認する'}).click();
  await expect(page.getByRole('heading', {name: '採用の登録（2/2：内容の確認）'})).toBeFocused();
  await page.getByRole('button', {name: 'この内容で登録する（確認待ち）'}).click();
  await expect(page.getByText(/別の管理者が影響を確認/)).toBeVisible();

  await signOut(page);
  await signIn(page, 'developer');
  await openWorkspace(page, '/workspace/settings/flextime', '設定');
  const adoption = page.locator('article').filter({hasText: period.start});
  await adoption.getByRole('button', {name: '確認の前に影響を表示する'}).click();
  await expect(page.getByRole('heading', {name: '確認すると変わること'})).toBeFocused();
  await page.getByRole('button', {name: '内容と影響を確認して採用する'}).click();
  await expect(page.getByText(/採用を確認しました/)).toBeVisible();
  await expect(adoption).toContainText('採用中');
  await expect(adoption).toContainText('Person 0');
  await expect(adoption).toContainText('確認');

  const running = page.locator('article').filter({hasText: `終了確認 ${info.project.name} ${width}`});
  await running.getByText('採用を終了する', {exact: true}).click();
  await running.getByLabel('終了日（この日から採用しない）').selectOption('2026-02-01');
  await running.getByLabel('終了する理由（必須）').fill('合成の清算期間境界で終了');
  await running.getByRole('button', {name: '理由を記録して終了する'}).click();
  await expect(page.getByRole('status')).toContainText('2026-02-01 で終了');
  await expect(running).toContainText('終了 あなた');
  const recordsResponse = await page.request.get(`${API}/planning/compliance/records${QUERY}`);
  expect(recordsResponse.status()).toBe(200);
  const ended = (await recordsResponse.json()).find(
    (record: {kind: string; entity_id: string}) => record.kind === 'flex_adoption' && record.entity_id === `flex-end-${info.project.name}-${width}`,
  );
  expect(ended?.payload).toEqual(expect.objectContaining({decided_by: 'developer', end_reason: '合成の清算期間境界で終了'}));

  const settlementsResponse = await page.request.get(`${API}/planning/compliance/flex-settlements${QUERY}`);
  expect(settlementsResponse.status()).toBe(200);
  const settlements = await settlementsResponse.json();
  expect(settlements).toEqual(expect.objectContaining({input_hash: expect.any(String), people: expect.any(Array), findings: expect.any(Array)}));
});

matrix('ideal-deep-u23-actuals', async (page, info, width) => {
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/governance/actuals', 'ガバナンス');
  const section = page.getByRole('region', {name: '実績原本のファイル取込'});
  await expect(section).toBeVisible();
  const contextResponse = await page.request.get(`${API}/planning/compliance/workflow-context${QUERY}`);
  expect(contextResponse.status()).toBe(200);
  const context = await contextResponse.json();
  const actual = context.actuals.find((item: {external_id: string}) => item.external_id === 'synthetic-clock');
  const terms = context.records.find((item: {kind: string; entity_id: string}) => item.kind === 'work_terms' && item.entity_id === actual.duty.duty_id)?.payload ?? {
    duty_id: actual.duty.duty_id,
    employment_revision_id: context.employments.find((item: {relationship_id: string}) => item.relationship_id === actual.duty.relationship_id).revision_id,
    scheduled_work: actual.duty.work,
  };
  const invalid = JSON.stringify({format: 'pharmshift-actuals-v1', events: [{}, {}]});
  await page.getByLabel('実績原本ファイル').setInputFiles({name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(invalid)});
  await section.getByRole('button', {name: '原本と保存済み実績を照合'}).click();
  await expect(section.getByLabel('実績原本の行別エラー').getByRole('listitem')).toHaveCount(2);

  const body = JSON.stringify({format: 'pharmshift-actuals-v1', events: [{external_id: actual.external_id, revision: actual.revision + 1, duty: actual.duty, work_terms: terms}]});
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('実績原本ファイル').setInputFiles({name: `actual-${info.project.name}-${width}.json`, mimeType: 'application/json', buffer: Buffer.from(body)});
  await section.getByRole('button', {name: '原本と保存済み実績を照合'}).click();
  await expect(section.getByLabel('実績取込プレビュー')).toBeVisible();
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
  await section.getByRole('button', {name: '全件の差分を確認して保存・再送'}).click();
  await expect(section.getByRole('status')).toContainText('通信断');
  await section.getByRole('button', {name: '全件の差分を確認して保存・再送'}).click();
  await expect(section.getByRole('status')).toContainText('1件を保存しました');
  expect(attempts).toBe(2);

  const reconciliation = page.getByRole('region', {name: '実績の照合と訂正'});
  await reconciliation.getByLabel('照合する勤務').selectOption('actual:synthetic-clock');
  const revisedEnd = new Date(new Date(actual.duty.work[0].end).getTime() + (width + 1) * 1000);
  const revisedLocalEnd = new Date(revisedEnd.getTime() + 9 * 3600_000).toISOString().slice(0, 19);
  await reconciliation.getByLabel('実労働1 終了').fill(revisedLocalEnd);
  await reconciliation.getByRole('button', {name: '実績と所定区分を保存・再送'}).click();
  await expect(reconciliation.getByRole('status').filter({hasText: '実績と勤務区分を保存しました'})).toBeVisible();
  await reconciliation.getByLabel('照合内容・差異の理由').fill(`合成実績の照合 ${info.project.name} ${width}`);
  await reconciliation.getByRole('button', {name: '照合結果を記録・再送'}).click();
  await expect(reconciliation.getByRole('status').filter({hasText: '照合内容を記録しました'})).toBeVisible();
});

matrix('ideal-deep-u24-outside', async (page, info, width) => {
  await signIn(page, 'pharmacist');
  await openWorkspace(page, '/workspace/requests/outside', '申請');
  await page.getByRole('combobox', {name: '他の雇用主・活動先', exact: true}).selectOption({index: 1});
  await page.getByRole('combobox', {name: '申告する事業場', exact: true}).selectOption({index: 1});
  await page.getByLabel('適用開始（日本時間）', {exact: true}).fill('2026-01-01T00:00');
  await page.getByLabel('適用終了（日本時間）', {exact: true}).fill('2027-01-01T00:00');
  await page.getByLabel('所定労働の開始 1', {exact: true}).fill('2026-01-06T09:00');
  await page.getByLabel('所定労働の終了 1', {exact: true}).fill('2026-01-06T12:00');
  await page.getByRole('checkbox', {name: 'この期間の労働区間をすべて記載した', exact: true}).check();
  await page.getByLabel('契約・所定時間・所定外時間の照合資料').fill(`合成申告原本 ${info.project.name} ${width}`);
  await page.getByRole('button', {name: '申告・訂正を記録', exact: true}).click();
  await expect(page.getByText(/版 1、照合待ち/)).toBeVisible();
  const declaration = await page.getByLabel('訂正・取下げする申告').inputValue();

  await signOut(page);
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/requests/outside', '申請');
  await page.getByLabel('訂正・取下げする申告').selectOption(declaration);
  await page.getByLabel('照合根拠', {exact: true}).fill('合成管理者による原本照合。実施設の証拠ではない。');
  await page.getByRole('button', {name: '照合判断を記録', exact: true}).click();
  await expect(page.getByText(/版 2、確認済み/)).toBeVisible();

  const recordResponse = await page.request.get(`${API}/planning/compliance/records${QUERY}`);
  const record = (await recordResponse.json()).find((item: {entity_id: string}) => item.entity_id === declaration);
  expect(record.payload.person_id).toBe('p1');
  expect(record.payload.status).toBe('REVIEWED');
});

async function submitPrivacyRequest(page: Page, kind: 'access' | 'erase', reason: string) {
  const section = page.locator('#privacy-request');
  if (!(await section.getByLabel('請求の種類').isVisible())) {
    await page.getByText('個人情報の開示・訂正・利用停止等を請求', {exact: true}).click();
  }
  await section.getByLabel('請求の種類').selectOption(kind);
  await section.getByLabel('対象と理由').fill(reason);
  const saved = page.waitForResponse((response) => response.request().method() === 'POST' && /\/planning\/compliance\/privacy\/requests\?/.test(response.url()));
  await section.getByRole('button', {name: '請求を記録'}).click();
  await expect(page.getByText(/受付を記録しました/)).toBeVisible();
  const response = await saved;
  expect(response.status()).toBe(200);
  return (await response.json()).case_id as string;
}

async function decidePrivacyCase(page: Page, caseId: string, expectedStatus: string) {
  const progress = page.getByText('本人対応の進捗・判断', {exact: true});
  if (!(await progress.evaluate((element) => (element.parentElement as HTMLDetailsElement).open))) await progress.click();
  const item = progress.locator('..').locator('li').filter({hasText: caseId});
  await item.getByRole('button', {name: 'この請求を確認'}).click();
  const form = progress.locator('..').locator('form');
  await form.getByLabel('次の判断').selectOption(expectedStatus);
  await form.getByLabel('判断理由').fill(`合成判断 ${expectedStatus}`);
  await form.getByLabel('本人確認の根拠').fill('synthetic-identity-proof');
  await form.getByLabel('本人確認者').fill('synthetic-reviewer');
  await form.getByRole('button', {name: '本人対応の判断を記録'}).click();
  await expect(page.getByText('判断と履歴を記録しました。', {exact: true})).toBeVisible();
}

matrix('ideal-deep-u25-privacy-erasure', async (page, info, width) => {
  const accessReason = `開示対象 ${info.project.name} ${width}`;
  const eraseReason = `消去対象 ${info.project.name} ${width}`;
  await signIn(page, 'admin');
  await openWorkspace(page, '/workspace/governance/privacy?person=p-erasure', 'ガバナンス');
  const accessCase = await submitPrivacyRequest(page, 'access', accessReason);
  const eraseCase = await submitPrivacyRequest(page, 'erase', eraseReason);
  await decidePrivacyCase(page, accessCase, 'VERIFIED');
  await decidePrivacyCase(page, eraseCase, 'VERIFIED');
  await decidePrivacyCase(page, eraseCase, 'APPROVED');

  const control = page.getByRole('region', {name: '承認済み本人消去の人物制御'});
  await control.getByLabel('人物制御の対象職員').selectOption('p-erasure');
  await expect(control.getByText('人物制御は未適用です。', {exact: true})).toBeVisible();
  const approvedErase = control.getByLabel('承認済みの消去判断').locator('option').filter({hasText: eraseReason});
  await control.getByLabel('承認済みの消去判断').selectOption((await approvedErase.getAttribute('value')) ?? '');
  await control.getByLabel('人物制御の実施理由').fill('隔離された専用合成人物の承認済み消去');
  await control.getByRole('button', {name: '人物制御を適用・同一再送'}).click();
  await expect(control.getByText(/人物制御を適用しました/)).toBeVisible();

  await control.getByRole('button', {name: '消去計画と残存を取得・再送'}).click();
  await expect(control.getByText(/現時点で実行可能 [1-9]/)).toBeVisible();
  await control.getByLabel('対象と残存理由を確認し、実行可能分だけの処理に同意した').check();
  await control.getByRole('button', {name: 'この計画の実行可能分を処理・同一再送'}).click();
  await expect(control.getByText(/DB消去 [1-9][0-9]*件/)).toBeVisible();

  const state = await page.request.get(`${API}/planning/compliance/subject-controls/p-erasure${QUERY}`);
  expect(state.status()).toBe(200);
  expect(await state.json()).toEqual(expect.objectContaining({person_id: 'p-erasure', revision: 1, state: 'CONTROL_APPLIED_REMAINS'}));
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
