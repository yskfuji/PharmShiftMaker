import {getLegacyIdentityContext} from '@/lib/identity-server';
import ContextLink from '@/components/ContextLink';
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

import AppLayout from "@/components/layout/AppLayout";
import PageHeader from "@/components/layout/PageHeader";
import ScheduleWorkspace from "@/components/ScheduleWorkspace";
import { Button } from "@/components/ui/Button";
import { getConfirmedSchedule } from "@/lib/apiClient";
import { parseMonth } from "@/lib/scheduleMonth";
import NotFound, { NOT_FOUND_METADATA } from "@/app/not-found";

interface PageParams {
  params: Promise<{ year: string; month: string }>;
}

function buildNav(year: number, month: number) {
  const current = new Date(Date.UTC(year, month - 1, 1));
  const prev = new Date(current);
  prev.setUTCMonth(current.getUTCMonth() - 1);
  const next = new Date(current);
  next.setUTCMonth(current.getUTCMonth() + 1);
  return {
    prevPath: `/schedule/${prev.getUTCFullYear()}/${prev.getUTCMonth() + 1}`,
    nextPath: `/schedule/${next.getUTCFullYear()}/${next.getUTCMonth() + 1}`,
  };
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { year: y, month: m } = await params;
  const parsed = parseMonth(y, m);
  return parsed ? { title: `${parsed.year}年${parsed.month}月のシフト` } : NOT_FOUND_METADATA;
}

export default async function SchedulePage({ params }: PageParams) {
  const { year: y, month: m } = await params;
  const parsed = parseMonth(y, m);
  if (!parsed) return <NotFound />; // the layout shows it first; kept here for the page alone
  const { year, month } = parsed;
  const userRole = (await getLegacyIdentityContext())?.effective_role ?? 'UNAVAILABLE';
  let response;
  let loadError: unknown;
  try { response = await getConfirmedSchedule(year, month); }
  catch (error) { loadError = error; }
  if (response) {
    const { prevPath, nextPath } = buildNav(year, month);
    const currentPath = `/schedule/${year}/${month}`;

    return (
      <AppLayout currentPath={currentPath} scheduleHref={currentPath}>
        <PageHeader
          context={<ContextLink href="/planning/workflows" className="inline-flex min-h-11 items-center underline">業務管理 / 互換管理</ContextLink>}
          title={`${year}年 ${month}月 旧保存シフト`}
          description="旧形式の保存記録です。現在の公開勤務は「勤務表・計画」で確認してください。旧記録の表示は法令適合の確認を意味しません。"
          actions={(
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={prevPath} className="flex items-center gap-2">
                  <ChevronLeft className="h-4 w-4" /> 前の月
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={nextPath} className="flex items-center gap-2">
                  次の月 <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={currentPath} className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" /> 再読み込み
                </Link>
              </Button>
            </>
          )}
        />

        {/* Keyed by the generated version: reloading the same URL brings new data, and the
            workspace keeps its state in useState, so a new version must remount it. */}
        <ScheduleWorkspace key={`${response.generatedAt}-${response.lockVersion ?? "none"}`}
          initialResponse={response} year={year} month={month} userRole={userRole} />
      </AppLayout>
    );
  } else {
    const message = loadError instanceof Error ? loadError.message : String(loadError);
    const currentPath = `/schedule/${year}/${month}`;
    // lib/apiClient reports the API status as "... confirmed schedule (NNN): detail".
    const status = Number(/confirmed schedule \((\d{3})\)/.exec(message)?.[1] ?? 0);
    // Signed out: sign in again and come back. Signed in without permission: say so here
    // (sending a signed-in user to the sign-in page again would only repeat the refusal).
    if (status === 401) {
      redirect(`/login?redirectTo=${encodeURIComponent(currentPath)}`);
    }
    const forbidden = status === 403;
    // The API's own 404 (no confirmed schedule stored for this month) is a state, not a
    // failure; any other 404 (e.g. a wrong API address) stays a failure.
    const missing = status === 404 && message.includes("確定済みシフトが存在しません");
    const title = forbidden ? "シフトを表示する権限がありません" : missing ? `${year}年${month}月の確定済みシフトはありません` : "シフトの取得に失敗しました";
    const description = forbidden ? "このアカウントの役割では、この月のシフトを表示できません。管理者に確認してください。"
      : missing ? "この月のシフトはまだ確定・保存されていません。勤務表の作成と公開は「勤務計画・公開」で行います。"
      : `理由：${message}`;

    return (
      <AppLayout currentPath={currentPath} scheduleHref={currentPath}>
        <PageHeader context="互換管理 — 旧保存シフト" title={title} description={description} />
        <div className="mt-6 flex flex-wrap gap-3">
          {missing && (
            <a href="/planning" className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-hover transition-colors">
              勤務計画・公開へ
            </a>
          )}
          {!forbidden && !missing && (
            <Link href={currentPath} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:bg-primary-hover transition-colors">
              再読み込み
            </Link>
          )}
          <Link href="/dashboard" className="inline-flex min-h-11 items-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-fg hover:bg-muted transition-colors">
            ダッシュボードに戻る
          </Link>
        </div>
      </AppLayout>
    );
  }
}
