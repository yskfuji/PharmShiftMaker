import type { Metadata } from "next";
import AppLayout from '@/components/layout/AppLayout';
import PageHeader from '@/components/layout/PageHeader';
import PlanningWorkspace from '@/components/PlanningWorkspace';

export default function PlanningPage() {
  return <AppLayout currentPath="/planning"><div className="planning-page mx-auto max-w-7xl space-y-6">
    <PageHeader title="勤務表・計画" description="公開勤務と作業中の案を確認します。契約・必要配置から案を作り、検証・確認した同じ版を公開します。" />
    <PlanningWorkspace />
  </div></AppLayout>;
}

export const metadata: Metadata = { title: "勤務表・計画" };
