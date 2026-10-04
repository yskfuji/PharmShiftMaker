import type { Metadata } from "next";
import ContextLink from "@/components/ContextLink";
import AppLayout from "@/components/layout/AppLayout";
import PageHeader from "@/components/layout/PageHeader";
import LiveDashboard from "@/components/dashboard/LiveDashboard";
import { Button } from "@/components/ui/Button";

export default async function DashboardPage() {
  const now = new Date();
  const [year, month] = new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit"}).format(now).split("-");
  const latestSchedulePath = `/planning?period=${year}-${month}`;

  return (
    <AppLayout currentPath="/dashboard" scheduleHref={latestSchedulePath}>
      <PageHeader
        title="ダッシュボード"
        description="シフト生成状況とアラートの概要を確認"
        actions={(
          <Button asChild>
            <ContextLink href="/planning">
              勤務表・計画を開く
            </ContextLink>
          </Button>
        )}
      />

      <LiveDashboard initialPeriod={new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit"}).format(now)} />
    </AppLayout>
  );
}

export const metadata: Metadata = { title: "ダッシュボード" };
