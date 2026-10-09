// The schedule as the route shows it, built from what the server returned and nothing
// else. A day without a published duty shows "—" (it is not necessarily leave). Times are
// shown in Asia/Tokyo.
import type { PublishedDuty } from "@/ideal/api/contracts";
import type { ScheduleModel } from "@/ideal/model";
import type { ScheduleCalendarView } from "@/ideal/types";
import { calendarMatches, DAY_MS, publishedDuties, span, tokyoParts, verifiedAtPublication, versionLabel } from "../shared/publishedDuties";
import type { RouteContext } from "../shell/routeTypes";

/** One day of the period as a column: its date and weekday apart (a narrow column sets them
 * on two lines), whether it is a weekend, and whether it is the day the page was read. */
export type ScheduleDay = { label: string; date: string; weekday: string; weekend: boolean; today: boolean };
/** A cell of the table. `spans` are the hours of its duties, start and end apart, in the
 * order of `time` (a narrow column sets a duty's two times on two lines). */
export type ScheduleCell = ScheduleModel["rows"][number]["cells"][number] & { spans: { start: string; end: string }[] };

/** `agendas` has one entry per day shown, and at least one. A day carries no state of its
 * own: every duty shown is of the one publication the heading names. `initialDay` is the
 * day the table and the agenda open on: the day of the duty selected to begin with, else
 * today when the period holds it, else the first day. `initialReason` says whose duty is
 * selected to begin with; "" when none is. */
/** What is said of the selected duty. Its heading and facts are split into what someone
 * typed (a person's name, the name of a duty, a place: master data an administrator entered)
 * and what the product wrote (a date, hours, the version), so that only the typed part is
 * marked as such where it is shown. `who` is absent from the default, which is the product's
 * own sentence. */
export type ScheduleFact = { typed?: string; text?: string };
export type ShownDetail = { title: string; who?: string; when?: string; facts: ScheduleFact[]; note: string };

export type ScheduleShown = Omit<ScheduleModel, "agenda" | "agendas" | "showcaseActions" | "days" | "rows" | "details" | "defaultDetail"> & {
  details: Record<string, ShownDetail>;
  defaultDetail: ShownDetail;
  days: ScheduleDay[];
  rows: (Omit<ScheduleModel["rows"][number], "cells"> & { cells: ScheduleCell[] })[];
  /** A day's rows carry the hours of the duty (`time`, "" without one) and whether the
   * server lists it among the changes, as the table's cells do. */
  agendas: (Omit<ScheduleModel["agendas"][number], "items"> & { items: (ScheduleModel["agendas"][number]["items"][number] & { time: string; changed: boolean })[] })[];
  initialDay: number;
  initialReason: string;
  /** What the mark of a changed duty means, said under the table and the agenda: the
   * comparison the server made (routers/workflows.py, schedule calendar: this publication's
   * duties against those of the publication before it for the same period). "" when no duty
   * shown carries the mark. */
  changeNote: string;
};

const dayKey = (date: Date) => { const p = tokyoParts(date); return `${p.year}-${p.month}-${p.day}`; };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** The month `count` months from a month written "YYYY-MM" (calendar arithmetic only). */
export function shiftMonth(month: string, count: number): string {
  const [year, index] = month.split("-").map(Number);
  const at = year * 12 + (index - 1) + count;
  return `${String(Math.floor(at / 12)).padStart(4, "0")}-${String((at % 12) + 1).padStart(2, "0")}`;
}
/** The first instant of a month in Japan time. */
const monthStart = (month: string) => new Date(`${month}-01T00:00:00+09:00`);

