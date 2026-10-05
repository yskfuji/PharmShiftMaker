// The facility's flextime adoptions as the route shows them. Display only: which step is
// open to the viewer, and on which days, is the server's answer on each record
// (`actions`, `settlement_starts`); nothing here derives it from a status or from a clock.
import { jstText } from "../../shared/jst";
import { EVIDENCE_STATUS, type RecordEvidence } from "../../shared/records/evidence";
import type { Fact } from "../../shared/records/facts";
import { PlanningError } from "@/lib/planningTransport";
import type { AdoptionRow, AdoptionTerms, EnrollmentRow, FlexImpact, FlexListing, FlexSettlements, FlexStatus, TimeWindow } from "../api";

/** The settlement of the scope's input, or why the server has none to compute it from yet. */
export type SettlementState = { available: true; result: FlexSettlements } | { available: false; reason: string };
export type FlextimeData = { listing: FlexListing; settlement: SettlementState | null };

/** A 409 says the scope has no input version the settlement can be computed from yet. */
export const settlementOrNotYet = (read: Promise<FlexSettlements>): Promise<SettlementState> =>
  read.then((result): SettlementState => ({ available: true, result }), (error: unknown) => {
    if (error instanceof PlanningError && error.status === 409) return { available: false, reason: error.message.replace(/^\d{3}: /, "") };
    throw error;
  });

export const STATUS_LABEL: Record<FlexStatus, string> = { registered: "確認待ち", confirmed: "採用中", withdrawn: "取下げ済み" };
export const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
export const RULE_LABEL: Record<AdoptionTerms["total_hours_rule"], string> = { statutory_frame: "法定の枠（清算期間の暦日数 ÷ 7 × 40時間）", full_two_day_weekend: "完全週休2日制の特例（8時間 × 所定労働日数）" };
const NONE = "（なし）";

/** The Japan-time day of an instant ("2027-04-01"). */
export const dayOf = (instant: string) => jstText(instant).slice(0, 10);
/** The last day of a period whose end is exclusive: people read the last day. */
export const lastDayOf = (end: string) => { const day = dayOf(end); return day ? new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : ""; };
/** Seconds as h:mm. */
export const midnightOf = (day: string) => `${day}T00:00:00+09:00`;
export const hm = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
const windowsText = (windows: TimeWindow[] | undefined) => (windows?.length ? windows.map((item) => `${item.start.slice(0, 5)}〜${item.end.slice(0, 5)}`).join("、") : "定めなし");
const evidenceText = (evidence: RecordEvidence) => `${evidence.reference || NONE}（${EVIDENCE_STATUS[evidence.status] ?? evidence.status}${evidence.status === "verified" && evidence.verified_by ? `・${evidence.verified_by}` : ""}）`;

/** Names for what the listing identifies. An account has no name here: it is the viewer or
 * another administrator; a site is told apart by its place in the list and its period. */
export type FlexNames = { person: (personId: string) => string; site: (establishmentId: string) => string; account: (account: string | undefined) => string };
export function flexNames(listing: Pick<FlexListing, "viewer" | "people" | "establishments">): FlexNames {
  return {
    person: (personId) => listing.people.find((item) => item.person_id === personId)?.name ?? "この部署の一覧にない職員",
    site: (establishmentId) => {
      const index = listing.establishments.findIndex((item) => item.establishment_id === establishmentId);
      const site = listing.establishments[index];
      return site ? `事業場${index + 1}（${dayOf(site.start)} 〜 ${lastDayOf(site.end)}）` : "この部署の一覧にない事業場";
    },
    account: (account) => (!account ? NONE : account === listing.viewer ? "あなた" : "別の管理者"),
  };
}

