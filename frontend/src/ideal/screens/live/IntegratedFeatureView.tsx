"use client";

import ActualReconciliation from "@/features/workspace/governance/ActualReconciliation";
import ComplianceWorkspace from "@/features/workspace/shared/ComplianceWorkspace";
import FlexTimeSettings from "@/features/workspace/settings/FlexTimeSettings";
import LeaveRequestWorkspace from "@/features/workspace/requests/LeaveRequestWorkspace";
import { PlanningDraftView, PlanningInputView, PlanningPublicationsView } from "@/features/workspace/planning/PlanningRouteViews";
import ThemeToggle from "@/components/ThemeToggle";
import type { LiveApi } from "../../live/context";
import { useResource } from "../../live/useResource";
import type { DailyOperationsSnapshot, WorkspaceNotification } from "../../types";
import { Loaded } from "../../live/parts";
import { stamp } from "../../live/format";
import { StatusPill } from "../shared";
import { LiveGovernance, LivePeople, LiveSettings } from "./LiveAdminScreens";
import { LiveOperations, LiveRequests } from "./LiveCaseScreens";
import { LivePlan } from "./LivePlan";

type Props = { screen: string; view: string; live: LiveApi };

const jstDay = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function IntegratedFeatureView({ screen, view, live }: Props) {
  if (screen === "plan") {
    if (view === "generate" || view === "compare") return <LivePlan live={live} view={view} />;
    if (view === "input") return <PurposeSurface tone="process"><PlanningInputView live={live} /></PurposeSurface>;
    if (view === "drafts") return <PurposeSurface tone="process"><PlanningDraftView live={live} /></PurposeSurface>;
    return <PurposeSurface tone="process"><PlanningPublicationsView live={live} /></PurposeSurface>;
  }
  if (screen === "operations") return view === "today" ? <DailyOperations live={live} /> : <LiveOperations live={live} />;
  if (screen === "requests") {
    if (view === "leave") return <PurposeSurface><LeaveRequestWorkspace scope={live.scopeId} personId={live.personId} canReview={live.role !== "PHARMACIST"} onChanged={live.refresh} /><ComplianceWorkspace scope={live.scopeId} personId={live.personId} role={live.role} section="leave" onChanged={live.refresh} /></PurposeSurface>;
    if (view === "outside") return <PurposeSurface><ComplianceWorkspace scope={live.scopeId} personId={live.personId} role={live.role} section="outside" onChanged={live.refresh} /></PurposeSurface>;
    return <LiveRequests live={live} mode={view === "swap" ? "swap" : "mine"} />;
  }
  if (screen === "people") {
    if (view === "contracts") return <PurposeSurface><ComplianceWorkspace scope={live.scopeId} personId={live.personId} targetPersonId={live.selectedPersonId ?? undefined} role={live.role} section="contracts" onChanged={live.refresh} /></PurposeSurface>;
    return <LivePeople live={live} view={view as "directory" | "memberships" | "lifecycle"} />;
  }
  if (screen === "governance") {
    if (view === "actuals") return <PurposeSurface tone="process"><ActualReconciliation scope={live.scopeId} /></PurposeSurface>;
    if (view === "privacy") return <PurposeSurface><ComplianceWorkspace scope={live.scopeId} personId={live.selectedPersonId ?? live.personId} role={live.role} section="privacy" onChanged={live.refresh} /></PurposeSurface>;
    if (view === "recovery") return <RecoveryStatus live={live} />;
    return <LiveGovernance live={live} />;
  }
  if (screen === "settings") {
    if (view === "notifications") return <NotificationInbox live={live} />;
    if (view === "absence-consent") return <LiveSettings live={live} />;
    if (view === "flextime") return <PurposeSurface tone="process"><FlexTimeSettings scopeId={live.scopeId} /></PurposeSurface>;
    return <AppearanceSettings />;
  }
  return null;
}

function PurposeSurface({ children, tone = "work" }: { children: React.ReactNode; tone?: "work" | "process" }) {
  return <div className={`ideal-v3-purpose ideal-v3-purpose--${tone}`}>{children}</div>;
}

