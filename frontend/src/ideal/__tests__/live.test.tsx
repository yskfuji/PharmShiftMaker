import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import IdealWorkspace from '@/components/ideal/IdealWorkspace';
import ApiWorkspaceProvider from '../providers/ApiWorkspaceProvider';
import { EMPTY_EVIDENCE, EvidenceFields } from '../live/parts';
import type { IdealScreen } from '../types';

jest.mock('@/components/IdentityProvider', () => ({ useIdentity: () => ({ identity: { user_id: 'u1', display_name: '合成 花子' }, status: 'verified' }) }));

type Call = { method: string; path: string; body: Record<string, unknown> | null };
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) } as Response);
const duty = (id: string, person: string, day: number) => ({ duty_id: id, person_id: person, kind: '日勤', task: '調剤', location: '中央', start: `2026-10-${day}T08:30:00+09:00`, end: `2026-10-${day}T17:15:00+09:00` });
const publication = { publication_id: 'pub-1', version: 4, period: '2026-10-12T00:00:00+09:00|2026-10-19T00:00:00+09:00', validation_status: 'verified_at_publication', assignments: [duty('d1', 'p-self', 13), duty('d2', 'p-other', 14)] };
const caseRow = (over: Record<string, unknown>) => ({ case_id: 'c1', scope_id: 'hospital/pharmacy', publication_id: 'pub-1', kind: 'ABSENCE', status: 'AWAITING_CONSENT', version: 1,
  affected_assignments: [], proposed_assignments: [duty('r1', 'p-self', 14)], validation: { findings: [], publishable: true, required_consent_person_ids: ['p-self'], consented_person_ids: [] },
  evidence: {}, created_by: '', created_at: '2026-10-12T09:00:00+09:00', updated_at: '2026-10-12T09:00:00+09:00', ...over });

function server(role: string, routes: Record<string, (call: Call) => [number, unknown]>) {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const call = { method: init?.method ?? 'GET', path: u.pathname.replace('/planning', ''), body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    if (call.path === '/scopes') return json(200, [{ scope_id: 'hospital/pharmacy', display_name: '合成病院 薬剤部', person_id: 'p-self', role, input_revision: 1 }]);
    if (call.path === '/publications') return json(200, [publication]);
    if (call.path === '/inputs/latest') return json(200, { input_hash: 'h1', input_revision: 1, publication_version: 4, stale: false, snapshot: { people: [{ person_id: 'p-self', name: '合成 花子' }, { person_id: 'p-other', name: '合成 次郎' }] } });
    const route = routes[`${call.method} ${call.path}`];
    if (!route) return json(404, { detail: `no route ${call.method} ${call.path}` });
    const [status, body] = route(call);
    return json(status, body);
  }) as never;
  return calls;
}

const open = (screenName: IdealScreen) => render(<ApiWorkspaceProvider><IdealWorkspace initialScreen={screenName} /></ApiWorkspaceProvider>);
async function fillEvidence(scope: HTMLElement) {
  fireEvent.change(within(scope).getByLabelText(/^理由/), { target: { value: '本人から連絡' } });
  fireEvent.change(within(scope).getByLabelText(/^参照/), { target: { value: 'TEL-1012' } });
}
const ADMIN_ONLY = ['/memberships', '/audit-timeline', '/lifecycle-cases', '/inputs/refresh'];

test('evidence fields preserve both values when edited back to back', () => {
  function Harness() {
    const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
    return <EvidenceFields value={evidence} onChange={setEvidence} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText(/^理由/), { target: { value: '勤務変更の理由' } });
  fireEvent.change(screen.getByLabelText(/^参照/), { target: { value: '連絡記録-101' } });
  expect(screen.getByLabelText(/^理由/)).toHaveValue('勤務変更の理由');
  expect(screen.getByLabelText(/^参照/)).toHaveValue('連絡記録-101');
});

test('a pharmacist consents from home with evidence and an idempotency key, never touching admin endpoints', async () => {
  const calls = server('PHARMACIST', {
    'GET /change-cases': () => [200, [caseRow({})]],
    'POST /change-cases/c1/consent': () => [200, caseRow({ status: 'READY', version: 2 })],
  });
  open('home');
  const panel = (await screen.findByRole('heading', { name: '同意が必要な勤務' })).closest('section')!;
  fireEvent.click(within(panel).getByRole('button', { name: '同意する' }));
  await fillEvidence(panel);
  fireEvent.click(within(panel).getByRole('button', { name: '同意する' }));
  // the confirmation stays on screen although the case leaves the list
  expect(await screen.findByText('同意しました。')).toHaveAttribute('role', 'status');
  const sent = calls.find((c) => c.method === 'POST')!;
  expect(sent.path).toBe('/change-cases/c1/consent');
  expect(sent.body).toMatchObject({ expected_version: 1, evidence: { reason: '本人から連絡', reference: 'TEL-1012' } });
  expect(sent.body?.idempotency_key).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(calls.some((c) => ADMIN_ONLY.includes(c.path) || c.path === '/inputs/latest')).toBe(false);
});

