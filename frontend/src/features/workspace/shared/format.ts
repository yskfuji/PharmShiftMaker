// Dates and times as the workspace's views show them to a reader (Asia/Tokyo). The two
// formatters of the screens are reused for what they format; nothing here throws on a value
// the server did not send or sent in another form: a view that lists many records (a Server
// Component) must not lose its whole route to one of them. A record table keeps
// "YYYY-MM-DD HH:MM" (shared/jst.ts): it is unambiguous in a dense column.
import { dutyWhen as screenDutyWhen, stamp as screenStamp } from "@/ideal/live/format";
import { DAY_MS } from "./publishedDuties";

/** What a view shows where an instant was expected and none can be read. */
export const UNREADABLE_TIME = "日時未確認";

const TZ = "Asia/Tokyo";
const instant = (value: unknown): Date | null => {
  const at = typeof value === "string" && value ? Date.parse(value) : NaN;
  return Number.isNaN(at) ? null : new Date(at);
};
const parts = (at: Date) => Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(at).map((part) => [part.type, part.value])) as Record<string, string>;

/**
 * True when every value given is an instant these formatters can read. A surface on which
 * something is decided (a confirmation, a decision) asks this before it offers its action:
 * where a date it shows reads 「日時未確認」, the person cannot know what they would confirm,
 * so the surface says so and does not offer the action (shared/ConfirmSurface takes the
 * reason as `confirmDisabledReason`). The formatters below never throw and never refuse; this
 * is how their caller learns that one of them had nothing to format.
 */
export function isReadableWhen(...values: unknown[]): boolean {
  return values.length > 0 && values.every((value) => instant(value) !== null);
}

/** A short stamp of one instant: "10/12 07:42", as the screens write it. `missing` is shown
 * when it cannot be read (the screens' own formatter throws there). */
export function stamp(value: unknown, missing: string = UNREADABLE_TIME): string {
  return instant(value) ? screenStamp(value as string) : missing;
}

/** When a duty is: "10月12日（月） 08:30–17:30", as the screens write it. `missing` is shown
 * when either end cannot be read. */
export function dutyWhen(start: unknown, end: unknown, missing: string = UNREADABLE_TIME): string {
  return instant(start) && instant(end) ? screenDutyWhen(start as string, end as string) : missing;
}

/** One instant for reading: "10月12日（月）08:30". `missing` is shown when it cannot be read. */
export function whenText(value: unknown, missing: string = UNREADABLE_TIME): string {
  const at = instant(value);
  if (!at) return missing;
  const a = parts(at);
  return `${a.month}月${a.day}日（${a.weekday}）${a.hour}:${a.minute}`;
}


/**
 * A period of whole days for reading, by its first and its LAST day:
 * "2026年10月1日（木）〜10月31日（土）". The server holds a period as the instant it starts and
 * the instant it ends, and the end is not part of it: a month is held as "the 1st 00:00 to
 * the 1st of the next month 00:00". Written with that end, a reader takes the next month's
 * first day for a day of the period. So where BOTH ends are exactly midnight in Japan time
 * and the end is after the start, the last day is the day before the end (one calendar day
 * back; Japan has no daylight saving, so that is 24 hours) and no time is shown. Any other
 * pair of ends (a duty, a period that starts at 08:30) is not a range of whole days: it is
 * shown as `periodText` shows it, to the minute, as the server sent it. Nothing else is
 * derived: no count of days, no rounding.
 */
export function wholeDaysText(start: unknown, end: unknown, missing: string = UNREADABLE_TIME): string {
  const [from, to] = [instant(start), instant(end)];
  if (!from || !to) return missing;
  const [a, e] = [parts(from), parts(to)];
  const midnight = (p: Record<string, string>) => `${p.hour}:${p.minute}` === "00:00";
  if (to.getTime() <= from.getTime() || !midnight(a) || !midnight(e) || from.getTime() % 60_000 !== 0 || to.getTime() % 60_000 !== 0) return periodText(start, end, missing);
  const b = parts(new Date(to.getTime() - DAY_MS));
  const head = `${a.year}年${a.month}月${a.day}日（${a.weekday}）`;
  if (a.year === b.year && a.month === b.month && a.day === b.day) return head;
  return `${head}〜${a.year === b.year ? "" : `${b.year}年`}${b.month}月${b.day}日（${b.weekday}）`;
}

/**
 * A period for reading, with its year: "2026年10月1日（木）00:00 〜 11月1日（日）00:00". The
 * end repeats only what differs from the start (the year, or the day when both are on one
 * day: "2026年10月12日（月）08:30 〜 17:30"). Both ends are shown as the server sent them;
 * nothing is rounded to a day.
 */
export function periodText(start: unknown, end: unknown, missing: string = UNREADABLE_TIME): string {
  const [from, to] = [instant(start), instant(end)];
  if (!from || !to) return missing;
  const [a, b] = [parts(from), parts(to)];
  const head = `${a.year}年${a.month}月${a.day}日（${a.weekday}）${a.hour}:${a.minute}`;
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  const tail = sameDay ? `${b.hour}:${b.minute}` : `${a.year === b.year ? "" : `${b.year}年`}${b.month}月${b.day}日（${b.weekday}）${b.hour}:${b.minute}`;
  return `${head} 〜 ${tail}`;
}
