import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import IdealWorkspace from '@/components/ideal/IdealWorkspace';
import CognitiveWorkspaceShowcase from '@/features/workspace/showcase/CognitiveWorkspaceShowcase';
import WorkspaceContent from '@/ideal/screens/live/WorkspaceContent';
import { workspaceHrefWithContext } from '@/features/workspace/shell/workspaceHref';
import ApiWorkspaceProvider from '../providers/ApiWorkspaceProvider';
import { useWorkspace } from '../providers/WorkspaceContext';

jest.mock('@/components/IdentityProvider', () => ({ useIdentity: () => ({ identity: { user_id: 'u1', display_name: '合成 花子' }, status: 'verified' }) }));

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response);
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) } as Response);
const scopes = (role: string) => [{ scope_id: 'hospital/pharmacy', display_name: '合成病院 薬剤部', person_id: 'p-self', role, input_revision: 1 }];
const publications = [{ publication_id: 'pub-1', version: 4, period: '2026-10-12T00:00:00+09:00|2026-10-19T00:00:00+09:00', validation_status: 'verified_at_publication',
  assignments: [{ duty_id: 'd1', person_id: 'p-self', kind: '日勤', task: '調剤', location: '中央病棟', start: '2026-10-12T08:30:00+09:00', end: '2026-10-12T17:15:00+09:00' }] }];
const readResponse = (url: string, role: string, pubs = publications) => {
  const path = new URL(url).pathname;
  if (path.endsWith('/scopes')) return ok(scopes(role));
  if (path.endsWith('/publications')) return ok(pubs);
  if (path.endsWith('/schedule-calendar')) return ok({ scope_id: 'hospital/pharmacy', requested_period: '2026-10', visibility: role === 'PHARMACIST' ? 'self' : 'department', publication: null, previous_publication: null, assignments: pubs[0]?.assignments ?? [], changes: [], can_export_department: role !== 'PHARMACIST', limitations: [] });
  if (path.endsWith('/dashboard')) return ok({ scope_id: 'hospital/pharmacy', period: '2026-10', role, visibility: role === 'PHARMACIST' ? 'self' : 'department', observed_at: '2026-10-02T00:00:00Z', sources: [], metrics: {} });
  if (path.endsWith('/daily-operations')) return ok({ scope_id: 'hospital/pharmacy', day: '2026-10-02', observed_at: '2026-10-02T00:00:00Z', visibility: role === 'PHARMACIST' ? 'self' : 'department', scheduled_assignments: [], scheduled_count: 0, open_case_count: 0, absence_case_count: 0, coverage_finding_count: 0, undelivered_notification_count: 0, limitations: [] });
  if (path.endsWith('/schedule-stability')) return ok({ scope_id: 'hospital/pharmacy', observed_at: '2026-10-02T00:00:00Z', window_days: 14, publication_count: 0, change_event_count: 0, days: [], meaning: '記述統計' });
  if (path.endsWith('/notifications')) return ok([]);
  return null;
};
afterEach(() => jest.restoreAllMocks());

function RefreshWorkspaceButton() {
  const { live } = useWorkspace();
  return <button type="button" onClick={() => void live?.refresh()}>作業文脈を更新</button>;
}

test('Storybook and the showcase never reach the API (synthetic by default and by provider)', async () => {
  const spy = jest.fn(() => { throw new Error('no network'); });
  global.fetch = spy as never;
  const { unmount } = render(<IdealWorkspace initialScreen="schedule" />);
  expect(screen.getByRole('heading', { level: 1, name: '勤務表' })).toBeInTheDocument();
  unmount();
  render(<CognitiveWorkspaceShowcase screen="settings" view="appearance" role="LEADER" />);
  expect(await screen.findByRole('heading', { name: '外観と動き' })).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

test('the API provider reads the viewer scope and role from the server, and only reads on load', async () => {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    urls.push(`${init?.method ?? 'GET'} ${String(url)}`);
    return readResponse(String(url), 'PHARMACIST') ?? ok(publications);
  }) as never;
  render(<ApiWorkspaceProvider><IdealWorkspace initialScreen="schedule" /></ApiWorkspaceProvider>);
  expect(await screen.findByRole('heading', { level: 1, name: '勤務表' })).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: '主要ナビゲーション' });
  expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['今日判断が必要なこと', '勤務表月間計画と自分の予定', '申請休暇と勤務交換', 'ガバナンス監査・復旧・個人情報', '設定施設と通知']);
  expect(screen.getByRole('link', { name: /^カレンダーに追加\s?（\.ics）$/ }).getAttribute('href')).toContain('/planning/personal-schedule/pub-1/content?scope_id=hospital%2Fpharmacy&format=ical');
  expect(screen.queryByText('合成データ・評価用')).toBeNull();
  expect(screen.queryByRole('complementary', { name: 'ショーケース設定' })).toBeNull();
  expect(urls.every((u) => u.startsWith('GET '))).toBe(true);
  expect(urls.some((u) => u.includes('/inputs/latest'))).toBe(false); // a pharmacist never asks for others' names
});

