import type { DailyOperationsSnapshot } from "@/ideal/types";
import { UNREADABLE_TIME, whenText } from "../../shared/format";
import { tokyoParts } from "../../shared/publishedDuties";
import { nameOf, type RouteContext } from "../../shell/routeTypes";
import { ChevronRight } from "lucide-react";
import { PENDING_DELIVERY, PENDING_DELIVERY_WHO, pendingDeliveryDetail } from "../../shared/outbox";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import TableScrollCue from "../../shared/TableScrollCue";

const readable = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const text = (value: unknown, missing = "—"): string => (typeof value === "string" && value ? value : missing);

/** The day of the snapshot for reading: "2026年10月12日（月）", or without its year where the
 * year was just said ("10月12日（月）"). A day that cannot be read is shown as the server sent it. */
function dayText(day: string, year = true): string {
  if (!readable(day)) return day;
  const p = tokyoParts(new Date(day));
  return `${year ? `${p.year}年` : ""}${p.month}月${p.day}日（${p.weekday}）`;
}

/** The hours of a duty of the day: "08:30–17:30". The day is said once, by the heading of
 * the list; an end on another day carries its date ("20:00–10/13 08:00"). */
function hours(start: unknown, end: unknown): string {
  if (!readable(start) || !readable(end)) return UNREADABLE_TIME;
  const [a, b] = [tokyoParts(new Date(start)), tokyoParts(new Date(end))];
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  return `${a.hour}:${a.minute}–${sameDay ? "" : `${b.month}/${b.day} `}${b.hour}:${b.minute}`;
}

/**
 * The day's scheduled duties and the counts beside them, as the server reports them and at
 * the time it counted them. Not attendance, and not whether the required staffing is met:
 * the server does not report that here. What each figure counts (routers/workflows.py,
 * daily_operations): the duties of the current publication that start on the day; the open
 * cases about a duty of the day, and how many of those are absences; the findings of those
 * cases' validation; the outbox records the audit delivery has not sent yet (the scope's for
 * a planner, the viewer's own otherwise, which `visibility` says; shared/outbox.ts says what
 * they are). A figure that counts something another route shows leads there: the duties to
 * the schedule, the cases and their findings to the list of cases (the whole list: the link
 * of the findings is named for that, and is there whatever the count is). The records
 * waiting for delivery have no screen; the line under the tiles says who acts on them.
 *
 * The figures are one card: its heading and the time of the count, the four tiles, the line
 * about the records waiting for delivery, and the server's own notes on the figures as a
 * reveal. Nothing that explains a figure stands outside the card of the figures.
 */
export default function TodayView({ data: snapshot, ctx }: { data: DailyOperationsSnapshot; ctx: RouteContext }) {
  const day = dayText(snapshot.day);
  const cases = routeOf("operations/cases").route;
  return <div className="ideal-stack">
    <section className="ideal-panel ideal-v3-today-summary"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">{day}</span><h2>予定上の勤務</h2><p>公開済みの勤務表にある今日の勤務と、それに関わる進行中のケースの件数です。{whenText(snapshot.observed_at)} 時点の内容です。</p></div></div>
    <div className="ideal-grid ideal-grid--4 ideal-v3-today-counts">
      <article className="ideal-metric"><p>予定勤務</p><strong>{snapshot.scheduled_count}件</strong><span>在席・出勤実績ではありません</span><WorkspaceLink className="ideal-link ideal-link--target" route={routeOf("schedule/index").route}>勤務表で見る <ChevronRight aria-hidden="true" /></WorkspaceLink></article>
      <article className="ideal-metric"><p>今日の勤務に関わるケース</p><strong>{snapshot.open_case_count}件</strong><span>進行中の欠勤・交換（うち欠勤 {snapshot.absence_case_count}件）</span><WorkspaceLink className="ideal-link ideal-link--target" route={cases}>ケースを開く <ChevronRight aria-hidden="true" /></WorkspaceLink></article>
      <article className={snapshot.coverage_finding_count ? "ideal-metric ideal-metric--warn" : "ideal-metric"}><p>ケースへの指摘</p><strong>{snapshot.coverage_finding_count}件</strong><span>ケースの検証で見つかった指摘</span><WorkspaceLink className="ideal-link ideal-link--target" route={cases}>ケースの一覧を開く <ChevronRight aria-hidden="true" /></WorkspaceLink></article>
      <article className="ideal-metric"><p>{PENDING_DELIVERY}</p><strong>{snapshot.undelivered_notification_count}件</strong><span>{pendingDeliveryDetail(snapshot.visibility === "department")}</span></article>
    </div>
    <p className="ideal-note ideal-v3-today-note">{PENDING_DELIVERY_WHO}</p>
    {snapshot.limitations.length > 0 && <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>この画面の数字について</summary><ul role="list" className="ideal-note-list">{snapshot.limitations.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
    </section>
    <section className="ideal-panel"><h2>{dayText(snapshot.day, false)}の勤務予定</h2>{snapshot.scheduled_assignments.length ? <><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label="今日の勤務予定" tabIndex={0}><table className="ideal-table">
      <thead><tr><th scope="col">職員</th><th scope="col">勤務</th><th scope="col">時間</th><th scope="col">業務</th><th scope="col">場所</th></tr></thead>
      <tbody>{snapshot.scheduled_assignments.map((row, index) => <tr key={String(row.duty_id ?? index)}>
        <th scope="row" data-verbatim>{nameOf(ctx, String(row.person_id ?? ""))}</th><td data-verbatim>{text(row.kind, "勤務")}</td><td>{hours(row.start, row.end)}</td><td data-verbatim>{text(row.task)}</td><td data-verbatim>{text(row.location)}</td>
      </tr>)}</tbody>
    </table></div></> : <p className="ideal-note">本日の予定勤務はありません。</p>}</section>
  </div>;
}
