// The schedule as the route shows it, built from what the server returned and nothing
// else. A day without a published duty shows "—" (it is not necessarily leave). Times are
// shown in Asia/Tokyo.
import type { PublishedDuty } from "@/ideal/api/contracts";
import type { ScheduleDetail, ScheduleModel } from "@/ideal/model";
import type { ScheduleCalendarView } from "@/ideal/types";
import { calendarMatches, DAY_MS, publishedDuties, span, tokyoParts, verifiedAtPublication, versionLabel } from "../shared/publishedDuties";
import type { RouteContext } from "../shell/routeTypes";

/** `agendas` has one entry per day shown, and at least one. */
export type ScheduleShown = Omit<ScheduleModel, "agenda" | "showcaseActions">;

const dayKey = (date: Date) => { const p = tokyoParts(date); return `${p.year}-${p.month}-${p.day}`; };

export function scheduleModel(
  ctx: Pick<RouteContext, "scope" | "publication" | "names" | "observedAt">,
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

  const period = publication?.period ?? calendar?.publication?.period ?? null;
  const periodStart = period ? new Date(period.split("|")[0]) : new Date(ctx.observedAt);
  const periodEnd = period ? new Date(period.split("|")[1]) : new Date(periodStart.getTime() + 7 * DAY_MS);
  const dayCount = Math.max(1, Math.min(31, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / DAY_MS)));
  const shown = Array.from({ length: dayCount }, (_, i) => new Date(periodStart.getTime() + i * DAY_MS));
  const changed = new Set(matches ? calendar?.changes.map((item) => item.duty_id) ?? [] : []);
  const people = Array.from(new Set(duties.map((d) => d.person_id))).sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ja"));
  // Every duty that starts on the day (a night duty and a second duty are not dropped).
  const onDay = (person: string, day: Date): PublishedDuty[] => duties.filter((d) => d.person_id === person && dayKey(new Date(d.start)) === dayKey(day));
  const badge = (person: string) => person === scope.person_id ? "本人" : "";

  const details: Record<string, ScheduleDetail> = {};
  const rows = people.map((person) => ({
    id: person, name: nameOf(person), initial: nameOf(person).slice(0, 1), badge: badge(person),
    cells: shown.map((day, i) => {
      const found = onDay(person, day);
      const id = `${person}-${i}`;
      if (found.length) {
        const p = tokyoParts(day);
        details[id] = { title: `${nameOf(person)} · ${p.month}月${p.day}日`, facts: [...found.flatMap((d) => [`${d.kind} ${span(d)}`, d.location]), `公開版 ${version}`],
          note: "公開済みの勤務です。変更は申請から行います（申請の接続は次の段です）。" };
      }
      return { id, shift: found.length ? found.map((d) => d.kind).join("・") : "—", time: found.map(span).join(" / "), changed: found.some((d) => changed.has(d.duty_id)) };
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
        };
      }),
    };
  });
  const first = tokyoParts(shown[0]);
  const last = tokyoParts(shown[shown.length - 1]);

  return {
    eyebrow: publication ? `公開版 ${version} · 公開済み` : "公開版なし",
    title: `${first.year}年${first.month}月`,
    summary: publication
      ? [{ tone: "good", label: `${scope.role === "PHARMACIST" ? "自分の公開勤務" : "公開勤務"} ${duties.length}件` }, ...(verified ? [] : [{ tone: "warn" as const, label: "再検証が必要" }])]
      : [{ tone: "warn", label: "公開版がありません" }],
    range: `表示期間 ${first.month}/${first.day}–${last.month}/${last.day}`,
    days: shown.map((day) => { const p = tokyoParts(day); return { label: `${p.month}/${p.day} ${p.weekday}`, status: "公開済み", weekend: ["土", "日"].includes(p.weekday) }; }),
    rows,
    agendas,
    initialSelected: Object.keys(details)[0] ?? "",
    details,
    defaultDetail: { title: "勤務の詳細", facts: [], note: "表の勤務を選ぶと、詳細を表示します。" },
    personalExport: publication ? { print: exportUrl(publication.publication_id, "print"), ical: exportUrl(publication.publication_id, "ical") } : null,
    departmentExport: publication && calendar?.can_export_department ? { scope: scope.scope_id, publication: publication.publication_id, version: publication.version } : null,
  };
}