const brief = (text: string) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);
/** How an adoption is named where one is chosen: its site, its period, whom it covers and its status. */
export const adoptionLabel = (row: AdoptionRow, names: FlexNames) => `${names.site(row.payload.establishment_id)}：${dayOf(row.payload.start)} 〜 ${lastDayOf(row.payload.end)}・${brief(row.payload.target_scope)}（${STATUS_LABEL[row.payload.status] ?? row.payload.status}）`;
export const enrollmentLabel = (row: EnrollmentRow, names: FlexNames) => `${names.person(row.payload.person_id)}：${dayOf(row.payload.start)} から（${STATUS_LABEL[row.payload.status] ?? row.payload.status}）`;

/** The agreement's terms as the lines a person reads. */
export const termsFacts = (terms: AdoptionTerms, names: FlexNames): Fact[] => [
  { label: "事業場", text: terms.establishment_id ? names.site(terms.establishment_id) : NONE },
  { label: "対象労働者の範囲", text: terms.target_scope || NONE },
  { label: "清算期間", text: `${terms.settlement_months}か月` },
  { label: "起算日（採用の開始日）", text: terms.settlement_anchor || NONE },
  { label: "採用の最終日", text: lastDayOf(terms.end) || NONE },
  { label: "総労働時間の定め", text: `${RULE_LABEL[terms.total_hours_rule] ?? terms.total_hours_rule}${terms.rest_weekdays?.length ? `・毎週の休日：${terms.rest_weekdays.map((day) => WEEKDAYS[day] ?? String(day)).join("・")}` : ""}` },
  { label: "協定で定めた総労働時間", text: terms.agreed_total_description || NONE },
  { label: "標準となる1日の労働時間", text: terms.standard_day_seconds === null ? NONE : hm(terms.standard_day_seconds) },
  { label: "フレキシブルタイム", text: windowsText(terms.flexible_time) },
  { label: "コアタイム", text: windowsText(terms.core_time) },
  { label: "就業規則の規定の根拠", text: evidenceText(terms.work_rules_evidence) },
  { label: "労使協定の根拠", text: evidenceText(terms.agreement_evidence) },
  { label: "協定届", text: terms.filing ? `${terms.filing.filed_on || NONE} ${terms.filing.office || NONE}／${evidenceText(terms.filing.evidence)}` : "なし" },
  { label: "協定の有効期間の終了日", text: terms.agreement_valid_until || "なし" },
];

/** An adoption as it stands: its state and period, and who did what. */
export const adoptionFacts = (row: AdoptionRow, names: FlexNames): Fact[] => [
  { label: "採用", text: `${names.site(row.payload.establishment_id)}：${row.payload.target_scope}` },
  { label: "状態", text: STATUS_LABEL[row.payload.status] ?? row.payload.status },
  { label: "採用の期間", text: `${dayOf(row.payload.start)} 〜 ${lastDayOf(row.payload.end)}` },
  { label: "確認した管理者", text: names.account(row.payload.reviewed_by) },
  { label: "取下げ・終了の理由", text: row.payload.withdrawal_reason ?? row.payload.end_reason ?? NONE },
  { label: "取下げ・終了を記録した管理者", text: names.account(row.payload.decided_by) },
];

export const enrollmentFacts = (row: EnrollmentRow, names: FlexNames): Fact[] => [
  { label: "参加者", text: names.person(row.payload.person_id) },
  { label: "参加の開始日", text: dayOf(row.payload.start) },
  { label: "状態", text: STATUS_LABEL[row.payload.status] ?? row.payload.status },
  { label: "確認した管理者", text: names.account(row.payload.reviewed_by) },
  { label: "取下げの理由", text: row.payload.withdrawal_reason ?? NONE },
  { label: "取下げを記録した管理者", text: names.account(row.payload.decided_by) },
];

/** What the server said confirming would change, as the lines a person compares. */
export const impactFacts = (impact: FlexImpact, names: FlexNames): Fact[] => [
  { label: "参加者", text: impact.people.length ? impact.people.map((item) => `${names.person(item.person_id)}（${dayOf(item.start)} から）`).join("、") : "なし" },
  { label: "開始日以降の時刻付きの勤務", text: `${impact.timed_duties.length}件` },
  { label: "確認できない理由", text: impact.blocking.length ? impact.blocking.join(" ") : "なし" },
];
