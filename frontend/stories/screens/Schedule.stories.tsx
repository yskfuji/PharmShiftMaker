import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import IdentityProvider from '@/components/IdentityProvider';
import AppLayout from '@/components/layout/AppLayout';
import PageHeader from '@/components/layout/PageHeader';
import ScheduleWorkspace from '@/components/ScheduleWorkspace';

import { scheduleResponse, scheduleRoutes } from '../scheduleFixtures';

// The monthly schedule screen with a generated synthetic month (the audit app has no
// legacy schedule data, so this is where the calendar, matrix and warnings are seen).
const meta: Meta<{ role: string }> = {
  title: '画面/シフト表',
  args: { role: 'ADMIN' },
  parameters: { fetchRoutes: scheduleRoutes },
  render: ({ role }) => (
    <IdentityProvider><AppLayout currentPath="/schedule/2026/1" scheduleHref="/schedule/2026/1">
      <PageHeader title="2026年1月のシフト" description="合成データの勤務表です。" />
      <ScheduleWorkspace initialResponse={scheduleResponse()} year={2026} month={1} userRole={role} />
    </AppLayout></IdentityProvider>
  ),
};
export default meta;

export const Administrator: StoryObj<{ role: string }> = { name: '管理者（編集できる）' };
export const Pharmacist: StoryObj<{ role: string }> = { name: '薬剤師（閲覧のみ）', args: { role: 'PHARMACIST' } };
