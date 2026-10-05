// Leave requests and the leave ledger as the route shows them. Display and entry only:
// balances, the five-day obligation, findings and what a claim may ask for are the server's.
import { jstText } from "../../shared/jst";
import type { Fact } from "../../shared/records/facts";
import type { ComplianceRow, LeaveBalance, LeaveReport, LeaveRequestRow, LeaveUnit } from "../api";

export const UNIT_LABEL: Record<LeaveUnit, string> = { day: "日", half_day: "半日", hour: "時間" };
const STATUS_LABEL: Record<string, string> = { PENDING: "確認待ち", APPROVED: "確認済み", REQUIRES_DISCUSSION: "相談・判断を継続中", CANCELLED: "取下げ済み" };
export const requestStatus = (status: string) => STATUS_LABEL[status] ?? "未対応の状態（確認が必要）";
export const isPaidLeave = (kind: string) => kind === "PAID_LEAVE_V2" || kind === "PAID_LEAVE_REQUEST";
export const requestKind = (kind: string) => (isPaidLeave(kind) ? "年次有給休暇" : "公休希望");
const FINDING_LABEL: Record<string, string> = { violation: "不整合", unverified: "未確認", unsupported: "照合の対象外" };
export const findingStatus = (status: string) => FINDING_LABEL[status] ?? "確認が必要";

export const periodText = (start: unknown, end: unknown) => `${jstText(start) || "未入力"} 〜 ${jstText(end) || "未入力"}`;
export const amountText = (row: Pick<LeaveRequestRow, "payload">) =>
  (row.payload.unit ? `${row.payload.quantity ?? ""}${row.payload.unit === "hour" ? "時間" : row.payload.unit === "half_day" ? "回（半日）" : "日"}` : "—");
export const daysText = (value: { numerator: number; denominator: number }) => (value.denominator === 1 ? `${value.numerator}` : `${value.numerator}/${value.denominator}`);
export const grantText = (item: Pick<LeaveBalance, "person_name" | "employer_name" | "granted_on">) =>
  `${item.person_name || "職員名未確認"}／${item.employer_name || "雇用主名未登録"}／付与日 ${item.granted_on || "未確認"}`;

/** A request as the lines a person reads (the confirmation and the three-way review). */
export const requestFacts = (row: LeaveRequestRow, person: (personId: string) => string): Fact[] => [
  { label: "本人", text: person(row.person_id) },
  { label: "種類", text: requestKind(row.kind) },
  { label: "期間（日本時間）", text: periodText(row.payload.start, row.payload.end) },
  { label: "単位・数量", text: amountText(row) },
  { label: "状態", text: requestStatus(row.status) },
  { label: "判断の記録", text: row.decision?.reference || "（なし）" },
];
export const requestLabel = (row: LeaveRequestRow, person: (personId: string) => string) =>
  `${person(row.person_id)}・${requestKind(row.kind)} ${periodText(row.payload.start, row.payload.end)}（${requestStatus(row.status)}）`;

/** What the route keeps of the ledger report: only what its first view shows. */
export type LedgerState = Pick<LeaveReport, "balances" | "obligations" | "findings"> & { requiresReconciliation: boolean };
export const ledgerState = (report: LeaveReport): LedgerState => ({
  balances: report.balances, obligations: report.obligations, findings: report.findings ?? [], requiresReconciliation: Boolean(report.requires_hr_reconciliation),
});

export type OwnGrant = { account_id: string; granted_on: string; expires_on: string; granted_days: number };
export type OwnPolicy = { policy_id: string; start: string; end: string; hours_per_day: number; hourly_quantum: number; hourly_enabled: boolean; half_day_enabled: boolean };
/** The viewer's own grants and leave rules, as registered. Other people's records, which a
 * planner's answer holds, are not kept. */
export type OwnSources = { grants: OwnGrant[]; policies: OwnPolicy[] };
export function ownSources(rows: ComplianceRow[], personId: string): OwnSources {
  const mine = (kind: string) => rows.filter((row) => row.kind === kind && row.payload.person_id === personId);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    grants: mine("leave_account").map((row) => ({ account_id: row.entity_id, granted_on: text(row.payload.granted_on), expires_on: text(row.payload.expires_on), granted_days: Number(row.payload.granted_days ?? 0) })),
    policies: mine("leave_policy").map((row) => ({
      policy_id: row.entity_id, start: text(row.payload.start), end: text(row.payload.end), hours_per_day: Number(row.payload.hours_per_day ?? 0), hourly_quantum: Number(row.payload.hourly_quantum ?? 1),
      hourly_enabled: row.payload.hourly_enabled === true, half_day_enabled: row.payload.half_day_enabled === true,
    })),
  };
}
/** The units a registered leave rule allows a claim to ask for: a day always, a half day
 * and hours only when the rule says so. Read from the rule; nothing is decided here. */
export const unitsOf = (policy: OwnPolicy | undefined): LeaveUnit[] =>
  ["day", ...(policy?.half_day_enabled ? ["half_day" as const] : []), ...(policy?.hourly_enabled ? ["hour" as const] : [])];

export const NOBODY_NOTIFIED = "誰にも通知されません。";
