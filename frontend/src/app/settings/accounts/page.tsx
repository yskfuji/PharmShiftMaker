import type { Metadata } from "next";

import AppLayout from "@/components/layout/AppLayout";
import PageHeader from "@/components/layout/PageHeader";

import { AccountsView } from "./AccountsView";

// Desktop profile only: the API answers 404 unless AUTH_MODE=local.
export default function AccountsPage() {
  return (
    <AppLayout currentPath="/settings" scheduleHref="/schedule">
      <PageHeader title="利用者の管理" description="この PC で PharmShiftMaker を使う人のアカウントを追加し、パスワードの再設定やロックの解除を行います。" />
      <div className="mt-6 max-w-5xl">
        <AccountsView />
      </div>
    </AppLayout>
  );
}

export const metadata: Metadata = { title: "利用者の管理" };
