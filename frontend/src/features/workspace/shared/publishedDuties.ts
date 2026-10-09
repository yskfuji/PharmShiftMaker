// The published duties a route shows and the way their dates are written: Asia/Tokyo,
// numeric parts. Nothing here decides anything; it reads what the server returned.
import type { PublicationRead, PublishedDuty } from "@/ideal/api/contracts";
import type { ScheduleCalendarView } from "@/ideal/types";

export const DAY_MS = 86_400_000;

export const tokyoParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(date).map((p) => [p.type, p.value])) as Record<string, string>;

const hm = (date: Date) => { const p = tokyoParts(date); return `${p.hour}:${p.minute}`; };
export const span = (duty: PublishedDuty) => `${hm(new Date(duty.start))}–${hm(new Date(duty.end))}`;

export const versionLabel = (publication: PublicationRead | null) => publication ? `v${publication.version}` : "—";

/** Without a publication there is nothing verified: no "verified" claim is shown. */
export const verifiedAtPublication = (publication: PublicationRead | null) =>
  publication !== null && publication.validation_status !== "revalidation_required";

/** The calendar describes the selected publication, or no publication is selected. */
export const calendarMatches = (publication: PublicationRead | null, calendar: ScheduleCalendarView | null) =>
  !publication || calendar?.publication?.publication_id === publication.publication_id;

/** The duties to show, earliest first: the calendar's when it is of the selected
 * publication, otherwise the publication's own. */
export function publishedDuties(publication: PublicationRead | null, calendar: ScheduleCalendarView | null): PublishedDuty[] {
  const duties = [...((calendarMatches(publication, calendar) ? calendar?.assignments : publication?.assignments) ?? publication?.assignments ?? []) as unknown as PublishedDuty[]];
  return duties.sort((a, b) => a.start.localeCompare(b.start));
}
