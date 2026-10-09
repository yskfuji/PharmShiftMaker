// The leave ledger's records as the administrator's tasks choose and read them. Display
// and entry only: the server accounts the ledger and decides what a record may hold.
import { jstText } from "../../../shared/jst";
import { EMPTY_RECORD_EVIDENCE, evidenceFacts } from "../../../shared/records/evidence";
import type { Fact } from "../../../shared/records/facts";
import type { Option } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import { stagedRecords, type Versioned } from "../../../shared/records/staged";
import type { ComplianceRow, LedgerContext, LeaveAccountPayload, LeaveEventPayload, LeaveObligationPayload, LeavePolicyPayload, LedgerRecordingPayload, Piece } from "../../api";
import { UNIT_LABEL } from "../model";

export type { Versioned } from "../../../shared/records/staged";
export type Ledger = {
  person: (personId: unknown) => string;
  employer: (employerId: unknown) => string;
  people: Option[];
  /** The employers a person has a contract or an employment with, as registered. */
  employersOf: (personId: string) => Option[];
  accounts: Versioned<LeaveAccountPayload>[];
  policies: Versioned<LeavePolicyPayload>[];
  events: Versioned<LeaveEventPayload>[];
  obligations: Versioned<LeaveObligationPayload>[];
  recordings: Versioned<LedgerRecordingPayload>[];
  rows: ComplianceRow[];
};

export function ledgerOf(context: LedgerContext): Ledger {
  const rows = context.records;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const people = new Map(context.people.map((person) => [person.person_id, person.name]));
  for (const row of rows.filter((item) => item.kind === "person")) if (!people.has(row.entity_id)) people.set(row.entity_id, text(row.payload.name));
  const employers = new Map((context.employers ?? []).map((employer) => [employer.employer_id, employer.name]));
  for (const row of rows.filter((item) => item.kind === "employer")) if (!employers.has(row.entity_id)) employers.set(row.entity_id, text(row.payload.name));
  const employer = (employerId: unknown) => employers.get(text(employerId)) || "名称未登録の雇用主";
  return {
    person: (personId) => people.get(text(personId)) || "氏名未登録の職員",
    employer,
    people: Array.from(people, ([value, label]) => ({ value, label })),
    employersOf: (personId) => Array.from(new Set([...context.contracts, ...context.employments].filter((item) => item.person_id === personId).map((item) => text(item.employer_id)).filter(Boolean)))
      .map((value) => ({ value, label: employer(value) })),
    accounts: stagedRecords(context.leave_accounts, rows, "leave_account", (item) => item.account_id),
    policies: stagedRecords(context.leave_policies, rows, "leave_policy", (item) => item.policy_id),
    events: stagedRecords(context.leave_records, rows, "leave_record", (item) => item.event_id),
    obligations: stagedRecords(context.leave_obligations, rows, "leave_obligation", (item) => item.obligation_id),
    recordings: stagedRecords(context.ledger_recordings, rows, "ledger_recording", (item) => item.recording_id),
    rows,
  };
}

const NONE = "（なし）";
export const EVENT_KIND: Record<LeaveEventPayload["kind"], string> = { reserve: "予約", release: "予約を解除", take: "実際に取得した", reverse: "取得を取り消す", expire: "失効", conversion: "契約変更時の換算" };
export const OBLIGATION_METHOD: Record<LeaveObligationPayload["method"], string> = { separate: "基準日別に管理", consolidated: "根拠を確認して期間を統合", split_advance: "前倒し・分割付与の管理" };
const day = (value: unknown) => (typeof value === "string" && value ? value : NONE);
const spanText = (interval: Piece | null | undefined) => (interval?.start || interval?.end ? `${jstText(interval?.start) || "未入力"} 〜 ${jstText(interval?.end) || "未入力"}` : NONE);

export const accountLabel = (ledger: Ledger, item: LeaveAccountPayload) => `${ledger.person(item.person_id)} ${item.granted_on}付与 ${item.granted_days}日`;
export const policyLabel = (item: LeavePolicyPayload) => `${jstText(item.start).slice(0, 10)}〜${jstText(item.end).slice(0, 10)} 1日${item.hours_per_day}時間`;
export const eventLabel = (item: LeaveEventPayload) => `${item.effective_on} ${EVENT_KIND[item.kind] ?? "記録"} ${item.quantity}${UNIT_LABEL[item.unit] ?? ""}`;

