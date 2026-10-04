import {getLegacyIdentityContext} from '@/lib/identity-server';
import ContextLink from '@/components/ContextLink';
import type { Metadata } from "next";
import LeaveQuotaManager from "@/components/LeaveQuotaManager";
import AppLayout from "@/components/layout/AppLayout";
import PageHeader from "@/components/layout/PageHeader";

export default async function RequestsPage() {
  const role = (await getLegacyIdentityContext())?.effective_role ?? 'UNAVAILABLE';
  const canRead = ["LEADER", "ADMIN", "DEVELOPER"].includes(role);
  const canEdit = ["ADMIN", "DEVELOPER"].includes(role);
  const now = new Date();
  return <AppLayout currentPath="/requests">
    <PageHeader context={<ContextLink href="/planning/workflows" className="inline-flex min-h-11 items-center underline">業務管理 / 互換管理</ContextLink>}
      title="旧休暇枠" description="旧形式の年間枠と消化状況を参照します。現在の年休正本・請求・取得義務とは別の記録です。" />
    <p className="mt-4">現在の休暇請求・残高・取得実績は <ContextLink href="/planning/workflows/leave" className="text-primary underline">休暇の業務画面</ContextLink> で確認してください。</p>
    {canRead ? <LeaveQuotaManager initialYear={now.getFullYear()} initialMonth={now.getMonth()+1} canEdit={canEdit} />
      : <p role="alert" className="mt-6 rounded-lg border border-line p-4">旧休暇枠を参照する権限がありません。本人の請求・残高は休暇の業務画面で確認できます。</p>}
  </AppLayout>;
}
export const metadata: Metadata = { title: "旧休暇枠 — 互換管理" };