test('a Server Component payload paints the first workspace without a duplicate browser read', () => {
  const spy = jest.fn(() => { throw new Error('initial browser read is forbidden'); });
  global.fetch = spy as never;
  const scope = scopes('PHARMACIST')[0] as never;
  render(<ApiWorkspaceProvider initial={{
    observedAt: '2026-10-12T00:00:00.000Z',
    requestedPeriod: '2026-10',
    selectedPublicationId: 'pub-1',
    selectedCaseId: null,
    selectedPersonId: null,
    viewerName: '合成 花子',
    scopes: [scope],
    scope,
    selectionRequired: false,
    problem: null,
    publications,
    names: {},
    calendar: { scope_id: 'hospital/pharmacy', requested_period: '2026-10', visibility: 'self', publication: null, previous_publication: null, assignments: publications[0].assignments, changes: [], can_export_department: false, limitations: [] },
    dashboard: null,
    daily: null,
    stability: null,
    notifications: [],
    partialProblems: [],
  }}><IdealWorkspace initialScreen="schedule" /></ApiWorkspaceProvider>);
  expect(screen.getByRole('heading', { level: 1, name: '勤務表' })).toBeInTheDocument();
  expect(screen.getByText('合成 花子')).toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

test('a committed mutation refreshes client data and announces the new shell summary without navigating', async () => {
  global.fetch = jest.fn(async (url: RequestInfo | URL) =>
    readResponse(String(url), 'ADMIN')
      ?? (new URL(String(url)).pathname.endsWith('/inputs/latest')
        ? ok({ snapshot: { people: [{ person_id: 'p-self', name: '合成 花子' }] } })
        : ok(publications))) as never;
  const changed = jest.fn((event: Event) => (event as CustomEvent).detail);
  window.addEventListener('workspace-context-changed', changed);
  render(<ApiWorkspaceProvider><RefreshWorkspaceButton /></ApiWorkspaceProvider>);
  const button = await screen.findByRole('button', { name: '作業文脈を更新' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(changed.mock.results[0].value).toEqual(expect.objectContaining({
    unreadNotifications: expect.any(Number),
    publication: expect.objectContaining({publication_id: expect.any(String), version: expect.any(Number)}),
  }));
  window.removeEventListener('workspace-context-changed', changed);
});

test('a conflict while reading is a stale view to reload, not a failure or kept input', async () => {
  global.fetch = jest.fn(async (url: RequestInfo | URL) => String(url).includes('/scopes') ? ok(scopes('LEADER')) : fail(409, { detail: 'Publication version changed' })) as never;
  render(<ApiWorkspaceProvider><IdealWorkspace /></ApiWorkspaceProvider>);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('表示中の版が古くなりました');
  expect(alert).not.toHaveTextContent('入力した内容は保持しています');
  expect(within(alert).getByRole('button', { name: /再読み込み/ })).toBeInTheDocument();
});

test('a scope in the URL that is not the viewer\'s own is refused, not replaced silently', async () => {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL) => { urls.push(String(url)); return ok(scopes('LEADER')); }) as never;
  render(<ApiWorkspaceProvider scopeId="other/ward"><IdealWorkspace /></ApiWorkspaceProvider>);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('403');
  expect(alert).toHaveTextContent('指定された施設・部署の所属がありません');
  expect(urls.some((u) => u.includes('/publications'))).toBe(false);
});

test('a person in the URL must be present in the authorized scope roster', async () => {
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith('/inputs')) return ok([{ input_hash: 'h1' }]);
    if (pathname.endsWith('/compliance/records')) return ok([]);
    return readResponse(String(url), 'ADMIN')
      ?? (pathname.endsWith('/inputs/latest')
        ? ok({ snapshot: { people: [{ person_id: 'p-self', name: '合成 花子' }] } })
        : ok(publications));
  }) as never;
  render(<ApiWorkspaceProvider personId="outside-this-scope"><WorkspaceContent screen="governance" view="privacy" /></ApiWorkspaceProvider>);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('404');
  expect(alert).toHaveTextContent('指定された職員は、この施設・部署では参照できません');
});

test('the privacy-purpose workspace ignores carried publication context and remains reachable while ordinary planning reads return 423', async () => {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    const pathname = new URL(String(url)).pathname; urls.push(pathname);
    if (pathname.endsWith('/scopes')) return ok(scopes('PHARMACIST'));
    if (pathname.endsWith('/compliance/privacy')) return ok({ rules: [], holds: [], cases: [] });
    return fail(423, { detail: '利用を制限しています' });
  }) as never;
  render(<ApiWorkspaceProvider privacyPurpose publicationId="pub-1"><WorkspaceContent screen="governance" view="privacy" /></ApiWorkspaceProvider>);
  expect(await screen.findByRole('heading', { name: '本人対応と保存・消去' })).toBeInTheDocument();
  expect(urls.some((url) => url.endsWith('/publications'))).toBe(false);
  expect(urls.filter((url) => url.endsWith('/compliance/privacy')).length).toBeGreaterThan(0);
});