test('without the consent setting a pharmacist applies for an absence without naming anyone', async () => {
  const calls = server('PHARMACIST', {
    'GET /change-cases': () => [200, []],
    'GET /change-cases/options': () => [403, { detail: 'A pharmacist may not name a replacement for an absence' }],
    'POST /change-cases': () => [200, caseRow({ status: 'READY', proposed_assignments: [] })],
  });
  open('requests');
  const panel = (await screen.findByRole('heading', { name: '新しい申請' })).closest('section')!;
  fireEvent.change(within(panel).getByLabelText('勤務'), { target: { value: 'd1' } });
  expect(await within(panel).findByText(/薬剤師は代わりの人を指名できません/)).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('radio', { name: /代わりを指定しない/ }));
  await fillEvidence(panel);
  fireEvent.click(within(panel).getByRole('button', { name: '申請する' }));
  expect(await within(panel).findByText(/責任者の承認を待っています/)).toHaveAttribute('role', 'status');
  const sent = calls.find((c) => c.method === 'POST')!;
  expect(sent.body).toMatchObject({ publication_id: 'pub-1', kind: 'ABSENCE', affected_assignment_ids: ['d1'], proposed_assignment_ids: [] });
  // only the viewer's own duties are offered
  expect(within(panel).getByLabelText('勤務').querySelectorAll('option')).toHaveLength(2);
});

