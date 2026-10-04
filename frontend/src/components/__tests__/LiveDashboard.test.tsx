import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import LiveDashboard from '../dashboard/LiveDashboard';
import {planningRead} from '@/lib/planningRead';

jest.mock('@/lib/planningRead', () => ({planningRead: jest.fn()}));
const read = jest.mocked(planningRead);
const summary = (scope: string, period: string, value: number | null) => ({scope_id: scope, period,
  role: 'ADMIN', visibility: 'department', observed_at: '2026-01-01T00:00:00Z', sources: [],
  metrics: Object.fromEntries(['published_periods','assigned_duties','pending_requests','revalidation_required']
    .map(k => [k, {value, state: value === null ? 'unknown' : 'available', reason: null}]))});

beforeEach(() => read.mockReset());

test('unknown is not zero and a previous department response cannot overwrite the current one', async () => {
  let resolveOld!: (value: unknown) => void;
  read.mockImplementation((path) => {
    if (path === '/scopes') return Promise.resolve([{scope_id:'a/one',role:'ADMIN'},{scope_id:'b/two',role:'ADMIN'}]);
    if (path.includes('a%2Fone')) return new Promise(resolve => {resolveOld=resolve;});
    return Promise.resolve(summary('b/two','2026-01',null));
  });
  render(<LiveDashboard initialPeriod="2026-01"/>);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText('施設・部署'), {target:{value:'b/two'}});
  expect(await screen.findAllByText('未確認')).toHaveLength(4);
  resolveOld(summary('a/one','2026-01',999));
  await waitFor(() => expect(screen.queryByText('999件')).not.toBeInTheDocument());
  expect(screen.queryByText('0件')).not.toBeInTheDocument();
});

test('failure has an explicit retry and never leaves a previous count', async () => {
  read.mockImplementation(path => path === '/scopes' ? Promise.resolve([{scope_id:'a/one',role:'ADMIN'}]) : Promise.reject(new Error('接続できません')));
  render(<LiveDashboard initialPeriod="2026-01"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('接続できません');
  expect(screen.getByRole('button',{name:'再読込'})).toBeInTheDocument();
  expect(screen.queryByText('99.9%')).not.toBeInTheDocument();
});
