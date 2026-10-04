import type { Metadata } from "next";

import AppLayout from "@/components/layout/AppLayout";
import PageHeader from "@/components/layout/PageHeader";
import FlexAdoptionSettings from "@/components/FlexAdoptionSettings";

// Facility-wide working-time arrangements. The placeholders that were here
// (notification and token settings) had no function and were removed.
export default async function SettingsPage() {

  return (
    <AppLayout currentPath="/settings" scheduleHref="/schedule">
      <PageHeader title="施設設定" description="施設全体の労働時間制度の採用を登録し、別の管理者が確認します。" />
      <div className="mt-6 max-w-4xl">
        <FlexAdoptionSettings />
      </div>
    </AppLayout>
  );
}

export const metadata: Metadata = { title: "施設設定" };