test('an administrator switches the consent setting with evidence against the current version', async () => {
  const calls = server('ADMIN', {
    'GET /scope-settings': () => [200, { scope_id: 'hospital/pharmacy', absence_replacement_consent: { enabled: false, revision: 3, history: [] } }],
    'POST /scope-settings/absence-consent': () => [200, { scope_id: 'hospital/pharmacy', absence_replacement_consent: { enabled: true, revision: 4, history: [] } }],
  });
  open('settings');
  const panel = (await screen.findByRole('heading', { name: '代わりに入る人の同意' })).closest('section')!;
  await fillEvidence(panel);
  fireEvent.click(within(panel).getByRole('button', { name: '同意を求めるようにする' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
  expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ enabled: true, expected_version: 3 });
  await waitFor(() => expect(calls.filter((c) => c.path === '/notifications').length).toBeGreaterThan(1));
});

test('a planner approves a ready case against the publication version on screen, then reads again', async () => {
  const ready = caseRow({ status: 'READY', version: 2, affected_assignments: [duty('d2', 'p-other', 14)], validation: { findings: [], replacement_duty_ids: ['r1'], required_consent_person_ids: [], consented_person_ids: [] } });
  const calls = server('LEADER', {
    'GET /change-cases': () => [200, [ready]],
    'GET /change-cases/options': () => [200, { publication_id: 'pub-1', publication_version: 4, duty_id: 'd2', kind: 'ABSENCE', consent_required: false, options: [] }],
    'POST /change-cases/c1/approve': () => [200, { publication_id: 'pub-2', version: 5, case_id: 'c1' }],
  });
  open('operations');
  const panel = (await screen.findByRole('heading', { name: '進行中のケース' })).closest('section')!;
  expect(await within(panel).findByText(/合成 次郎/)).toBeInTheDocument();
  fireEvent.click(within(panel).getByRole('button', { name: '承認して新しい公開版を作る' }));
  await fillEvidence(panel);
  fireEvent.click(within(panel).getByRole('button', { name: '承認して新しい公開版を作る' }));
  await waitFor(() => expect(calls.some((c) => c.path === '/change-cases/c1/approve')).toBe(true));
  expect(calls.find((c) => c.path === '/change-cases/c1/approve')!.body).toMatchObject({ expected_version: 2, expected_publication_version: 4 });
  // the workspace (and its publication) is read again after approval
  await waitFor(() => expect(calls.filter((c) => c.path === '/publications').length).toBeGreaterThan(1));
  expect(await screen.findByText('承認し、新しい公開版を作成しました。')).toHaveAttribute('role', 'status');
});

test('a conflict on a change is shown as a conflict where it happened', async () => {
  server('PHARMACIST', {
    'GET /change-cases': () => [200, [caseRow({})]],
    'POST /change-cases/c1/decline': () => [409, { detail: 'Change case revision or status changed' }],
  });
  open('home');
  const panel = (await screen.findByRole('heading', { name: '同意が必要な勤務' })).closest('section')!;
  fireEvent.click(within(panel).getByRole('button', { name: '同意しない' }));
  await fillEvidence(panel);
  fireEvent.click(within(panel).getByRole('button', { name: '同意しない' }));
  const alert = await within(panel).findByRole('alert');
  expect(alert).toHaveTextContent('409');
  expect(alert).toHaveTextContent('新しい変更があります');
});

test('the generation step asks for three seeded plans and carries their exact ids to comparison', async () => {
  const figures = (id: string, dup: string | null) => ({ draft_id: id, findings: { violation: 0, unverified: 0, unsupported: 0 }, publishable: true, changes_from_previous: 2, changes_from_publication: 2,
    preference_cost: 1, preferences_met: 1, preferences_total: 2, work_seconds_total: 3600, work_seconds_spread: 0, assignment_count: 2, proposal_hash: 'x', duplicate_of: dup, solver: null });
  let jobCount = 0;
  const calls = server('LEADER', {
    'POST /jobs': (call) => [202, { job_id: `j${call.body?.random_seed}`, status: 'QUEUED', n: ++jobCount }],
    'GET /jobs/j0': () => [200, { job_id: 'j0', status: 'OPTIMAL', result: { draft_id: 'dr0' } }],
    'GET /jobs/j1': () => [200, { job_id: 'j1', status: 'OPTIMAL', result: { draft_id: 'dr1' } }],
    'GET /jobs/j2': () => [200, { job_id: 'j2', status: 'OPTIMAL', result: { draft_id: 'dr2' } }],
    'GET /plan-comparison': () => [200, { input_hash: 'h1', plans: [figures('dr0', null), figures('dr1', 'dr0'), figures('dr2', null)], pairs: [], order: ['dr0', 'dr2', 'dr1'], order_rule: '規則', meaning: '合成の点数はありません。' }],
  });
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  try {
    open('plan');
    fireEvent.click(await screen.findByRole('button', { name: '3つの案を作る' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/jobs')).toHaveLength(3));
    const posts = calls.filter((c) => c.method === 'POST' && c.path === '/jobs').map((c) => c.body!);
    expect(posts.map((b) => b.random_seed)).toEqual([0, 1, 2]);
    expect(new Set(posts.map((b) => b.idempotency_key)).size).toBe(3);
    jest.advanceTimersByTime(2100);
    const compare = await screen.findByRole('link', { name: /3案を同じ定義で比較/ });
    const href = compare.getAttribute('href') ?? '';
    expect(href).toContain('/workspace/plan/compare?');
    expect(new URL(href, 'https://example.test').searchParams.getAll('draft')).toEqual(['dr0', 'dr1', 'dr2']);
    expect(calls.some((c) => c.path === '/plan-comparison')).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

test('approval sends the version of the publication the case was opened against', async () => {
  // the publication on screen is the one covering now (always this one); the case was
  // opened against another period's publication (pub-1, version 4)
  const onScreen = { ...publication, publication_id: 'pub-now', version: 7, period: '2000-01-01T00:00:00+09:00|2999-01-01T00:00:00+09:00' };
  const ready = caseRow({ publication_id: 'pub-1', status: 'READY', version: 2, affected_assignments: [], validation: { findings: [], replacement_duty_ids: [], required_consent_person_ids: [], consented_person_ids: [] } });
  const calls = server('LEADER', {
    'GET /change-cases': () => [200, [ready]],
    'POST /change-cases/c1/approve': () => [200, { publication_id: 'pub-next-2', version: 8 }],
  });
  const original = global.fetch;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => new URL(String(url)).pathname.endsWith('/publications')
    ? json(200, [publication, onScreen]) : (original as typeof fetch)(url, init)) as never;
  open('operations');
  const panel = (await screen.findByRole('heading', { name: '進行中のケース' })).closest('section')!;
  fireEvent.click(await within(panel).findByRole('button', { name: '承認して新しい公開版を作る' }));
  await fillEvidence(panel);
  fireEvent.click(within(panel).getByRole('button', { name: '承認して新しい公開版を作る' }));
  await waitFor(() => expect(calls.some((c) => c.path === '/change-cases/c1/approve')).toBe(true));
  expect(calls.find((c) => c.path === '/change-cases/c1/approve')!.body).toMatchObject({ expected_publication_version: 4 });
});

test('in the production entry the navigation keeps the scope, and an off-role screen is refused', async () => {
  window.history.replaceState(null, '', '/workspace/people?scope=hospital%2Fpharmacy');
  server('LEADER', { 'GET /change-cases': () => [200, []] });
  render(<ApiWorkspaceProvider scopeId="hospital/pharmacy"><IdealWorkspace initialScreen="people" entry /></ApiWorkspaceProvider>);
  expect(await screen.findByText('この画面は、あなたの役割では開けません')).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: '主要ナビゲーション' });
  await waitFor(() => expect(within(nav).getByRole('link', { name: /当日運用/ }).getAttribute('href')).toBe('/workspace/operations/today?scope=hospital%2Fpharmacy'));
  expect(within(nav).queryByRole('link', { name: /職員/ })).toBeNull();
  window.history.replaceState(null, '', '/');
});
