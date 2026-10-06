// What the home route says, built from what the server returned and nothing else: no
// coverage, queue or stability figure is shown until an endpoint provides it. Times are
// shown in Asia/Tokyo. What each figure counts was read in the API: the daily snapshot
// (routers/workflows.py, daily_operations), the dashboard (application/dashboard.py) and the
// recent records (routers/workflows.py, schedule_stability).
import type { MetricModel } from "@/ideal/model";
import type { DailyOperationsSnapshot, DashboardSummary, ScheduleCalendarView, ScheduleChangeCase, ScheduleStabilitySummary } from "@/ideal/types";
import { OPEN_CASE } from "@/ideal/live/format";
import { asksMe } from "../shared/changeCases/cases";
import { PENDING_DELIVERY, pendingDeliveryDetail } from "../shared/outbox";
import { DAY_MS, publishedDuties, span, tokyoParts, verifiedAtPublication, versionLabel } from "../shared/publishedDuties";
import type { RouteContext } from "../shell/routeTypes";

/** What the home route reads. `null`: that read found nothing, or failed and is reported
 * beside the rest. */
export type HomeData = {
  calendar: ScheduleCalendarView | null;
  dashboard: DashboardSummary | null;
  daily: DailyOperationsSnapshot | null;
  stability: ScheduleStabilitySummary | null;
  cases: ScheduleChangeCase[] | null;
};

export type PersonalHome = { title: string; detail: string; when: string; countdown: string; metrics: MetricModel[] };
/** A figure of the home. `link`: the route that shows what the figure counts (today's
 * duties, the cases, the leave requests), among the ways out the home's contract names. A
 * figure no route shows in more detail has none. */
export type HomeMetric = MetricModel & { link?: "schedule" | "cases" | "today" | "leave" };
/** `heading`: today. `needs`: what waits for the viewer, in one sentence; "" when the cases
 * could not be read. `publication`: said only when the publication on screen needs saying
 * (there is none, or it must be verified again); what is published and that it was verified
 * is said once, by the frame. `changes`: the days of the window on which something was
 * recorded, as the server listed them, each with its date and count. */
export type TeamHome = {
  heading: string; needs: string; publication: string | null; metrics: HomeMetric[];
  stability: { value: string; label: string; window: string; changes: { day: string; count: string }[]; note: string } | null;
};

/** A day the server names as a date ("2026-10-11"), for reading: "10月11日（日）". */
function dayLabel(day: string): string {
  const date = new Date(day);
  if (Number.isNaN(date.getTime())) return "日付未確認";
  const p = tokyoParts(date);
  return `${p.month}月${p.day}日（${p.weekday}）`;
}

/** Calendar days between two instants in Asia/Tokyo (0 = same day). */
function relativeDay(now: Date, then: Date): string {
  const serial = (d: Date) => { const p = tokyoParts(d); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)); };
  const days = Math.round((serial(then) - serial(now)) / DAY_MS);
  return days === 0 ? "今日" : days === 1 ? "明日" : `${days}日後`;
}

/** The viewer's next duty and how many of the published duties are theirs. */
export function personalHome(ctx: RouteContext, calendar: ScheduleCalendarView | null): PersonalHome {
  const now = new Date(ctx.observedAt);
  const version = versionLabel(ctx.publication);
  const own = publishedDuties(ctx.publication, calendar).filter((d) => d.person_id === ctx.scope.person_id);
  const next = own.find((d) => new Date(d.end).getTime() > now.getTime()) ?? null;
  const start = next ? tokyoParts(new Date(next.start)) : null;
  return {
    title: next && start ? `${start.month}月${start.day}日（${start.weekday}） ${span(next)}` : "予定されている勤務はありません",
    detail: next ? [next.location, next.kind, next.task].filter(Boolean).join(" · ") : `公開版 ${version} にあなたの勤務はありません`,
    when: next ? relativeDay(now, new Date(next.start)) : "—",
    countdown: next ? (new Date(next.start) > now ? `出勤まで ${Math.ceil((new Date(next.start).getTime() - now.getTime()) / 3_600_000)}時間` : "勤務中") : "",
    metrics: [{ label: "公開版の自分の勤務", value: `${own.length}件`, detail: `公開版 ${version}` }],
  };
}

