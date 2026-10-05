// What the home route says, built from what the server returned and nothing else: no
// coverage, queue or stability figure is shown until an endpoint provides it. Times are
// shown in Asia/Tokyo.
import type { MetricModel } from "@/ideal/model";
import type { DailyOperationsSnapshot, DashboardSummary, ScheduleCalendarView, ScheduleChangeCase, ScheduleStabilitySummary } from "@/ideal/types";
import { OPEN_CASE } from "@/ideal/live/format";
import { asksMe } from "../shared/changeCases/cases";
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
export type TeamHome = {
  eyebrow: string; headline: string; detail: string; sealTime: string; metrics: MetricModel[];
  stability: { value: string; label: string; bars: number[]; note: string } | null;
};

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

/** The scope today: the publication on screen, today's counts and recent changes. */
export function teamHome(ctx: RouteContext, { dashboard, daily, stability }: Pick<HomeData, "dashboard" | "daily" | "stability">): TeamHome {
  const publication = ctx.publication;
  const version = versionLabel(publication);
  const verified = verifiedAtPublication(publication);
  const today = tokyoParts(new Date(ctx.observedAt));
  return {
    eyebrow: `${today.year}年${today.month}月${today.day}日 · ${today.weekday}曜日`,
    headline: publication ? `公開版 ${version} を表示しています` : "公開済みの勤務表はまだありません",
    detail: `${ctx.scope.display_name} · 最新公開版 ${version}`,
    sealTime: publication ? (verified ? "公開時" : "要再検証") : "—",
    metrics: [
      { label: "本日の予定勤務", value: daily ? `${daily.scheduled_count}件` : "—", detail: daily ? "在席・出勤実績ではありません" : "当日情報を確認できません" },
      { label: "判断待ち", value: daily ? `${daily.open_case_count}件` : `${dashboard?.metrics.pending_requests?.value ?? "—"}件`, detail: "欠勤・交換・申請" },
      { label: "未達通知", value: daily ? `${daily.undelivered_notification_count}件` : "—", detail: "配信処理の状態" },
      publication
        ? { label: "検証", value: verified ? "公開時に検証済み" : "再検証が必要", detail: "入力が更新されると再検証が必要です", tone: verified ? "good" : "warn" }
        : { label: "検証", value: "—", detail: "公開版がありません", tone: "neutral" },
    ],
    stability: stability ? {
      value: `${stability.change_event_count}件`,
      label: `公開 ${stability.publication_count}回`,
      bars: stability.days.map((item) => item.change_count),
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
