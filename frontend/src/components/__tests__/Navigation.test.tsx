import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import NotFound from '@/app/not-found';
import ShiftDetailDrawer from '../ShiftDetailDrawer';
import WorkflowIndex from '../WorkflowIndex';
import { loginPath, safeReturnPath } from '@/lib/loginPath';
import { canOpenWorkflow } from '@/lib/workflowAccess';

// Screen transitions and transition-like UI (plan stage T): the workflow entrance per
// role, the day dialog's focus handling, sign-in return paths and the not-found page.
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body } as Response);
afterEach(() => jest.restoreAllMocks());

test('the workflow index shows only the workflows each role may open', async () => {
  global.fetch = jest.fn(async () => response([
    { scope_id: 'hospital/pharmacy', person_id: 'p0', role: 'ADMIN' },
    { scope_id: 'hospital/ward', person_id: 'p0', role: 'PHARMACIST' },
  ])) as never;
  render(<WorkflowIndex />);
  const admin = await screen.findByRole('region', { name: /hospital\/pharmacy/ });
  expect(within(admin).getAllByRole('link').map((a) => a.textContent)).toEqual(['契約・制度', '兼業・派遣照合', '休暇', '実績', '個人情報管理', '復旧状況']);
  const staff = screen.getByRole('region', { name: /hospital\/ward/ });
  expect(within(staff).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
    '/planning/workflows/outside?scope=hospital%2Fward', '/planning/workflows/leave?scope=hospital%2Fward', '/planning/workflows/privacy?scope=hospital%2Fward']);
  expect(canOpenWorkflow('actuals', 'LEADER')).toBe(true);
  expect(canOpenWorkflow('recovery', 'LEADER')).toBe(false);
});

test('an account without memberships is told so instead of waiting forever', async () => {
  global.fetch = jest.fn(async () => response([])) as never;
  render(<WorkflowIndex />);
  expect(await screen.findByText(/所属がありません/)).toBeInTheDocument();
  // The next step names who registers memberships and what to tell them.
  expect(screen.getByText(/ログインID（またはアカウントID）を、管理者に伝えてください/)).toBeInTheDocument();
});

test('sign-in keeps the page and query to return to, and only same-site paths', () => {
  expect(loginPath('/planning/workflows/leave?scope=hospital/ward')).toBe('/login?redirectTo=%2Fplanning%2Fworkflows%2Fleave%3Fscope%3Dhospital%2Fward');
  expect(loginPath('//evil.example/x')).toBe('/login?redirectTo=%2Fplanning');
  expect(loginPath('https://evil.example')).toBe('/login?redirectTo=%2Fplanning');
  // URL parsing drops tabs and line breaks and reads "\\" as "/": each of these would leave the site.
  for (const hostile of ['/.//evil.example', '/%2e//evil.example', '/..//evil.example', '/a/..//evil.example', '/\t/evil.example', '/\n/evil.example', '/\r\n/evil.example', '/\\evil.example', '/\u0000/x', ['/planning'], undefined]) {
    expect(safeReturnPath(hostile)).toBeNull();
  }
  expect(safeReturnPath('/planning/workflows/leave?scope=hospital%2Fward')).toBe('/planning/workflows/leave?scope=hospital%2Fward');
});

test('the not-found page names itself and offers the main navigation', () => {
  render(<NotFound />);
  expect(screen.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: '主な画面' })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
});

test('the day dialog is modal: focus inside, Escape closes, focus returns, background inert', async () => {
  const onClose = jest.fn();
  const day = { isoDate: '2026-01-08', dayNumber: 8, assignments: [{ personId: 'synthetic-a', assignmentDate: '2026-01-08', shiftId: 'DAY_SHIFT' }] };
  const outside = document.createElement('div');
  outside.innerHTML = '<button>開いた元</button>';
  document.body.appendChild(outside);
  const opener = outside.querySelector('button')!;
  opener.focus();
  const { rerender } = render(<ShiftDetailDrawer day={day} onClose={onClose} />);
  const dialog = await screen.findByRole('dialog', { name: '8 日の割り当て' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(outside).toHaveAttribute('inert');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  rerender(<ShiftDetailDrawer day={null} onClose={onClose} />);
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(outside).not.toHaveAttribute('inert');
  outside.remove();
});

test('closing the day dialog with unsaved manual adjustments asks first', async () => {
  const onClose = jest.fn();
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const day = { isoDate: '2026-01-08', dayNumber: 8, assignments: [{ personId: 'synthetic-a', assignmentDate: '2026-01-08', shiftId: 'DAY_SHIFT' }] };
  render(<ShiftDetailDrawer day={day} onClose={onClose} manualAssignments={day.assignments} baselineAssignments={day.assignments}
    onSaveManualAssignments={() => {}} availablePeople={['synthetic-a', 'synthetic-b']} />);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '割当を追加' }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(confirm).toHaveBeenCalledWith('未保存の手動調整を破棄して閉じますか？');
  expect(onClose).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a re-render with a new close callback leaves focus and inert alone while the dialog is open', async () => {
  const day = { isoDate: '2026-01-08', dayNumber: 8, assignments: [] };
  const outside = document.createElement('div');
  outside.innerHTML = '<button>開いた元</button>';
  document.body.appendChild(outside);
  outside.querySelector('button')!.focus();
  const { rerender } = render(<ShiftDetailDrawer day={day} onClose={() => {}} />);
  const dialog = await screen.findByRole('dialog');
  const close = within(dialog).getByRole('button', { name: '閉じる' });
  expect(document.activeElement).toBe(close);
  const other = within(dialog).queryAllByRole('button').find((b) => b !== close);
  (other ?? dialog).focus();
  const focused = document.activeElement;
  rerender(<ShiftDetailDrawer day={day} onClose={() => {}} />);
  expect(document.activeElement).toBe(focused);
  expect(outside).toHaveAttribute('inert');
  outside.remove();
});

test('after the adjustment is applied, closing the day dialog does not ask again', async () => {
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  const onClose = jest.fn();
  const saved = [{ personId: 'synthetic-a', assignmentDate: '2026-01-08', shiftId: 'DAY_SHIFT' }];
  const day = { isoDate: '2026-01-08', dayNumber: 8, assignments: saved };
  render(<ShiftDetailDrawer day={day} onClose={onClose} manualAssignments={saved} baselineAssignments={saved}
    onSaveManualAssignments={() => {}} availablePeople={['synthetic-a']} />);
  const dialog = await screen.findByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(confirm).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('resetting a day without an applied adjustment also discards the unapplied rows', async () => {
  const { default: ManualAssignmentEditor } = await import('../ManualAssignmentEditor');
  const saved = [{ personId: 'synthetic-a', assignmentDate: '2026-01-08', shiftId: 'DAY_SHIFT' }];
  const onDirty = jest.fn();
  render(<ManualAssignmentEditor isoDate="2026-01-08" assignments={saved} baselineAssignments={saved} onSave={() => {}}
    onReset={async () => {}} availablePeople={['synthetic-a']} onDirtyChange={onDirty} />);
  fireEvent.click(screen.getByRole('button', { name: '割当を追加' }));
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(true));
  fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
  await waitFor(() => expect(onDirty).toHaveBeenLastCalledWith(false));
});
