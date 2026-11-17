import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import FlexAdoptionSettings from '@/components/FlexAdoptionSettings';
import GlobalNavigation from '@/components/GlobalNavigation';
import IdentityProvider from '@/components/IdentityProvider';
import AppLayout from '@/components/layout/AppLayout';
import PageHeader from '@/components/layout/PageHeader';

import { adoption, identityRoute, impact, listing, scopes } from '../fixtures';

// The facility settings screen inside its page frame, answered by synthetic JSON.
const meta: Meta = {
  title: '画面/施設の設定',
  render: () => (
    <IdentityProvider><AppLayout currentPath="/settings">
      <PageHeader title="施設の設定" description="施設全体の労働時間制度の採用を登録し、別の管理者が確認します。" />
      <div className="mt-6 max-w-4xl"><FlexAdoptionSettings /></div>
    </AppLayout></IdentityProvider>
  ),
};
export default meta;

const routes = (answer: unknown) => [
  identityRoute,
  { path: '/planning/scopes', body: scopes },
  { path: '/planning/compliance/flex-adoptions', body: answer },
  { path: /\/impact$/, body: impact },
];

export const NotAdopted: StoryObj = { name: '未採用（既定）', parameters: { fetchRoutes: routes(listing()) } };

export const AwaitingConfirmation: StoryObj = {
  name: '確認待ち（別の管理者が表示）',
  parameters: { fetchRoutes: routes(listing({ viewer: 'leader', adoptions: [{ entity_id: 'flex-1', revision: 1, payload: adoption('registered') }] })) },
};

export const Adopted: StoryObj = {
  name: '採用中',
  parameters: { fetchRoutes: routes(listing({ adoptions: [{ entity_id: 'flex-1', revision: 2, payload: adoption('confirmed') }] })) },
};

export const Navigation: StoryObj = {
  name: '主な画面の導線',
  render: () => <div className="p-4"><GlobalNavigation current="/settings" /></div>,
};
