// The request bodies the established leave screens sent for the entries the tests make.
// They were recorded from those screens when this route replaced them, and are what the
// rebuilt tasks must send for the same entries (the idempotency key apart).
export const UUID = "11111111-2222-4333-8444-555555555555";
const verified = (reference: string) => ({ reference, status: "verified", verified_by: "確認者" });

export const WISH = { start: "2026-01-06T09:00:00+09:00", end: "2026-01-06T17:00:00+09:00", kind: "PUBLIC_HOLIDAY_REQUEST", rank: 1, grant_id: null, amount: 1 };
export const DAY_CLAIM = { payload: { account_id: "g1", policy_id: "lp1", unit: "day", quantity: 1, interval: { start: "2026-01-06T09:00:00+09:00", end: "2026-01-06T17:00:00+09:00" }, reference: "合成本人請求" }, expected_revision: 0 };
export const HOUR_CLAIM = { payload: { account_id: "g1", policy_id: "lp1", unit: "hour", quantity: 2, interval: { start: "2026-01-06T13:00:00+09:00", end: "2026-01-06T15:00:00+09:00" }, reference: "合成本人請求" }, expected_revision: 0 };
export const APPROVAL = { version: 1, approved: true, reference: "台帳と勤務影響を確認" };
export const CONTINUE = { version: 1, approved: false, reference: "台帳と勤務影響を確認" };
export const WITHDRAWAL = { version: 1 };

const common = { person_id: "p1", external_revision: 2, supersedes_revision: 1, recorded_at: "2026-01-07T12:00:00+09:00", reason: "原本の訂正", evidence: verified("HR-REF"), amendment_id: UUID };
export const GRANT_CORRECTION = { expected_revision: 0, payload: { ...common, external_event_id: "hr:g1", account_id: "g1", effective_on: "2026-01-01", granted_days: 4, statutory_days: 4 } };
export const EVENT = { event_id: "e1", account_id: "g1", kind: "take", unit: "day", quantity: 1, effective_on: "2026-01-06", policy_id: "lp1", interval: { start: "2026-01-06T09:00:00+09:00", end: "2026-01-06T17:00:00+09:00" }, related_event_id: null, evidence: { reference: "勤怠原本", status: "verified", verified_by: "確認者", valid_until: null }, conversion_old_hours: null, conversion_new_hours: null };
export const EVENT_CORRECTION = { expected_revision: 0, payload: { ...common, external_event_id: "hr:e1", event_id: "e1", replacement: { ...EVENT, unit: "half_day", quantity: 1, effective_on: "2026-01-07", interval: { start: "2026-01-07T09:00:00+09:00", end: "2026-01-07T13:00:00+09:00" }, evidence: verified("HR-REF") } } };
export const EVENT_CANCEL = { expected_revision: 0, payload: { ...common, external_event_id: "hr:e1", event_id: "e1", replacement: null } };

export const ASSESSMENT = { payload: { account_id: "g1", person_id: "p1", employer_id: "hospital", basis_date: "2026-01-01", completed_service_months: 6, scheduled_week_seconds: 108000, schedule_basis: "weekly", scheduled_week_days: 4, scheduled_year_days: null, attendance_days: 100, attendance_denominator: 120, evidence: { reference: "HR-A", verified_by: "確認者", status: "verified" }, assessment_id: UUID }, input_hash: "a".repeat(64), expected_revision: 7 };
export const SHIFT_ASSESSMENT = { ...ASSESSMENT, payload: { ...ASSESSMENT.payload, schedule_basis: "shift_actual", scheduled_week_days: null, actual_work_days: 90, actual_period: "first_six_months", guideline_year_days: null, guidance_confirmation: { reference: "HR-G", verified_by: "確認者", status: "verified" } } };

