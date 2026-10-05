// Build the view model from what the API returned, and nothing else: no coverage, queue or
// stability figure is shown until an endpoint provides it. A day without a published duty
// shows "—" (it is not necessarily leave). Times are shown in Asia/Tokyo.
import type { MetricModel, ScheduleDetail, WorkspaceModel } from "../model";
import type { IdealRole, IdealScreen, PlanningScopeSummary } from "../types";
import type { DailyOperationsSnapshot, DashboardSummary, ScheduleCalendarView, ScheduleStabilitySummary, WorkspaceNotification } from "../types";
import type { PublicationRead, PublishedDuty } from "./contracts";
import { WORKSPACE_NAV } from "@/features/workspace/generated/usecaseRoutes";

const TZ = "Asia/Tokyo";
const DAY_MS = 86_400_000;
// Display only: the server authorizes every read and change. The generated contract is
// the single source for which screens each role is offered.
export const API_NAV = WORKSPACE_NAV satisfies Record<IdealRole, readonly IdealScreen[]>;

const parts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(date).map((p) => [p.type, p.value])) as Record<string, string>;
const dayKey = (date: Date) => { const p = parts(date); return `${p.year}-${p.month}-${p.day}`; };
const hm = (date: Date) => { const p = parts(date); return `${p.hour}:${p.minute}`; };
const span = (duty: PublishedDuty) => `${hm(new Date(duty.start))}–${hm(new Date(duty.end))}`;

/** The publication covering ``now``, else the one with the latest period start. */
export function currentPublication(publications: PublicationRead[], now: Date): PublicationRead | null {
  const bounds = (p: PublicationRead) => p.period.split("|").map((v) => new Date(v).getTime());
  const covering = publications.find((p) => { const [a, b] = bounds(p); return a <= now.getTime() && now.getTime() < b; });
  return covering ?? [...publications].sort((x, y) => bounds(y)[0] - bounds(x)[0])[0] ?? null;
}

