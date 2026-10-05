// Japan time (UTC+9, no daylight saving) for fields and text, whatever the browser's own
// time zone is. Instants are kept as ISO strings; these only convert for entry and reading.
const NINE_HOURS = 9 * 3600000;

/** An ISO instant as the value of a `datetime-local` field in Japan time; "" when none.
 * In the form the browser itself reports (no seconds when they are zero), so a controlled
 * field is not written again while it is being typed into. */
export function toJstInput(iso: unknown): string {
  const at = typeof iso === "string" && iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return "";
  const local = new Date(at + NINE_HOURS).toISOString().slice(0, 19);
  return local.endsWith(":00") ? local.slice(0, 16) : local;
}

/** The ISO instant of a `datetime-local` value entered in Japan time; "" while incomplete. */
export function fromJstInput(local: string): string {
  const at = local ? Date.parse(`${local}+09:00`) : NaN;
  return Number.isNaN(at) ? "" : new Date(at).toISOString();
}

/** An ISO instant for reading: "2026-01-05 09:00". */
export const jstText = (iso: unknown): string => toJstInput(iso).replace("T", " ");

/** An ISO instant as Japan time with its offset, to the second ("2026-01-06T09:00:00+09:00"),
 * as the leave and ledger records are written; "" when none. */
export function jstOffsetText(iso: unknown): string {
  const local = toJstInput(iso);
  return local ? `${local.length === 16 ? `${local}:00` : local}+09:00` : "";
}
