import type { DailyOperationsSnapshot } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { nameOf, type RouteContext } from "../../shell/routeTypes";

/** Today's scheduled duties as the server reports them. Not attendance. */
export default function TodayView({ data: snapshot, ctx }: { data: DailyOperationsSnapshot; ctx: RouteContext }) {
  return <div className="ideal-stack">
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">{snapshot.day}</span><h2>予定上の勤務</h2><p>{snapshot.limitations[0]}</p></div><StatusPill tone={snapshot.coverage_finding_count ? "warn" : "good"}>{snapshot.coverage_finding_count ? `指摘 ${snapshot.coverage_finding_count}件` : "サーバー検証済み"}</StatusPill></section>
    <div className="ideal-grid ideal-grid--3"><article className="ideal-metric"><p>予定勤務</p><strong>{snapshot.scheduled_count}</strong><span>在席・出勤実績ではありません</span></article><article className="ideal-metric"><p>進行中ケース</p><strong>{snapshot.open_case_count}</strong><span>欠勤・交換</span></article><article className="ideal-metric"><p>未配信通知</p><strong>{snapshot.undelivered_notification_count}</strong><span>通知処理の状態</span></article></div>
    <section className="ideal-panel"><h2>勤務予定</h2>{snapshot.scheduled_assignments.length ? <ul className="ideal-record-list">{snapshot.scheduled_assignments.map((row, index) => <li key={String(row.duty_id ?? index)}><strong>{nameOf(ctx, String(row.person_id ?? ""))}</strong><span>{String(row.kind ?? "勤務")} · {String(row.start ?? "")}–{String(row.end ?? "")}</span></li>)}</ul> : <p className="ideal-note">本日の予定勤務はありません。</p>}</section>
  </div>;
}