function DailyOperations({ live }: { live: LiveApi }) {
  const day = jstDay();
  const resource = useResource(() => live.client.dailyOperations(live.scopeId, day), `${live.scopeId}|${day}`);
  return <div className="ideal-stack"><Loaded resource={resource}>{(snapshot: DailyOperationsSnapshot) => <>
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">{snapshot.day}</span><h2>予定上の勤務</h2><p>{snapshot.limitations[0]}</p></div><StatusPill tone={snapshot.coverage_finding_count ? "warn" : "good"}>{snapshot.coverage_finding_count ? `指摘 ${snapshot.coverage_finding_count}件` : "サーバー検証済み"}</StatusPill></section>
    <div className="ideal-grid ideal-grid--3"><article className="ideal-metric"><p>予定勤務</p><strong>{snapshot.scheduled_count}</strong><span>在席・出勤実績ではありません</span></article><article className="ideal-metric"><p>進行中ケース</p><strong>{snapshot.open_case_count}</strong><span>欠勤・交換</span></article><article className="ideal-metric"><p>未配信通知</p><strong>{snapshot.undelivered_notification_count}</strong><span>通知処理の状態</span></article></div>
    <section className="ideal-panel"><h2>勤務予定</h2>{snapshot.scheduled_assignments.length ? <ul className="ideal-record-list">{snapshot.scheduled_assignments.map((row, index) => <li key={String(row.duty_id ?? index)}><strong>{live.nameOf(String(row.person_id ?? ""))}</strong><span>{String(row.kind ?? "勤務")} · {String(row.start ?? "")}–{String(row.end ?? "")}</span></li>)}</ul> : <p className="ideal-note">本日の予定勤務はありません。</p>}</section>
  </>}</Loaded></div>;
}

function NotificationInbox({ live }: { live: LiveApi }) {
  const resource = useResource(() => live.client.notifications(live.scopeId), live.scopeId);
  return <section className="ideal-panel" aria-labelledby="notification-title"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">本人宛て</span><h2 id="notification-title">通知</h2></div></div><Loaded resource={resource}>{(items: WorkspaceNotification[]) => items.length ? <ol className="ideal-timeline">{items.map((item) => <li key={item.event_id}><span /><div><strong>{item.kind}</strong><p>{item.publication_id ? `公開版 ${item.version ?? "—"}` : item.category}</p>{!item.read && <button type="button" className="ideal-button ideal-button--secondary" onClick={() => void live.client.markNotificationRead(live.scopeId, item.event_id).then(async () => { await resource.reload(); await live.refresh(); })}>確認しました</button>}</div><time dateTime={item.created_at}>{stamp(item.created_at)}</time></li>)}</ol> : <p className="ideal-note">未確認の通知はありません。</p>}</Loaded></section>;
}

function RecoveryStatus({ live }: { live: LiveApi }) {
  type Recovery = { state: string; manifest_hash: string | null; note: string };
  const resource = useResource(() => live.client.request<Recovery>(`/compliance/recovery-status?scope_id=${encodeURIComponent(live.scopeId)}`), live.scopeId);
  const labels: Record<string, string> = { NO_RESTORE_RECORDED: "復元実行の記録なし", REPLAYED: "消去制御の再適用済み", QUARANTINED: "通常接続を遮断中" };
  return <section className="ideal-panel" aria-labelledby="recovery-title"><span className="ideal-eyebrow">復旧後の照合</span><h2 id="recovery-title">復元先の状態</h2><Loaded resource={resource}>{(value: Recovery) => <div className="ideal-stack"><StatusPill tone={value.state === "QUARANTINED" ? "warn" : "good"}>{labels[value.state] ?? value.state}</StatusPill><dl className="ideal-definition-list"><div><dt>制御ハッシュ</dt><dd>{value.manifest_hash ?? "未記録"}</dd></div><div><dt>説明</dt><dd>{value.note}</dd></div></dl></div>}</Loaded></section>;
}

function AppearanceSettings() {
  return <section className="ideal-panel" aria-labelledby="appearance-title"><span className="ideal-eyebrow">表示</span><h2 id="appearance-title">外観と動き</h2><p>端末設定を初期値として、明るい配色と暗い配色を選べます。動きを減らす設定、強制色、文字間隔の指定は端末・ブラウザの設定を尊重します。</p><div className="ideal-actions"><ThemeToggle /></div></section>;
}
