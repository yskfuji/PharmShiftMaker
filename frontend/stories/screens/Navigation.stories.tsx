import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';
import WorkflowIndex from '@/components/WorkflowIndex';

// Transition screens (plan stage T): the business workflow entrance per role, the
// not-found page and the unexpected-error page. Synthetic memberships only.
const meta: Meta = { title: '画面/遷移の画面', parameters: { layout: 'fullscreen' } };
export default meta;

export const Workflows: StoryObj = {
  name: '勤務管理の業務（役割ごとの一覧）',
  parameters: { fetchRoutes: [{ path: '/planning/scopes', body: [
    { scope_id: 'hospital/pharmacy', person_id: 'p0', role: 'ADMIN' },
    { scope_id: 'hospital/ward', person_id: 'p0', role: 'LEADER' },
    { scope_id: 'clinic/outpatient', person_id: 'p0', role: 'PHARMACIST' },
  ] }] },
  render: () => <WorkflowIndex />,
};

export const NoMembership: StoryObj = {
  name: '勤務管理の業務（所属なし）',
  parameters: { fetchRoutes: [{ path: '/planning/scopes', body: [] }] },
  render: () => <WorkflowIndex />,
};

export const Missing: StoryObj = { name: 'ページが見つからない', render: () => <NotFound /> };

export const Failure: StoryObj = {
  name: '画面を表示できない（予期しない問題）',
  render: () => <ErrorPage error={Object.assign(new Error('synthetic'), { digest: 'synthetic-digest-0001' })} reset={() => {}} />,
};