const evidence = { reference: "人事原本", status: "verified", verified_by: "確認者", valid_until: null };
export const NEW_EVENT = { expected_revision: 3, payload: { event_id: UUID, account_id: "g1", kind: "take", unit: "day", quantity: 1, effective_on: "2026-01-06", policy_id: "lp1", interval: { start: "2026-01-06T00:00:00.000Z", end: "2026-01-06T08:00:00.000Z" }, related_event_id: null, evidence, conversion_old_hours: null, conversion_new_hours: null } };
export const NEW_ACCOUNT = { expected_revision: 0, payload: { account_id: UUID, person_id: "p1", employer_id: "hospital", granted_on: "2026-04-01", expires_on: "2028-04-01", statutory_days: 10, granted_days: 11, evidence, grant_cycle_id: null } };
export const NEW_POLICY = { expected_revision: 0, payload: { policy_id: UUID, person_id: "p1", employer_id: "hospital", start: "2026-03-31T15:00:00.000Z", end: "2028-03-31T15:00:00.000Z", hourly_enabled: true, half_day_enabled: false, hours_per_day: 8, hourly_quantum: 1, hourly_year_start: "2026-04-01", hourly_cap_days: 5, evidence } };
export const NEW_OBLIGATION = { expected_revision: 0, payload: { obligation_id: UUID, person_id: "p1", employer_id: "hospital", start: "2026-04-01", end: "2027-04-01", required_half_days: 10, qualifying_grant_ids: ["g1"], evidence, method: "separate", rounding_unit: "day", half_day_request_evidence: null } };
export const NEW_RECORDING = { expected_revision: 0, payload: { recording_id: UUID, object_kind: "leave_account", object_id: "g1", external_event_id: "hr:g1:b", external_revision: 1, recorded_at: "2026-01-02T00:00:00.000Z", evidence } };

// The records the ledger tasks read in those tests.
export const ACCOUNT = { account_id: "g1", person_id: "p1", employer_id: "hospital", granted_on: "2026-01-01", expires_on: "2028-01-01", statutory_days: 5, granted_days: 5, evidence, grant_cycle_id: null };
export const POLICY = { policy_id: "lp1", person_id: "p1", employer_id: "hospital", start: "2026-01-01T00:00:00+09:00", end: "2028-01-01T00:00:00+09:00", hourly_enabled: true, half_day_enabled: false, hours_per_day: 4, hourly_quantum: 1, hourly_year_start: "2026-01-01", hourly_cap_days: 5, evidence };
const recording = (kind: string, id: string) => ({ recording_id: `hr-${id}`, object_kind: kind, object_id: id, external_event_id: `hr:${id}`, external_revision: 1, recorded_at: "2026-01-01T00:00:00+09:00", evidence });
export const RECORDS = [
  { kind: "leave_account", key: "k-g1", entity_id: "g1", revision: 3, payload: ACCOUNT },
  { kind: "leave_policy", key: "k-lp1", entity_id: "lp1", revision: 1, payload: POLICY },
  { kind: "leave_record", key: "k-e1", entity_id: "e1", revision: 1, payload: EVENT },
  { kind: "ledger_recording", key: "k-r1", entity_id: "hr-g1", revision: 1, payload: recording("leave_account", "g1") },
  { kind: "ledger_recording", key: "k-r2", entity_id: "hr-e1", revision: 1, payload: recording("leave_record", "e1") },
];
export const LEDGER_CONTEXT = {
  role: "ADMIN", input_hash: "a".repeat(64), staging_valid: true, validation_issues: [], rule_revision: "r", people: [{ person_id: "p1", name: "合成 一" }], employers: [{ employer_id: "hospital", name: "合成病院" }],
  contracts: [{ person_id: "p1", employer_id: "hospital" }], employments: [], establishments: [], capabilities: [], duty_options: [],
  leave_accounts: [ACCOUNT], leave_policies: [POLICY], leave_records: [EVENT], leave_obligations: [], ledger_recordings: RECORDS.filter((row) => row.kind === "ledger_recording").map((row) => row.payload), records: RECORDS,
};
export const ASSESSMENT_CONTEXT = { input_hash: "a".repeat(64), source_revision: 7, as_of: "2026-01-05", accounts: [ACCOUNT], findings: [] };
