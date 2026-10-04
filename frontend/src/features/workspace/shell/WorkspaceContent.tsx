"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { browserNavigation } from "@/lib/browserNavigation";
import { roleLabels } from "@/ideal/data";
import { useWorkspace } from "@/ideal/providers/WorkspaceContext";
import HomeScreen from "@/ideal/screens/HomeScreen";
import ScheduleScreen from "@/ideal/screens/ScheduleScreen";
import IntegratedFeatureView from "@/ideal/screens/live/IntegratedFeatureView";
import { LiveHomeQueue } from "@/ideal/screens/live/LiveCaseScreens";
import { LoadingState, ProblemState } from "@/ideal/screens/shared";
import type { IdealScreen } from "@/ideal/types";
import { defaultWorkspaceView, workspaceViews } from "@/ideal/views";

export default function WorkspaceContent({ screen, view }: { screen: IdealScreen; view?: string }) {
  const source = useWorkspace();
  const [flash, setFlash] = useState<ReturnType<typeof browserNavigation.takeFlash>>(null);
  useEffect(() => setFlash(browserNavigation.takeFlash()), []);
  if (!source.model) {
    if (source.selectionRequired) return <section className="ideal-v3-choice" aria-labelledby="scope-choice-title"><span className="ideal-eyebrow">勤務場所</span><h2 id="scope-choice-title">施設・部署を選んでください</h2><p>表示範囲を選ぶまで、個人別の勤務情報は読み込みません。</p><div>{source.scopes.map((scope) => <button type="button" className="ideal-button ideal-button--secondary" key={scope.scope_id} onClick={() => source.chooseScope(scope.scope_id)}><span><strong>{scope.display_name}</strong><small>{roleLabels[scope.role]}</small></span><ChevronRight aria-hidden="true" /></button>)}</div></section>;
    return source.problem ? <ProblemState problem={source.problem} onAction={source.reload} /> : <LoadingState />;
  }
  const role = source.role ?? "PHARMACIST";
  const selectedView = view ?? defaultWorkspaceView(screen, role);
  const allowed = source.model.shell.nav[role].includes(screen) && (!selectedView || workspaceViews[screen]?.some((item) => item.key === selectedView && item.roles.includes(role)) !== false);
  if (!allowed) return <ProblemState problem={{ kind: "forbidden", code: "403", title: "この画面は、あなたの役割では開けません", body: "権限のある業務だけを表示します。URLや識別子を書き換えてもサーバー側で拒否されます。", action: "今日へ" }} onAction={() => browserNavigation.replace("/workspace/home")} />;
  let content: ReactNode;
  if (screen === "home") content = <HomeScreen role={role} model={source.model.home} queue={source.live && <LiveHomeQueue live={source.live} onNavigate={() => undefined} linkTo={() => "/workspace/operations/cases"} />} />;
  else if (screen === "schedule") content = <ScheduleScreen role={role} model={source.model.schedule} />;
  else if (!source.live || !selectedView) content = <LoadingState />;
  else content = <IntegratedFeatureView screen={screen} view={selectedView} live={source.live} />;
  return <>
    {flash === "change-approved" && <p className="ideal-done" role="status">承認し、新しい公開版を作成しました。勤務表で変更を確認できます。</p>}
    {flash === "plan-published" && <p className="ideal-done" role="status">計画を新しい公開版として公開しました。勤務表で直前版との差分を確認できます。</p>}
    {flash === "publication-cancelled" && <p className="ideal-done" role="status">公開を取り消し、通知を記録しました。</p>}
    {source.partialProblems.length > 0 && <section className="ideal-partial-problems" role="status" aria-labelledby="partial-problems-title">
      <h2 id="partial-problems-title">一部の情報を更新できませんでした</h2>
      <p>取得できた情報は表示しています。判断前に不足箇所を確認してください。</p>
      <ul>{source.partialProblems.map((item) => <li key={`${item.resource}:${item.status}`}><strong>{item.resource}</strong>（{item.status}）: {item.detail}</li>)}</ul>
      <button type="button" className="ideal-button ideal-button--secondary" onClick={source.reload}>不足情報を再読込み</button>
    </section>}
    {content}
  </>;
}
