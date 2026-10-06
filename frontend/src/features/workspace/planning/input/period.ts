// The period of an input version for reading (plan/input and plan/generate).
import { wholeDaysText } from "../../shared/format";

/** Both ends at midnight (Japan time) are whole days: "2026年10月1日（木）〜10月31日（土）",
 * the last day being the one before the end the server holds (the end is not part of the
 * period). Any other pair of ends is shown as it is, to the minute (shared/format.ts). */
export function periodDays(period: { start: string; end: string }): string {
  return wholeDaysText(period.start, period.end);
}