/**
 * The scope today: the day, what waits for the viewer, the day's counts and recent records.
 * Every figure is one the server counted, named by what it counts:
 *  - the day's duties, and the open cases about a duty of the day (the daily snapshot);
 *  - the requests of the period that await confirmation (the dashboard);
 *  - the outbox records the audit delivery has not sent yet (the snapshot; shared/outbox.ts).
 * The cases by state are counted beside them (HomeQueue) from the list of all open cases, so
 * the two can differ: a case about another day is in the list and not in the day's count.
 */
export function teamHome(ctx: RouteContext, { dashboard, daily, stability, cases }: Pick<HomeData, "dashboard" | "daily" | "stability" | "cases">): TeamHome {
  const publication = ctx.publication;
  const today = tokyoParts(new Date(ctx.observedAt));
  const queue = cases ? homeQueue(cases, ctx.scope.person_id) : null;
  const approvals = queue ? queue.counts.READY + queue.counts.AWAITING_INDEPENDENT_APPROVAL : 0;
  const waiting = queue ? [queue.asked.length ? `あなたへの同意の依頼が${queue.asked.length}件` : "", approvals ? `承認を待つケースが${approvals}件` : ""].filter(Boolean) : [];
  const pending = dashboard?.metrics.pending_requests;
  const [year, month] = ctx.period.split("-");
  const unread = "当日情報を確認できません";
  return {
    heading: `${today.year}年${today.month}月${today.day}日（${today.weekday}）`,
    needs: !queue ? "" : waiting.length ? `${waiting.join("、")}あります。` : "あなたへの依頼も、承認を待つケースもありません。",
    publication: !publication ? `${year}年${Number(month)}月の公開済みの勤務表は、まだありません。`
      : verifiedAtPublication(publication) ? null
        : `公開版 ${versionLabel(publication)} は再検証が必要です。公開した後に、もとになった記録が変わっています。`,
    metrics: [
      { label: "本日の予定勤務", value: daily ? `${daily.scheduled_count}件` : "—", detail: daily ? "在席・出勤実績ではありません" : unread, link: "today" },
      { label: "今日の勤務に関わるケース", value: daily ? `${daily.open_case_count}件` : "—", detail: daily ? "進行中の欠勤・交換のうち、今日の勤務が対象のもの" : unread, link: "cases" },
      { label: "確認待ちの申請", value: typeof pending?.value === "number" ? `${pending.value}件` : "—",
        detail: typeof pending?.value === "number" ? `${year}年${Number(month)}月にかかる申請だけの件数（休暇の画面は全期間の申請を表示）` : pending?.reason ?? "申請の集計を確認できません", link: "leave" },
      { label: PENDING_DELIVERY, value: daily ? `${daily.undelivered_notification_count}件` : "—", detail: daily ? `${pendingDeliveryDetail(daily.visibility === "department")}。送付は運用の処理が行います` : unread },
    ],
    stability: stability ? {
      value: `${stability.change_event_count}件`,
      label: `公開 ${stability.publication_count}回`,
      window: `過去${stability.window_days}日間`,
      changes: stability.days.filter((item) => item.change_count > 0).map((item) => ({ day: dayLabel(item.day), count: `${item.change_count}件` })),
      note: stability.meaning,
    } : null,
  };
}

/** The consents asked of the viewer, and how many open cases wait in each state. */
export function homeQueue(cases: ScheduleChangeCase[], personId: string) {
  const counts = { READY: 0, AWAITING_INDEPENDENT_APPROVAL: 0, AWAITING_CONSENT: 0, DRAFT: 0 } as Record<string, number>;
  for (const c of cases) if (OPEN_CASE.includes(c.status)) counts[c.status] += 1;
  return { asked: cases.filter((c) => asksMe(c, personId)), counts };
}
