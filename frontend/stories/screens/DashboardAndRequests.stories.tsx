import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import AlertCenterCard from '@/components/dashboard/AlertCenterCard';
import StaffLoadCard from '@/components/dashboard/StaffLoadCard';
import IdentityProvider from '@/components/IdentityProvider';
import AppLayout from '@/components/layout/AppLayout';
import PageHeader from '@/components/layout/PageHeader';
import LeaveQuotaManager from '@/components/LeaveQuotaManager';

import { scheduleRoutes } from '../scheduleFixtures';

// Dashboard cards and the leave quota table with rows, using synthetic names only.
const meta: Meta = { title: '画面/ダッシュボードと休暇', parameters: { fetchRoutes: scheduleRoutes } };
export default meta;

const load = (n: number) => Array.from({ length: n }, (_, i) => ({ personId: `synthetic-${i}`, displayName: `合成職員${'ABCDEF'[i]}`, role: i % 3 ? '薬剤師' : 'パート薬剤師',
  loadPercent: 40 + i * 11, nightCount: i % 3, eveningCount: (i + 1) % 3, warnings: i === 4 ? 2 : 0 }));

export const Dashboard: StoryObj = {
  name: 'ダッシュボードのカード',
  render: () => (
    <IdentityProvider><AppLayout currentPath="/dashboard">
      <PageHeader title="ダッシュボード" description="合成データの表示です。" />
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <StaffLoadCard snapshots={{ weekly: load(5), monthly: load(6) }} />
        <AlertCenterCard alerts={[
          { id: 'a1', title: '夜勤の不足', description: '1月8日の夜勤が1人不足しています。', timestamp: '2026-09-28T09:00:00+09:00', severity: 'critical', responsible: '合成管理者' },
          { id: 'a2', title: '連続勤務', description: '合成職員Bの連続勤務が6日に達しています。', timestamp: '2026-09-28T08:00:00+09:00', severity: 'warning' },
          { id: 'a3', title: '希望休の反映', description: '希望休を3件反映しました。', timestamp: '2026-09-27T17:00:00+09:00', severity: 'info' },
        ]} />
      </div>
    </AppLayout></IdentityProvider>
  ),
};

export const LeaveQuotas: StoryObj = {
  name: '休暇の数量（行あり）',
  render: () => (
    <IdentityProvider><AppLayout currentPath="/requests">
      <PageHeader title="希望休" description="合成データの表示です。" />
      <div className="mt-6"><LeaveQuotaManager initialYear={2026} initialMonth={1} /></div>
    </AppLayout></IdentityProvider>
  ),
};