test('the privacy-purpose workspace validates another person through the restricted-purpose roster', async () => {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    const pathname = new URL(String(url)).pathname; urls.push(pathname);
    if (pathname.endsWith('/scopes')) return ok(scopes('ADMIN'));
    if (pathname.endsWith('/compliance/privacy')) return ok({ people: [{ person_id: 'p-other', name: '合成 対象者' }], rules: [], holds: [], cases: [] });
    return fail(423, { detail: '利用を制限しています' });
  }) as never;
  render(<ApiWorkspaceProvider privacyPurpose publicationId="pub-1" personId="p-other"><WorkspaceContent screen="governance" view="privacy" /></ApiWorkspaceProvider>);
  expect(await screen.findByRole('heading', { name: '本人対応と保存・消去' })).toBeInTheDocument();
  expect(screen.queryByRole('alert', { name: '年休台帳の取得結果' })).not.toBeInTheDocument();
  expect(urls.some((url) => url.endsWith('/inputs'))).toBe(false);
  expect(urls.some((url) => url.endsWith('/compliance/records'))).toBe(false);
});

test('a link to the privacy-purpose route does not carry publication or case context', () => {
  const href = workspaceHrefWithContext('/workspace/governance/privacy', {
    scope: 'hospital/pharmacy', period: '2026-10', publication: 'pub-1', case: 'case-1', person: 'p-self',
  });
  expect(href).toContain('scope=hospital%2Fpharmacy');
  expect(href).toContain('period=2026-10');
  expect(href).toContain('person=p-self');
  expect(href).not.toContain('publication=');
  expect(href).not.toContain('case=');
});

test('a failure to read names is reported without erasing the available workspace', async () => {
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/scopes')) return ok(scopes('LEADER'));
    if (String(url).includes('/inputs/latest')) return fail(423, { detail: 'locked' });
    return readResponse(String(url), 'LEADER') ?? ok(publications);
  }) as never;
  render(<ApiWorkspaceProvider><WorkspaceContent screen="home" /></ApiWorkspaceProvider>);
  const status = (await screen.findByText('一部の情報を更新できませんでした')).closest('[role="status"]')!;
  expect(status).toHaveTextContent('一部の情報を更新できませんでした');
  expect(status).toHaveTextContent('職員名（423）');
});

test('a lost response while reading can be reloaded, and changed nothing', async () => {
  let calls = 0;
  global.fetch = jest.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/scopes')) { calls += 1; if (calls === 1) throw new TypeError('Failed to fetch'); return ok(scopes('LEADER')); }
    if (String(url).includes('/inputs/latest')) return ok({ snapshot: { people: [{ person_id: 'p-self', name: '合成 花子' }] } });
    return readResponse(String(url), 'LEADER') ?? ok(publications);
  }) as never;
  render(<ApiWorkspaceProvider><IdealWorkspace /></ApiWorkspaceProvider>);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('読み込めませんでした');
  expect(alert).not.toHaveTextContent('反映されたかは不明');
  fireEvent.click(within(alert).getByRole('button', { name: /再読み込み/ }));
  expect(await screen.findByRole('heading', { level: 1, name: '今日' })).toBeInTheDocument();
});

test('on narrow screens the day agenda selects a duty with the keyboard-reachable button', () => {
  render(<IdealWorkspace initialScreen="schedule" />);
  const agenda = screen.getByRole('region', { name: '日別勤務予定' });
  const item = within(agenda).getAllByRole('button').find((button) => button.hasAttribute('aria-pressed'))!;
  fireEvent.click(item);
  expect(item).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('選択中の勤務').closest('aside')).toHaveTextContent('勤務の詳細');
});

test('a pharmacist with no duty in the week is told so in words, and sees no other person', async () => {
  const foreign = [{ ...publications[0], assignments: [] }];
  global.fetch = jest.fn(async (url: RequestInfo | URL) => readResponse(String(url), 'PHARMACIST', foreign) ?? ok(foreign)) as never;
  render(<ApiWorkspaceProvider><IdealWorkspace initialScreen="schedule" /></ApiWorkspaceProvider>);
  expect(await screen.findByRole('heading', { level: 1, name: '勤務表' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '月間勤務表' })).getByText('表示期間に、あなたの公開済みの勤務はありません。')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: '日別勤務予定' })).getByText('表示期間に、あなたの公開済みの勤務はありません。')).toBeInTheDocument();
  // nothing to select, so no selection hint and no empty detail panel
  expect(screen.queryByText('表の勤務を選ぶと、詳細を表示します。')).toBeNull();
  expect(screen.queryByText('選択中の勤務')).toBeNull();
});
