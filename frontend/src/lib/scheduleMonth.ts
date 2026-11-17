/** The year and month of a schedule address, or null when they are not a valid month. */
export function parseMonth(year: string, month: string): { year: number; month: number } | null {
  const y = Number(year);
  const m = Number(month);
  return Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12 ? { year: y, month: m } : null;
}
