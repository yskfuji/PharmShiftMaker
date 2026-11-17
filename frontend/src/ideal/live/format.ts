// Dates and times as the screens show them: Asia/Tokyo, numeric parts.
const TZ = "Asia/Tokyo";
const parts = (iso: string) => Object.fromEntries(new Intl.DateTimeFormat("ja-JP", {
  timeZone: TZ, month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(new Date(iso)).map((p) => [p.type, p.value])) as Record<string, string>;

export function dutyWhen(start: string, end: string): string {
  const a = parts(start); const b = parts(end);
  return `${a.month}月${a.day}日（${a.weekday}） ${a.hour}:${a.minute}–${b.hour}:${b.minute}`;
}

export function stamp(iso: string): string {
  const a = parts(iso);
  return `${a.month}/${a.day} ${a.hour}:${a.minute}`;
}

export const CASE_STATUS: Record<string, string> = {
  DRAFT: "指摘あり（公開できません）",
  AWAITING_CONSENT: "同意待ち",
  READY: "承認待ち",
  AWAITING_INDEPENDENT_APPROVAL: "別担当の承認待ち",
  APPROVED: "承認済み",
  WITHDRAWN: "取下げ",
  DECLINED: "同意の拒否",
  REJECTED: "責任者が却下",
};

export const OPEN_CASE = ["DRAFT", "AWAITING_CONSENT", "READY", "AWAITING_INDEPENDENT_APPROVAL"];