export const accountFacts = (ledger: Ledger, item: LeaveAccountPayload): Fact[] => [
  { label: "対象職員", text: item.person_id ? ledger.person(item.person_id) : NONE },
  { label: "年休を管理する雇用主", text: item.employer_id ? ledger.employer(item.employer_id) : NONE },
  { label: "原本の付与日", text: day(item.granted_on) },
  { label: "失効日（この日を含まない）", text: day(item.expires_on) },
  { label: "原本の付与日数", text: `${item.granted_days}日` },
  { label: "うち法定付与日数", text: `${item.statutory_days}日` },
  { label: "外部人事の付与系列の参照", text: item.grant_cycle_id || NONE, verbatim: true },
  ...evidenceFacts("原本確認", item.evidence),
];
export const policyFacts = (ledger: Ledger, item: LeavePolicyPayload): Fact[] => [
  { label: "対象職員", text: item.person_id ? ledger.person(item.person_id) : NONE },
  { label: "年休を管理する雇用主", text: item.employer_id ? ledger.employer(item.employer_id) : NONE },
  { label: "適用開始（日本時間）", text: jstText(item.start) || NONE },
  { label: "適用終了（日本時間）", text: jstText(item.end) || NONE },
  { label: "時間単位年休を認める協定", text: item.hourly_enabled ? "ある" : "ない" },
  { label: "半日単位の取得", text: item.half_day_enabled ? "認める" : "認めない" },
  { label: "1日に相当する時間数", text: `${item.hours_per_day}時間` },
  { label: "時間年休の取得単位", text: `${item.hourly_quantum}時間` },
  { label: "年間の時間年休上限（日相当）", text: `${item.hourly_cap_days}日` },
  { label: "時間年休上限の年起算日", text: day(item.hourly_year_start) },
  ...evidenceFacts("原本確認", item.evidence),
];
export const eventFacts = (ledger: Ledger, item: LeaveEventPayload): Fact[] => {
  const account = ledger.accounts.find((entry) => entry.key === item.account_id)?.payload;
  const policy = ledger.policies.find((entry) => entry.key === item.policy_id)?.payload;
  const related = ledger.events.find((entry) => entry.key === item.related_event_id)?.payload;
  return [
    { label: "対象の付与原本", text: account ? accountLabel(ledger, account) : NONE },
    { label: "取得規則", text: policy ? policyLabel(policy) : NONE },
    { label: "年休イベント", text: EVENT_KIND[item.kind] ?? item.kind },
    { label: "取得単位", text: UNIT_LABEL[item.unit] ?? item.unit },
    { label: "数量", text: String(item.quantity) },
    { label: "イベントの効力日", text: day(item.effective_on) },
    { label: "解除・取消の元イベント", text: related ? eventLabel(related) : NONE },
    { label: "対象区間（日本時間）", text: spanText(item.interval) },
    { label: "換算前の1日相当時間", text: item.conversion_old_hours === null ? NONE : `${item.conversion_old_hours}時間` },
    { label: "換算後の1日相当時間", text: item.conversion_new_hours === null ? NONE : `${item.conversion_new_hours}時間` },
    ...evidenceFacts("原本確認", item.evidence),
  ];
};
export const obligationFacts = (ledger: Ledger, item: LeaveObligationPayload): Fact[] => [
  { label: "対象職員", text: item.person_id ? ledger.person(item.person_id) : NONE },
  { label: "年休を管理する雇用主", text: item.employer_id ? ledger.employer(item.employer_id) : NONE },
  { label: "管理期間の開始日", text: day(item.start) },
  { label: "管理期間の終了日（この日を含まない）", text: day(item.end) },
  { label: "必要な取得量（半日を1として記録）", text: String(item.required_half_days) },
  { label: "基準日が重なる場合の管理方法", text: OBLIGATION_METHOD[item.method] ?? item.method },
  { label: "取得管理の単位", text: item.rounding_unit === "half_day" ? "本人請求を確認した半日単位" : "日単位" },
  { label: "対象判定に用いた付与原本", text: item.qualifying_grant_ids.length ? item.qualifying_grant_ids.map((grant) => { const account = ledger.accounts.find((entry) => entry.key === grant)?.payload; return account ? `${account.granted_on}付与` : "未登録の付与"; }).join("、") : NONE },
  ...evidenceFacts("原本確認", item.evidence),
  ...(item.half_day_request_evidence ? evidenceFacts("半日取得の本人請求確認", item.half_day_request_evidence) : []),
];
export const recordingFacts = (ledger: Ledger, item: LedgerRecordingPayload): Fact[] => {
  const account = item.object_kind === "leave_account" ? ledger.accounts.find((entry) => entry.key === item.object_id)?.payload : undefined;
  const event = item.object_kind === "leave_record" ? ledger.events.find((entry) => entry.key === item.object_id)?.payload : undefined;
  return [
    { label: "記録日時を照合する原本の種類", text: item.object_kind === "leave_account" ? "付与原本" : "予約・取得等の原本" },
    { label: "記録日時を付す原本", text: account ? accountLabel(ledger, account) : event ? eventLabel(event) : NONE },
    { label: "外部人事の原本イベント番号", text: item.external_event_id || NONE, verbatim: true },
    { label: "外部人事の原本改定番号", text: String(item.external_revision) },
    { label: "原本を把握した日時（日本時間）", text: jstText(item.recorded_at) || NONE },
    ...evidenceFacts("原本確認", item.evidence),
  ];
};