export function scheduleModel(
  ctx: Pick<RouteContext, "scope" | "publication" | "names" | "observedAt"> & { /** The month the URL asks for ("YYYY-MM"). */ period?: string },
  calendar: ScheduleCalendarView | null,
  exportUrl: (publicationId: string, format: "print" | "ical") => string,
): ScheduleShown {
  const { scope, publication, names } = ctx;
  const version = versionLabel(publication);
  const verified = verifiedAtPublication(publication);
  const matches = calendarMatches(publication, calendar);
  const duties = publishedDuties(publication, calendar);
  // Own keys only: an identifier may be the name of something every object inherits.
  const nameOf = (id: string) => (Object.hasOwn(names, id) ? names[id] : null) ?? (id === scope.person_id ? "あなた" : id);

  // The days shown are those of the publication's period. Without a publication they are
  // the month the URL asks for, empty, so the page shows the period the frame names (and a
  // week from the observed day only when no month is named at all).
  const period = publication?.period ?? calendar?.publication?.period ?? null;
  const asked = ctx.period && MONTH.test(ctx.period) ? ctx.period : null;
  const periodStart = period ? new Date(period.split("|")[0]) : asked ? monthStart(asked) : new Date(ctx.observedAt);
  const periodEnd = period ? new Date(period.split("|")[1]) : asked ? monthStart(shiftMonth(asked, 1)) : new Date(periodStart.getTime() + 7 * DAY_MS);
  const dayCount = Math.max(1, Math.min(31, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / DAY_MS)));
  const shown = Array.from({ length: dayCount }, (_, i) => new Date(periodStart.getTime() + i * DAY_MS));
  const changed = new Set(matches ? calendar?.changes.map((item) => item.duty_id) ?? [] : []);
  const people = Array.from(new Set(duties.map((d) => d.person_id))).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ja"));
  // Every duty that starts on the day (a night duty and a second duty are not dropped).
  const onDay = (person: string, day: Date): PublishedDuty[] => duties.filter((d) => d.person_id === person && dayKey(new Date(d.start)) === dayKey(day));
  const badge = (person: string) => person === scope.person_id ? "本人" : "";

  const details: Record<string, ShownDetail> = {};
  const rows = people.map((person) => ({
    id: person, name: nameOf(person), initial: nameOf(person).slice(0, 1), badge: badge(person),
    cells: shown.map((day, i) => {
      const found = onDay(person, day);
      const id = `${person}-${i}`;
      if (found.length) {
        const p = tokyoParts(day);
        details[id] = { title: `${nameOf(person)} · ${p.month}月${p.day}日`, who: nameOf(person), when: `${p.month}月${p.day}日`, facts: [...found.flatMap((d): ScheduleFact[] => [{ typed: d.kind, text: span(d) }, { typed: d.location }]), { text: `公開版 ${version}` }],
          note: "公開済みの勤務です。変更は「申請」の画面から依頼します。" };
      }
      return { id, shift: found.length ? found.map((d) => d.kind).join("・") : "—", time: found.map(span).join(" / "), spans: found.map((d) => { const [start, end] = span(d).split("–"); return { start, end }; }), changed: found.some((d) => changed.has(d.duty_id)) };
    }),
  }));
  const agendas = shown.map((day, index) => {
    const p = tokyoParts(day);
    return {
      title: `${p.month}月${p.day}日（${p.weekday}）`,
      dayIndex: index,
      items: people.map((person) => {
        const found = onDay(person, day);
        return {
          id: `${person}-${index}`, name: nameOf(person), initial: nameOf(person).slice(0, 1), badge: badge(person),
          status: found.length ? found.map((d) => d.kind).join("・") : "勤務なし",
          tone: found.length ? "good" as const : "neutral" as const,
          time: found.map(span).join(" / "),
          changed: found.some((d) => changed.has(d.duty_id)),
        };
      }),
    };
  });
  const first = tokyoParts(shown[0]);
  const last = tokyoParts(shown[shown.length - 1]);
  // What is selected to begin with: the viewer's own next duty (the first of theirs that has
  // not ended when the page was read), when the period shown holds it. Nobody else's duty
  // is picked for the viewer: without one of their own nothing is selected, and the table
  // opens on today.
  const observed = new Date(ctx.observedAt);
  const dayIndex = (date: Date) => shown.findIndex((day) => dayKey(day) === dayKey(date));
  const next = duties.find((d) => d.person_id === scope.person_id && new Date(d.end).getTime() > observed.getTime());
  const nextDay = next ? dayIndex(new Date(next.start)) : -1;
  const today = dayIndex(observed);
  // The server compares with the publication before this one for the same period: a duty it
  // lists is one that was added or whose content differs. Without an earlier publication it
  // lists every duty as added (none can be changed), and the note says that instead.
  const marked = rows.some((row) => row.cells.some((cell) => cell.changed));
  const before = matches ? calendar?.previous_publication ?? null : null;
  const changeNote = !marked ? ""
    : before ? `同じ期間の直前の公開版（v${before.version}）と比べて、追加された勤務か、内容が変わった勤務です。`
    : "この期間に、比べる直前の公開版はありません。この公開版で加わった勤務に付きます。";

  return {
    eyebrow: publication ? `公開版 ${version} · 公開済み` : "公開版なし",
    title: `${first.year}年${first.month}月`,
    summary: publication
      ? [{ tone: "good", label: `${scope.role === "PHARMACIST" ? "自分の公開勤務" : "公開勤務"} ${duties.length}件` }, ...(verified ? [] : [{ tone: "warn" as const, label: "再検証が必要" }])]
      : [{ tone: "warn", label: "公開版がありません" }],
    range: `表示期間 ${first.month}/${first.day}–${last.month}/${last.day}`,
    days: shown.map((day, index) => { const p = tokyoParts(day); return { label: `${p.month}/${p.day} ${p.weekday}`, date: `${p.month}/${p.day}`, weekday: p.weekday, weekend: ["土", "日"].includes(p.weekday), today: index === today }; }),
    rows,
    agendas,
    initialSelected: nextDay >= 0 ? `${scope.person_id}-${nextDay}` : "",
    initialDay: Math.max(0, nextDay >= 0 ? nextDay : today),
    changeNote,
    initialReason: !next || nextDay < 0 ? "" : new Date(next.start).getTime() > observed.getTime() ? "あなたの次の勤務です。" : "いまのあなたの勤務です。",
    details,
    defaultDetail: { title: "勤務を選んでいません", facts: [], note: "表の勤務を選ぶと、ここに時間と場所を表示します。" },
    personalExport: publication ? { print: exportUrl(publication.publication_id, "print"), ical: exportUrl(publication.publication_id, "ical") } : null,
    departmentExport: publication && calendar?.can_export_department ? { scope: scope.scope_id, publication: publication.publication_id, version: publication.version } : null,
  };
}