export function toWorkspaceModel(input: {
  scope: PlanningScopeSummary;
  publication: PublicationRead | null;
  names: Record<string, string>;
  viewerName: string;
  now: Date;
  exportUrl: (publicationId: string, format: "print" | "ical") => string;
  calendar?: ScheduleCalendarView | null;
  dashboard?: DashboardSummary | null;
  daily?: DailyOperationsSnapshot | null;
  stability?: ScheduleStabilitySummary | null;
  notifications?: WorkspaceNotification[];
}): WorkspaceModel {
  const { scope, publication, names, viewerName, now, calendar, dashboard, daily, stability, notifications = [] } = input;
  const version = publication ? `v${publication.version}` : "—";
  // Without a publication there is nothing verified: no "verified" claim is shown.
  const verified = publication !== null && publication.validation_status !== "revalidation_required";
  const calendarMatchesPublication = !publication || calendar?.publication?.publication_id === publication.publication_id;
  const duties = [...((calendarMatchesPublication ? calendar?.assignments : publication?.assignments) ?? publication?.assignments ?? []) as unknown as PublishedDuty[]];
  duties.sort((a, b) => a.start.localeCompare(b.start));
  const nameOf = (id: string) => (Object.hasOwn(names, id) ? names[id] : null) ?? (id === scope.person_id ? "あなた" : id);
  const own = duties.filter((d) => d.person_id === scope.person_id);
  const next = own.find((d) => new Date(d.end).getTime() > now.getTime()) ?? null;
  const today = parts(now);

  const calendarPeriod = publication?.period ?? calendar?.publication?.period ?? null;
  const periodStart = calendarPeriod ? new Date(calendarPeriod.split("|")[0]) : now;
  const periodEnd = calendarPeriod ? new Date(calendarPeriod.split("|")[1]) : new Date(periodStart.getTime() + 7 * DAY_MS);
  const dayCount = Math.max(1, Math.min(31, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / DAY_MS)));
  const week = Array.from({ length: dayCount }, (_, i) => new Date(periodStart.getTime() + i * DAY_MS));
  const changed = new Set(calendarMatchesPublication ? calendar?.changes.map((item) => item.duty_id) ?? [] : []);
  const people = Array.from(new Set(duties.map((d) => d.person_id))).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ja"));
  // Every duty that starts on the day (a night duty and a second duty are not dropped).
  const onDay = (person: string, day: Date) => duties.filter((d) => d.person_id === person && dayKey(new Date(d.start)) === dayKey(day));
  const details: Record<string, ScheduleDetail> = {};
  const rows = people.map((person) => ({
    id: person, name: nameOf(person), initial: nameOf(person).slice(0, 1), badge: person === scope.person_id ? "本人" : "",
    cells: week.map((day, i) => {
      const day_ = onDay(person, day);
      const id = `${person}-${i}`;
      if (day_.length) {
        const p = parts(day);
        details[id] = { title: `${nameOf(person)} · ${p.month}月${p.day}日`, facts: [...day_.flatMap((d) => [`${d.kind} ${span(d)}`, d.location]), `公開版 ${version}`],
          note: "公開済みの勤務です。変更は申請から行います（申請の接続は次の段です）。" };
      }
      return { id, shift: day_.length ? day_.map((d) => d.kind).join("・") : "—", time: day_.map(span).join(" / "), changed: day_.some((d) => changed.has(d.duty_id)) };
    }),
  }));
  const first = parts(week[0]);
  const last = parts(week[week.length - 1]);
  const ownCount: MetricModel = { label: "公開版の自分の勤務", value: `${own.length}件`, detail: `公開版 ${version}` };

  return {
    shell: {
      scopeLabel: scope.display_name,
      publication: { version, note: publication ? (verified ? "公開時に検証済み" : "再検証が必要") : "未公開" },
      user: { name: viewerName, initial: viewerName.slice(0, 1) },
      notifications: notifications.filter((item) => !item.read).length,
      footer: ["PharmShiftMaker · 理想UI（サーバーの記録を表示・変更）", "日本語 · Asia/Tokyo"],
      nav: API_NAV,
    },
    home: {
      personal: {
        eyebrow: "次の勤務",
        title: next ? `${parts(new Date(next.start)).month}月${parts(new Date(next.start)).day}日（${parts(new Date(next.start)).weekday}） ${span(next)}` : "予定されている勤務はありません",
        detail: next ? [next.location, next.kind, next.task].filter(Boolean).join(" · ") : `公開版 ${version} にあなたの勤務はありません`,
        when: next ? relativeDay(now, new Date(next.start)) : "—",
        countdown: next ? (new Date(next.start) > now ? `出勤まで ${Math.ceil((new Date(next.start).getTime() - now.getTime()) / 3_600_000)}時間` : "勤務中") : "",
        metrics: [ownCount],
        request: null,
      },
      team: {
        eyebrow: `${today.year}年${today.month}月${today.day}日 · ${today.weekday}曜日`,
        headline: publication
          ? { ADMIN: `公開版 ${version} を表示しています`, LEADER: `公開版 ${version} を表示しています` }
          : { ADMIN: "公開済みの勤務表はまだありません", LEADER: "公開済みの勤務表はまだありません" },
        detail: `${scope.display_name} · 最新公開版 ${version}`,
        sealTime: publication ? (verified ? "公開時" : "要再検証") : "—",
        metrics: [
          { label: "本日の予定勤務", value: daily ? `${daily.scheduled_count}件` : "—", detail: daily ? "在席・出勤実績ではありません" : "当日情報を確認できません" },
          { label: "判断待ち", value: daily ? `${daily.open_case_count}件` : `${dashboard?.metrics.pending_requests?.value ?? "—"}件`, detail: "欠勤・交換・申請" },
          { label: "未達通知", value: daily ? `${daily.undelivered_notification_count}件` : "—", detail: "配信処理の状態" },
          publication
            ? { label: "検証", value: verified ? "公開時に検証済み" : "再検証が必要", detail: "入力が更新されると再検証が必要です", tone: verified ? "good" : "warn" }
            : { label: "検証", value: "—", detail: "公開版がありません", tone: "neutral" },
        ],
        priorities: null,
        stability: stability ? {
          value: `${stability.change_event_count}件`,
          label: `公開 ${stability.publication_count}回`,
          bars: stability.days.map((item) => item.change_count),
          note: stability.meaning,
        } : null,
      },
    },
    schedule: {
      eyebrow: publication ? `公開版 ${version} · 公開済み` : "公開版なし",
      title: `${first.year}年${first.month}月`,
      summary: publication
        ? [{ tone: "good", label: `${scope.role === "PHARMACIST" ? "自分の公開勤務" : "公開勤務"} ${duties.length}件` }, ...(verified ? [] : [{ tone: "warn" as const, label: "再検証が必要" }])]
        : [{ tone: "warn", label: "公開版がありません" }],
      range: `表示期間 ${first.month}/${first.day}–${last.month}/${last.day}`,
      days: week.map((day) => { const p = parts(day); return { label: `${p.month}/${p.day} ${p.weekday}`, status: "公開済み", weekend: ["土", "日"].includes(p.weekday) }; }),
      rows,
      agenda: agendaFor(week[0], 0, people, onDay, nameOf, scope.person_id),
      agendas: week.map((day, index) => agendaFor(day, index, people, onDay, nameOf, scope.person_id)),
      initialSelected: Object.keys(details)[0] ?? "",
      details,
      defaultDetail: { title: "勤務の詳細", facts: [], note: "表の勤務を選ぶと、詳細を表示します。" },
      personalExport: publication ? { print: input.exportUrl(publication.publication_id, "print"), ical: input.exportUrl(publication.publication_id, "ical") } : null,
      departmentExport: publication && calendar?.can_export_department ? { scope: scope.scope_id, publication: publication.publication_id, version: publication.version } : null,
      showcaseActions: false,
    },
  };
}

function agendaFor(
  day: Date,
  index: number,
  people: string[],
  onDay: (person: string, day: Date) => PublishedDuty[],
  nameOf: (person: string) => string,
  viewer: string,
) {
  const p = parts(day);
  return {
    title: `${p.month}月${p.day}日（${p.weekday}）`,
    dayIndex: index,
    items: people.map((person) => {
      const duties = onDay(person, day);
      return {
        id: `${person}-${index}`,
        name: nameOf(person),
        initial: nameOf(person).slice(0, 1),
        badge: person === viewer ? "本人" : "",
        status: duties.length ? duties.map((d) => d.kind).join("・") : "勤務なし",
        tone: duties.length ? "good" as const : "neutral" as const,
      };
    }),
  };
}

/** Calendar days between two instants in Asia/Tokyo (0 = same day). */
function relativeDay(now: Date, then: Date): string {
  const serial = (d: Date) => { const p = parts(d); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)); };
  const days = Math.round((serial(then) - serial(now)) / DAY_MS);
  return days === 0 ? "今日" : days === 1 ? "明日" : `${days}日後`;
}