const evidence = () => ({ ...EMPTY_RECORD_EVIDENCE });
export const newAccount = (id: string): LeaveAccountPayload => ({ account_id: id, person_id: "", employer_id: "", granted_on: "", expires_on: "", statutory_days: 0, granted_days: 0, evidence: evidence(), grant_cycle_id: null });
export const newPolicy = (id: string): LeavePolicyPayload => ({ policy_id: id, person_id: "", employer_id: "", start: "", end: "", hourly_enabled: false, half_day_enabled: false, hours_per_day: 8, hourly_quantum: 1, hourly_year_start: "", hourly_cap_days: 5, evidence: evidence() });
export const newEvent = (id: string): LeaveEventPayload => ({ event_id: id, account_id: "", kind: "reserve", unit: "day", quantity: 1, effective_on: "", policy_id: "", interval: { start: "", end: "" }, related_event_id: null, evidence: evidence(), conversion_old_hours: null, conversion_new_hours: null });
export const newObligation = (id: string): LeaveObligationPayload => ({ obligation_id: id, person_id: "", employer_id: "", start: "", end: "", required_half_days: 10, qualifying_grant_ids: [], evidence: evidence(), method: "separate", rounding_unit: "day", half_day_request_evidence: null });
export const newRecording = (id: string): LedgerRecordingPayload => ({ recording_id: id, object_kind: "leave_account", object_id: "", external_event_id: "", external_revision: 1, recorded_at: "", evidence: evidence() });

export const LEDGER_NOTICE = RECORD_SAVE_NOTICE;
export const ledgerRisk = recordRisk;

/** The external HR source of a grant or an event as the ledger records it: its event
 * number and its latest revision (the recording, then each correction in order). A
 * correction names the revision it follows; the server checks that the chain is unbroken. */
export function sourceChain(rows: ComplianceRow[], kind: "leave_account" | "leave_record", identity: string) {
  const recording = rows.find((row) => row.kind === "ledger_recording" && row.payload.object_kind === kind && row.payload.object_id === identity)?.payload;
  const corrections = rows.filter((row) => row.kind === (kind === "leave_account" ? "grant_amendment" : "leave_amendment") && row.payload[kind === "leave_account" ? "account_id" : "event_id"] === identity)
    .sort((a, b) => Number(a.payload.external_revision) - Number(b.payload.external_revision));
  const latest = corrections.at(-1)?.payload;
  return { externalEventId: latest?.external_event_id ?? recording?.external_event_id, revision: Number(latest?.external_revision ?? recording?.external_revision ?? 0), latest };
}
