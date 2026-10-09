import type { IdealRole, LifecycleCase, WorkspaceNotification } from "@/ideal/types";

/**
 * One synthetic answer: path (exact, or a pattern) and the JSON the API would return to a
 * planner. `own` names the lists of that answer the API gives a pharmacist only for their
 * own person (the answer's `visibility` is then "self"); see transport.ts. `byRole` gives
 * the answer of an endpoint whose content depends on the viewer in another way; `body` is
 * then what an administrator is given. `byQuery` narrows an answer by what the request
 * asked for, as the API does (the links without `include_inactive=true` are the active ones).
 */
export type FetchRoute = { method?: string; path: string | RegExp; status?: number; body: unknown; own?: string[]; byRole?: (role: IdealRole, personId: string) => unknown; byQuery?: (body: unknown, query: URLSearchParams) => unknown };

const period = { start: "2026-10-01T00:00:00+09:00", end: "2026-11-01T00:00:00+09:00" };
const people = [
  { person_id: "synthetic-admin", name: "佐藤 美咲" },
  { person_id: "synthetic-leader", name: "鈴木 悠斗" },
  { person_id: "synthetic-pharmacist", name: "高橋 葵" },
];
export const syntheticAssignments = [
  { duty_id: "synthetic-duty-1", person_id: "synthetic-pharmacist", kind: "日勤", task: "病棟", location: "本館", start: "2026-10-12T08:30:00+09:00", end: "2026-10-12T17:30:00+09:00" },
  { duty_id: "synthetic-duty-2", person_id: "synthetic-leader", kind: "遅番", task: "調剤", location: "薬剤部", start: "2026-10-12T10:30:00+09:00", end: "2026-10-12T19:30:00+09:00" },
];
const assignments = syntheticAssignments;
// The names of the scope's roster: the people of the planning input, and one who has joined
// and has no record in it yet (a name long enough to show what a narrow column does to it).
export const syntheticPeople = [...people, { person_id: "synthetic-newcomer", name: "ヴァンデンバーグ 絵里香クリスティーナ" }];
// One notification, as the API returns it: the kind is the recorded event's own, the
// category its first part, and the time the moment publication 12 was made (see
// `publicationSummary`). It has not been confirmed yet.
export const syntheticNotifications: WorkspaceNotification[] = [
  { event_id: "notice-1", category: "schedule", kind: "schedule.published", publication_id: "synthetic-publication-12", version: 12, read: false, created_at: "2026-10-08T07:42:00+09:00" },
];
// Two cases, with the tasks and the states the server derives for each kind. A task the
// server completes from a record (SYSTEM) carries no completion time, and while its record
// is missing it says why it waits; only the attested task (ATTESTATION) can be completed here.
const WAITS_FOR_RECORD = "対応する正本の登録・確定が必要です。";
const systemTask = (key: string, complete: boolean): LifecycleCase["tasks"][number] => ({ key, source: "SYSTEM", status: complete ? "COMPLETED" : "NOT_STARTED", can_complete: false, completed_at: null, blocked_reason: complete ? null : WAITS_FOR_RECORD });
const lifecycleCases: LifecycleCase[] = [{
  // Joining: the contract, the account link and the duty candidates are on record; the qualification is not.
  case_id: "lifecycle-1", scope_id: "synthetic/clinical-pharmacy", person_id: "synthetic-pharmacist", kind: "ONBOARD", effective_date: "2026-10-01", status: "IN_PROGRESS", version: 2,
  evidence: {}, created_by: "synthetic-admin", created_at: "2026-10-01T08:30:00+09:00", updated_at: "2026-10-01T09:00:00+09:00",
  tasks: [systemTask("contract", true), systemTask("qualification", false), systemTask("membership", true), systemTask("candidate_generation", true)],
}, {
  // Leaving: the account link is already inactive; the balance review is still to be attested.
  case_id: "lifecycle-2", scope_id: "synthetic/clinical-pharmacy", person_id: "synthetic-leader", kind: "OFFBOARD", effective_date: "2026-10-31", status: "IN_PROGRESS", version: 1,
  evidence: {}, created_by: "synthetic-admin", created_at: "2026-10-05T10:00:00+09:00", updated_at: "2026-10-05T10:00:00+09:00",
  tasks: [
    systemTask("contract_end", false), systemTask("candidate_exclusion", false),
    { key: "balance_review", source: "ATTESTATION", status: "NOT_STARTED", can_complete: true, completed_at: null, blocked_reason: null },
    systemTask("membership_deactivation", true),
  ],
}];
// The account links: two active ones of the people at work, the active one of the person
// who has joined (a long name and a long account), and the leader's, deactivated.
const membership = (person: string, role: IdealRole, over: { subject?: string; active?: boolean; revision?: number } = {}) =>
  ({ membership_id: `${person}-membership`, issuer: "mock", subject: person, person_id: person, scope_id: "synthetic/clinical-pharmacy", role, active: true, revision: 1, ...over });
const memberships = [
  membership("synthetic-admin", "ADMIN"),
  membership("synthetic-pharmacist", "PHARMACIST"),
  membership("synthetic-newcomer", "PHARMACIST", { subject: "synthetic-newcomer-erika-christina-vandenberg@example.invalid" }),
  membership("synthetic-leader", "LEADER", { active: false, revision: 2 }),
];
const publication = { publication_id: "synthetic-publication-12", version: 12, period: `${period.start}|${period.end}`, input_hash: "synthetic-input-12", assignments, validation_status: "verified_at_publication" };
const INPUT_HASH = "synthetic-input-12";
// Two demands of the synthetic input: one saved twice as a record, one still only the input's value.
const demands = [
  { demand_id: "synthetic-demand-1", task: "病棟", location: "本館", minimum: 1, target: 2, start: "2026-10-12T08:30:00+09:00", end: "2026-10-12T17:30:00+09:00", evidence: { reference: "合成配置表 2026-10", status: "verified", verified_by: "合成の確認責任者", valid_until: null } },
  { demand_id: "synthetic-demand-2", task: "調剤", location: "薬剤部", minimum: 2, target: 2, start: "2026-10-12T10:30:00+09:00", end: "2026-10-12T19:30:00+09:00", evidence: { reference: "合成配置表 2026-10", status: "unverified", verified_by: null, valid_until: null } },
];
// Two actuals: the pharmacist's was corrected once and has a reconciliation note for its
// current revision; the leader's is the first revision and has none.
const actualOf = (index: number, external_id: string, revision: number, reviewed: boolean, end: string) => {
  const duty = assignments[index];
  const work = [{ start: duty.start, end }];
  return { external_id, revision, event_id: `synthetic-actual-event-${index + 1}`, reviewed, duty: { ...duty, relationship_id: `synthetic-relationship-${index + 1}`, end, work, breaks: [], source: "actual" } };
};
const actuals = [actualOf(0, "synthetic-clock-1", 2, true, "2026-10-12T17:45:00+09:00"), actualOf(1, "synthetic-clock-2", 1, false, "2026-10-12T19:30:00+09:00")];
const workflow = { input_hash: INPUT_HASH, role: "ADMIN", staging_valid: true, validation_issues: [], demands, people, contracts: [], employments: [], establishments: [], capabilities: [], duty_options: [{ kind: "日勤", task: "病棟", location: "本館" }, { kind: "遅番", task: "調剤", location: "薬剤部" }], records: [{ kind: "demand", key: "synthetic-demand-key-1", entity_id: "synthetic-demand-1", revision: 2, payload: demands[0] }], publications: [publication], actuals, can_correct_actuals: true };

const scopeId = "synthetic/clinical-pharmacy";
const cover = { ...assignments[0], duty_id: "synthetic-duty-3", person_id: "synthetic-admin" };
const exchanged = [{ ...assignments[0], duty_id: "synthetic-duty-4", person_id: "synthetic-leader" }, { ...assignments[1], duty_id: "synthetic-duty-5", person_id: "synthetic-pharmacist" }];
const caseBase = { scope_id: scopeId, publication_id: publication.publication_id, evidence: {}, created_by: "synthetic-pharmacist", created_at: "2026-10-11T16:20:00+09:00" };
// One exchange still waiting for the leader's consent, and one absence ready for a planner.
const changeCases = [
  { ...caseBase, case_id: "synthetic-case-swap", kind: "SWAP", status: "AWAITING_CONSENT", version: 2, updated_at: "2026-10-11T18:05:00+09:00", affected_assignments: assignments, proposed_assignments: exchanged,
    validation: { findings: [], publishable: true, required_consent_person_ids: ["synthetic-pharmacist", "synthetic-leader"], consented_person_ids: ["synthetic-pharmacist"], replacement_duty_ids: exchanged.map((item) => item.duty_id) }, approval_action: null, can_reject: true },
  { ...caseBase, case_id: "synthetic-case-absence", kind: "ABSENCE", status: "READY", version: 3, updated_at: "2026-10-12T07:55:00+09:00", affected_assignments: [assignments[0]], proposed_assignments: [cover],
    validation: { findings: [], publishable: true, required_consent_person_ids: [], consented_person_ids: [], replacement_duty_ids: [cover.duty_id] }, approval_action: "RECOMMEND", can_reject: true },
];
const changeOptions = { publication_id: publication.publication_id, publication_version: 12, duty_id: "synthetic-duty-1", kind: "ABSENCE", consent_required: false, options: [
  { option_id: "synthetic-option-1", affected_assignment_ids: ["synthetic-duty-1"], proposed_assignment_ids: ["synthetic-duty-3"], counterpart: { person_id: "synthetic-admin", display_name: "佐藤 美咲" }, duty: { start: cover.start, end: cover.end, kind: cover.kind, task: cover.task, location: cover.location }, publishable: true, finding_count: 0 },
] };
const publicationSummary = { publication_id: publication.publication_id, version: 12, period: publication.period, input_hash: publication.input_hash, created_at: "2026-10-08T07:42:00+09:00" };
// The fourteen days up to the synthetic day, oldest first as the API lists them. The change
// events are those of the two cases above (one per version of a case): four on the day they
// were made and the exchange was consented to, one on the day the absence became ready.
const stabilityDays = Array.from({ length: 14 }, (_, index) => ({ day: new Date(Date.UTC(2026, 9, index - 1)).toISOString().slice(0, 10), change_count: index === 12 ? 4 : index === 13 ? 1 : 0 }));

// Outside work: one declaration awaiting comparison, one compared (closed to its person by
// the server) and one withdrawn. An administrator is given everyone's and may change all.
const outsideEvidence = { reference: "合成の就業証明 2026-10", status: "verified", verified_by: "synthetic-admin", valid_until: null };
const declarationBase = { employer_id: "synthetic-employer-2", establishment_id: "synthetic-site-2", contract_order: 2, activity: "employment", start: "2026-10-01T00:00:00+09:00", end: "2027-04-01T00:00:00+09:00", work_report_complete: true, additional_work: [] };
const declarationRows = [
  { entity_id: "synthetic-declaration-1", revision: 1, payload: { ...declarationBase, declaration_id: "synthetic-declaration-1", person_id: "synthetic-pharmacist", reference: "合成の雇用契約書 A", status: "SUBMITTED", review_evidence: null, scheduled_work: [{ start: "2026-10-17T09:00:00+09:00", end: "2026-10-17T13:00:00+09:00" }, { start: "2026-10-24T09:00:00+09:00", end: "2026-10-24T13:00:00+09:00" }] } },
  { entity_id: "synthetic-declaration-2", revision: 2, payload: { ...declarationBase, declaration_id: "synthetic-declaration-2", person_id: "synthetic-leader", reference: "合成の雇用契約書 B", status: "REVIEWED", review_evidence: outsideEvidence, scheduled_work: [{ start: "2026-10-18T10:00:00+09:00", end: "2026-10-18T15:00:00+09:00" }] } },
  { entity_id: "synthetic-declaration-3", revision: 2, payload: { ...declarationBase, declaration_id: "synthetic-declaration-3", person_id: "synthetic-pharmacist", reference: "合成の雇用契約書 C", start: "2026-04-01T00:00:00+09:00", end: "2026-10-01T00:00:00+09:00", status: "WITHDRAWN", review_evidence: null, scheduled_work: [] } },
];
const declarationContext = (role: IdealRole, personId: string) => ({
  person_id: personId,
  employers: [{ employer_id: "synthetic-employer-2", name: "合成薬局 みなと店（架空）" }],
  establishments: [{ establishment_id: "synthetic-site-2", employer_id: "synthetic-employer-2", name: "みなと店" }],
  declarations: declarationRows.filter((row) => role === "ADMIN" || row.payload.person_id === personId).map((row) => {
    const refusal = role !== "ADMIN" && row.payload.status === "REVIEWED" ? "照合済みの申告は本人では変更・取り下げできません。終了日などの訂正は管理者に依頼してください。" : null;
    return { ...row, actions: { change: { allowed: refusal === null, refusal } } };
  }),
});

// Leave: each person has one grant and one leave rule (the pharmacist's rule allows hourly
// leave, the leader's half days). A day's paid leave awaits confirmation, a wish is
// confirmed, an hourly claim is still being discussed and one wish was withdrawn.
const leaveEvidence = { reference: "合成の人事原本 2026-04", status: "verified", verified_by: "合成の確認責任者", valid_until: null };
const leaveOwners = ["synthetic-pharmacist", "synthetic-leader"];
const leaveAccounts = leaveOwners.map((person_id, index) => ({ account_id: `synthetic-grant-${index + 1}`, person_id, employer_id: "synthetic-employer-1", granted_on: "2026-04-01", expires_on: "2028-04-01", statutory_days: 10, granted_days: 10, evidence: leaveEvidence, grant_cycle_id: null }));
const leavePolicies = leaveOwners.map((person_id, index) => ({ policy_id: `synthetic-policy-${index + 1}`, person_id, employer_id: "synthetic-employer-1", start: "2026-04-01T00:00:00+09:00", end: "2028-04-01T00:00:00+09:00", hourly_enabled: index === 0, half_day_enabled: index === 1, hours_per_day: 8, hourly_quantum: 1, hourly_year_start: "2026-04-01", hourly_cap_days: 5, evidence: leaveEvidence }));
const leaveEvents = [{ event_id: "synthetic-leave-event-1", account_id: "synthetic-grant-1", kind: "take", unit: "day", quantity: 1, effective_on: "2026-09-18", policy_id: "synthetic-policy-1", interval: { start: "2026-09-18T08:30:00+09:00", end: "2026-09-18T17:30:00+09:00" }, related_event_id: null, evidence: leaveEvidence, conversion_old_hours: null, conversion_new_hours: null }];
const ledgerRecordings = leaveAccounts.map((account, index) => ({ recording_id: `synthetic-recording-${index + 1}`, object_kind: "leave_account", object_id: account.account_id, external_event_id: `HR-2026-${index + 1}`, external_revision: 1, recorded_at: "2026-04-01T09:00:00+09:00", evidence: leaveEvidence }));
const leaveRecords = [
  ...leaveAccounts.map((payload) => ({ kind: "leave_account", key: `synthetic-key-${payload.account_id}`, entity_id: payload.account_id, revision: 1, payload })),
  ...leavePolicies.map((payload) => ({ kind: "leave_policy", key: `synthetic-key-${payload.policy_id}`, entity_id: payload.policy_id, revision: 1, payload })),
  ...leaveEvents.map((payload) => ({ kind: "leave_record", key: `synthetic-key-${payload.event_id}`, entity_id: payload.event_id, revision: 1, payload })),
  ...ledgerRecordings.map((payload) => ({ kind: "ledger_recording", key: `synthetic-key-${payload.recording_id}`, entity_id: payload.recording_id, revision: 1, payload })),
];
const whole = (numerator: number) => ({ numerator, denominator: 1 });
const leaveRequests = [
  { request_id: "synthetic-request-1", person_id: "synthetic-pharmacist", version: 1, kind: "PAID_LEAVE_V2", status: "PENDING", decision: null, payload: { account_id: "synthetic-grant-1", policy_id: "synthetic-policy-1", unit: "day", quantity: 1, interval: { start: "2026-10-20T08:30:00+09:00", end: "2026-10-20T17:30:00+09:00" }, reference: "合成の本人請求 1", start: "2026-10-20T08:30:00+09:00", end: "2026-10-20T17:30:00+09:00" } },
  { request_id: "synthetic-request-2", person_id: "synthetic-pharmacist", version: 2, kind: "PUBLIC_HOLIDAY_REQUEST", status: "APPROVED", decision: { reference: "合成の調整記録 10-05", status: "verified", verified_by: "synthetic-leader" }, payload: { start: "2026-10-24T08:30:00+09:00", end: "2026-10-24T17:30:00+09:00", kind: "PUBLIC_HOLIDAY_REQUEST", rank: 1, grant_id: null, amount: 1 } },
  { request_id: "synthetic-request-3", person_id: "synthetic-leader", version: 2, kind: "PAID_LEAVE_V2", status: "REQUIRES_DISCUSSION", decision: { reference: "合成の相談記録 10-08", status: "verified", verified_by: "synthetic-admin" }, payload: { account_id: "synthetic-grant-2", policy_id: "synthetic-policy-2", unit: "half_day", quantity: 1, interval: { start: "2026-10-22T13:30:00+09:00", end: "2026-10-22T17:30:00+09:00" }, reference: "合成の本人請求 2", start: "2026-10-22T13:30:00+09:00", end: "2026-10-22T17:30:00+09:00" } },
  { request_id: "synthetic-request-4", person_id: "synthetic-pharmacist", version: 2, kind: "PUBLIC_HOLIDAY_REQUEST", status: "CANCELLED", decision: null, payload: { start: "2026-10-03T08:30:00+09:00", end: "2026-10-03T17:30:00+09:00", kind: "PUBLIC_HOLIDAY_REQUEST", rank: 1, grant_id: null, amount: 1 } },
];
const planner = (role: IdealRole) => role !== "PHARMACIST";
const leaveReport = (role: IdealRole, personId: string) => ({
  balances: leaveAccounts.filter((account) => planner(role) || account.person_id === personId).map((account, index) => ({ account_id: account.account_id, person_id: account.person_id, remaining_days: whole(9 - index), reserved_days: whole(0), unreserved_days: whole(9 - index), available_days: whole(9 - index), availability_status: "active", expired: false, person_name: people.find((person) => person.person_id === account.person_id)?.name ?? null, employer_name: "東都医療センター（架空）", granted_on: account.granted_on })),
  obligations: leaveAccounts.filter((account) => planner(role) || account.person_id === personId).map((account, index) => ({ obligation_id: `synthetic-obligation-${account.account_id}`, person_id: account.person_id, required_half_days: 10, taken_half_days: 2 - index * 2, status: "at_risk", remaining_half_days: 8 + index * 2, end: "2027-04-01", start: "2026-04-01", person_name: people.find((person) => person.person_id === account.person_id)?.name ?? null, employer_name: "東都医療センター（架空）" })),
  // Findings are a planner's: the API gives a pharmacist none.
  findings: planner(role) ? [{ rule_id: "leave.v2", status: "unverified", message: "Qualifying grant lacks a verified obligation window", subjects: ["synthetic-grant-2"] }] : [],
  requires_hr_reconciliation: planner(role),
  amendment_trace: [],
});

// Contracts and qualifications: the pharmacist and the leader each have an employment
// revision, a contract and a qualification at the one site of the one employer; the
// administrator has none yet. One agreement and one rule review bound to its source exist.
// The leader's contract was revised once and its regime evidence is still unverified.
const rosterEvidence = { reference: "合成の原本 2026-04", status: "verified", verified_by: "合成の確認責任者", valid_until: null };
const rosterPeriod = { start: "2026-04-01T00:00:00+09:00", end: "2028-04-01T00:00:00+09:00" };
const rosterEmployer = { employer_id: "synthetic-employer-1", name: "東都医療センター（架空）", evidence: rosterEvidence };
const rosterSite = { establishment_id: "synthetic-site-1", employer_id: "synthetic-employer-1", ...rosterPeriod, evidence: rosterEvidence };
const rosterEmployments = leaveOwners.map((person_id, index) => ({ revision_id: `synthetic-employment-${index + 1}`, relationship_id: `synthetic-relationship-${index + 1}`, person_id, employer_id: "synthetic-employer-1", establishment_id: "synthetic-site-1", ...rosterPeriod, contract_order: 1, activity: "employment", method: "standard", week_start: 0, statutory_holidays: ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"], calendar_confirmed: true, declaration: rosterEvidence, agreement_id: "synthetic-agreement-1" }));
const rosterContracts = leaveOwners.map((person_id, index) => ({ revision_id: `synthetic-contract-${index + 1}`, relationship_id: `synthetic-relationship-${index + 1}`, person_id, employer_id: "synthetic-employer-1", facility_id: "synthetic", department_id: "clinical-pharmacy", ...rosterPeriod, engagement: "direct", fixed_term: index === 1, time_category: index === 1 ? "part_time" : "full_time", regime: "general", evidence: rosterEvidence, regime_evidence: index === 1 ? { reference: "合成の就業規則 2026", status: "unverified", verified_by: null, valid_until: null } : rosterEvidence, dispatch_evidence: null, dispatch_tasks: [], external_work_confirmed: true, allowed_weekdays: [0, 1, 2, 3, 4], allowed_kinds: [index === 1 ? "遅番" : "日勤"], period_min_seconds: 0, period_max_seconds: 576000, contractual_week_seconds: 144000, rest_seconds: 39600, max_consecutive_days: 5, overtime_agreement_id: null }));
const rosterCapabilities = leaveOwners.map((person_id, index) => ({ person_id, task: index === 1 ? "調剤" : "病棟", location: index === 1 ? "薬剤部" : "本館", ...rosterPeriod, evidence: rosterEvidence, supervision_required: false, supervisor_capacity: index === 1 ? 2 : 0 }));
const rosterAgreement = { agreement_id: "synthetic-agreement-1", employer_id: "synthetic-employer-1", establishment_id: "synthetic-site-1", ...rosterPeriod, year_start: "2026-04-01", month_anchor: "2026-04-01", daily_limit_seconds: 10800, monthly_limit_seconds: 108000, annual_limit_seconds: 1080000, special_clause: false, holiday_work_permitted: false, evidence: rosterEvidence, invocation_evidence: null };
const rosterReview = { review_id: "synthetic-review-1", rule_id: "synthetic-rule-2026", source_url: "https://example.invalid/synthetic-rule", document_version: "2026-04-01 改正（架空）", source_sha256: "a".repeat(64), provision: "合成の条項 第1条", transitional_provision: "経過措置なし（合成）", reviewed_on: "2026-04-01", next_review_on: "2027-04-01", ...rosterPeriod, evidence: rosterEvidence };
const rosterRecord = (kind: string, entity_id: string, revision: number, payload: Record<string, unknown>) => ({ kind, key: `synthetic-key-${kind}-${entity_id}`, entity_id, revision, payload });
const rosterRecords = [
  rosterRecord("employer", rosterEmployer.employer_id, 1, rosterEmployer),
  rosterRecord("establishment", rosterSite.establishment_id, 1, rosterSite),
  ...rosterEmployments.map((payload) => rosterRecord("employment", payload.revision_id, 1, payload)),
  ...rosterContracts.map((payload, index) => rosterRecord("contract", payload.revision_id, index + 1, payload)),
  ...rosterCapabilities.map((payload, index) => rosterRecord("capability", `synthetic-capability-hash-${index + 1}`, 1, payload)),
  rosterRecord("agreement", rosterAgreement.agreement_id, 1, rosterAgreement),
  rosterRecord("rule_review", rosterReview.review_id, 1, rosterReview),
];
const roster = {
  rule_revision: "synthetic-rule-2026", employers: [rosterEmployer], establishments: [rosterSite], employments: rosterEmployments, contracts: rosterContracts, capabilities: rosterCapabilities,
  capability_targets: rosterCapabilities.map((payload, index) => ({ target_hash: `synthetic-capability-hash-${index + 1}`, revision: 1, payload })), capability_amendments: [], management_models: [],
  agreements: [rosterAgreement], rule_reviews: [rosterReview], rule_decisions: [], accounting_transitions: [], site_attribution_decisions: [], annual_calendars: [],
};
// The input version on screen is current (`stale: false`): no record was saved after it was
// made. So it holds what the records hold: the contracts, qualifications and employments of
// the roster, and both demands (the first as its saved second revision). A snapshot with
// fewer of them beside these records is a state the server reports as stale.
const input = { input_hash: INPUT_HASH, input_revision: 12, publication_version: 12, stale: false, snapshot: { schema_version: 3, period, people, contracts: rosterContracts, capabilities: rosterCapabilities, candidates: assignments, leaves: [], employments: rosterEmployments, demands, facility_id: "synthetic", department_id: "clinical-pharmacy" } };
// What the earlier rule revision decided within the review's interval: the one publication.
const ruleImpact = { scope_id: scopeId, review_id: rosterReview.review_id, rule_id: rosterReview.rule_id, source_sha256: rosterReview.source_sha256, document_version: rosterReview.document_version, publications: [{ publication_id: publication.publication_id, period_key: publication.period, version: 12, rule_revision: "synthetic-rule-2025", period_known: true }], grant_assessments: [], grant_records: [], impact_count: 1, impact_hash: "b".repeat(64) };

// The API answers a planner with their own role, and lets only an administrator correct actuals.
const workflowContext = { ...workflow, ...roster,
  leave_accounts: leaveAccounts, leave_policies: leavePolicies, leave_records: leaveEvents, leave_obligations: [], ledger_recordings: ledgerRecordings, records: [...workflow.records, ...leaveRecords, ...rosterRecords] };

// Flextime (the synthetic day is 2026-10-12): one adoption in effect since April with two
// participants, one registered by another administrator and awaiting this viewer's
// confirmation, and one withdrawn. Each record carries what the API answers the viewer:
// the steps open now, with its reason for each closed one, and the days it accepts.
const flexMay = { allowed: true, refusal: null };
const flexNot = (refusal: string) => ({ allowed: false, refusal });
const flexTerms = { employer_id: "synthetic-employer-1", establishment_id: "synthetic-site-1", settlement_months: 1, total_hours_rule: "statutory_frame", agreed_total_description: "清算期間の暦日数 ÷ 7 × 40時間", standard_day_seconds: 28800, flexible_time: [{ start: "07:00:00", end: "20:00:00" }], core_time: [{ start: "10:00:00", end: "15:00:00" }], work_rules_evidence: rosterEvidence, agreement_evidence: rosterEvidence };
const flexStarted = "開始後は取り下げられません。採用は、将来の清算期間の初日で終了してください。本人を外すときは、清算期間の初日から通常の雇用条件を登録してください。";
const flexAdoptions = [
  { entity_id: "synthetic-flex-1", revision: 2, payload: { ...flexTerms, adoption_id: "synthetic-flex-1", start: "2026-04-01T00:00:00+09:00", end: "2027-04-01T00:00:00+09:00", target_scope: "薬剤部の常勤の薬剤師（合成）", settlement_anchor: "2026-04-01", status: "confirmed", created_by: "synthetic-account-2", created_at: "2026-03-01T09:00:00+09:00", reviewed_by: "admin", reviewed_at: "2026-03-05T09:00:00+09:00" },
    settlement_starts: { participant_start: ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"], end_on: ["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"] },
    actions: { confirm: flexNot("確認できるのは、登録済みで確認待ちの採用だけです。"), withdraw: flexNot(flexStarted), end: flexMay, add_participant: flexMay } },
  { entity_id: "synthetic-flex-2", revision: 1, payload: { ...flexTerms, adoption_id: "synthetic-flex-2", start: "2027-04-01T00:00:00+09:00", end: "2028-04-01T00:00:00+09:00", target_scope: "薬剤部の常勤の薬剤師（合成・次年度）", settlement_anchor: "2027-04-01", status: "registered", created_by: "synthetic-account-2", created_at: "2026-10-01T09:00:00+09:00" },
    settlement_starts: { participant_start: ["2027-04-01", "2027-05-01", "2027-06-01"], end_on: [] },
    actions: { confirm: flexMay, withdraw: flexMay, end: flexNot("終了できるのは、確認済みで終了日を定めていない採用だけです。"), add_participant: flexMay } },
  { entity_id: "synthetic-flex-0", revision: 2, payload: { ...flexTerms, adoption_id: "synthetic-flex-0", start: "2026-01-01T00:00:00+09:00", end: "2026-04-01T00:00:00+09:00", target_scope: "薬剤部の全職員（合成・見直し前）", settlement_anchor: "2026-01-01", status: "withdrawn", created_by: "admin", created_at: "2025-12-01T09:00:00+09:00", decided_by: "synthetic-account-2", decided_at: "2025-12-10T09:00:00+09:00", withdrawal_reason: "対象範囲を見直すため（合成）" },
    settlement_starts: { participant_start: [], end_on: [] },
    actions: { confirm: flexNot("確認できるのは、登録済みで確認待ちの採用だけです。"), withdraw: flexNot("すでに取り下げられています。"), end: flexNot("終了できるのは、確認済みで終了日を定めていない採用だけです。"), add_participant: flexNot("取り下げた採用には参加を登録できません。") } },
];
const flexEnrollments = [
  { entity_id: "synthetic-flex-1-synthetic-pharmacist", revision: 2, payload: { enrollment_id: "synthetic-flex-1-synthetic-pharmacist", adoption_id: "synthetic-flex-1", person_id: "synthetic-pharmacist", start: "2026-04-01T00:00:00+09:00", status: "confirmed", created_by: "synthetic-account-2", created_at: "2026-03-01T09:00:00+09:00", reviewed_by: "admin", reviewed_at: "2026-03-05T09:00:00+09:00" },
    actions: { confirm: flexNot("確認できるのは、確認済みの採用に属する確認待ちの参加だけです。"), withdraw: flexNot("開始後の参加は取り下げられません。本人を外すときは、清算期間の初日から通常の雇用条件を登録してください。") } },
  { entity_id: "synthetic-flex-1-synthetic-leader-a1b2c3d4", revision: 1, payload: { enrollment_id: "synthetic-flex-1-synthetic-leader-a1b2c3d4", adoption_id: "synthetic-flex-1", person_id: "synthetic-leader", start: "2026-11-01T00:00:00+09:00", status: "registered", created_by: "admin", created_at: "2026-10-05T09:00:00+09:00" },
    actions: { confirm: flexNot("登録した管理者本人は確認できません。別の管理者が確認してください。"), withdraw: flexMay } },
];
const flexListing = { viewer: "admin", can_manage: true, manage_refusal: null, adoptions: flexAdoptions, enrollments: flexEnrollments, establishments: [rosterSite], people };
const flexImpact = { adoption_id: "synthetic-flex-2", status: "registered", settlement: { months: 1, anchor: "2027-04-01", total_hours_rule: "statutory_frame" }, people: [], timed_duties: [], blocking: [],
  next_steps: ["参加者ごとに、参加の開始日から始まるフレックスタイム制の雇用条件を登録する", "開始日以降の時刻付き勤務を取り除き、必要配置を他の職員で満たせるか確認する"], impact_hash: "c".repeat(64) };
const flexSettlements = { input_hash: input.input_hash, people: [{ person_id: "synthetic-pharmacist", name: "高橋 葵", settlements: [
  { kind: "flextime", person_id: "synthetic-pharmacist", start: "2026-09-01", end: "2026-10-01", frame_seconds: 617142, worked_seconds: 626400, monthly_overtime_seconds: {}, final_month_overtime_seconds: 9258, unattributed_seconds: 0 },
] }], findings: [{ rule_id: "work.flextime", status: "unverified", message: "The flextime settlement period from 2026-10-01 is not fully in the input: synthetic-employment-1", subjects: ["synthetic-pharmacist"] }] };

/** Synthetic responses for the exact production feature components used by v3 stories. */
// Requests about personal data as an administrator is given them: each with the decisions
// the server accepts next. A pharmacist is given only their own, none of which they may
// decide, and neither the rules nor the holds.
const privacyCases = [
  { case_id: "synthetic-case-access", revision: 1, status: "REQUESTED", payload: { person_id: "synthetic-pharmacist", kind: "access", reason: "自分の勤務記録の開示" }, allowed_next: ["VERIFIED", "REJECTED"], result_reference_required: [] as string[] },
  { case_id: "synthetic-case-erase", revision: 3, status: "APPROVED", payload: { person_id: "synthetic-leader", kind: "erase", reason: "退職に伴う消去の請求", decision_history: [
    { expected_revision: 1, status: "VERIFIED", reason: "本人確認を実施", result_reference: null, identity_evidence: { reference: "SYNTHETIC-ID-1", status: "verified", verified_by: "佐藤 美咲" } },
    { expected_revision: 2, status: "APPROVED", reason: "保存義務のない記録を確認", result_reference: null, identity_evidence: { reference: "SYNTHETIC-ID-1", status: "verified", verified_by: "佐藤 美咲" } },
  ] }, allowed_next: ["COMPLETED", "RELEASED"], result_reference_required: ["COMPLETED"] },
];
const retentionRule = (category: string, anchor: string, revision: number, days: number) => ({ key: `synthetic-rule-${category}`, revision, payload: { category, purpose: "勤務表の作成と検証", anchor, retention_days: days, legal_minimum_days: 1095, effective_from: "2026-04-01", effective_until: "2029-04-01", owner: "佐藤 美咲", next_review: "2027-04-01", evidence: { reference: "SYNTHETIC-RULE", status: "verified", verified_by: "佐藤 美咲" } } });
function privacyListing(role: IdealRole, personId: string) {
  const admin = role === "ADMIN";
  return {
    cases: privacyCases.filter((item) => admin || item.payload.person_id === personId).map((item) => (admin ? item : { ...item, allowed_next: [], result_reference_required: [] })),
    rules: admin ? [retentionRule("planning_history", "period_end", 2, 1825), retentionRule("control", "case_closed", 1, 3650)] : [],
    holds: admin ? [{ hold_id: "synthetic-hold", revision: 1, active: true, person_id: "synthetic-pharmacist", payload: { reason: "係争中の記録の保全" } }] : [],
    people: people.filter((person) => role !== "PHARMACIST" || person.person_id === personId),
  };
}
const copyInventory = {
  person_id: "synthetic-leader",
  targets: [
    { copy_id: "synthetic-copy-database", revision: 2, medium: "database", state: "PRESENT", blockers: [], expires_at: "2026-09-30T00:00:00+09:00", will_process: true },
    { copy_id: "synthetic-copy-file", revision: 3, medium: "file", state: "PRESENT", blockers: ["shared_copy_requires_separate_preservation_decision"], expires_at: "2026-09-30T00:00:00+09:00", preservation: { payload_hash: "3".repeat(64) }, will_process: false },
    { copy_id: "synthetic-copy-external", revision: 1, medium: "external", state: "PRESENT", blockers: ["external_confirmation_required"], expires_at: "2026-09-30T00:00:00+09:00", will_process: false },
  ],
  unverified_copies: [], database_records_remaining: ["compliance_entities:synthetic"],
  database_inventory: { control_records_remaining: [{ table: "erased_subjects", object: "erased_subjects:synthetic", subject_relation: "person_or_plan_reference", purpose: "再作成の防止", retention_status: "RULE_PRESENT", reason: "保存規則の適用確認が必要です。" }] },
};
const subjectControl = { person_id: "synthetic-leader", revision: 0, state: "NOT_APPLIED", all_copies_erased: false, identity_boundary: "stable person ID only; unknown aliases require identity review", inventory: copyInventory, applicable_cases: [{ case_id: "synthetic-case-erase", revision: 3, reason: "退職に伴う消去の請求" }] };

// The calendar as the API gives it: to a planner the department's duties and the right to
// export them; to a pharmacist their own duties, the changes among those, and no export.
const calendar = { scope_id: scopeId, requested_period: "2026-10", visibility: "department", publication: publicationSummary, previous_publication: { ...publicationSummary, publication_id: "synthetic-publication-11", version: 11, created_at: "2026-10-01T07:40:00+09:00" }, assignments, changes: [{ duty_id: "synthetic-duty-2", kind: "CHANGED" }], can_export_department: true, limitations: ["公開済みの勤務だけを表示します。"] };
const calendarFor = (role: IdealRole, personId: string) => {
  if (role !== "PHARMACIST") return calendar;
  const own = calendar.assignments.filter((duty) => duty.person_id === personId);
  return { ...calendar, visibility: "self", assignments: own, changes: calendar.changes.filter((change) => own.some((duty) => duty.duty_id === change.duty_id)), can_export_department: false };
};
// Who changed the setting and why is for administrators only; the account is the one that
// signed in, as the server stores it (not a role).
const consentHistory = [{ revision: 2, enabled: false, reason: "運用確認", reference: "SYNTHETIC-2", actor: "synthetic-admin", at: "2026-10-01T09:00:00+09:00" }];
const scopeSettings = (role: IdealRole) => ({ scope_id: "synthetic/clinical-pharmacy", absence_replacement_consent: { enabled: false, revision: 2, history: role === "ADMIN" ? consentHistory : null } });

export const workspaceV3Routes: FetchRoute[] = [
  { path: "/planning/change-cases/options", body: changeOptions },
  { path: "/planning/change-cases", body: changeCases },
  { path: "/planning/schedule-calendar", body: calendar, byRole: calendarFor },
  { path: "/planning/dashboard", body: { scope_id: scopeId, period: "2026-10", role: "LEADER", visibility: "department", observed_at: "2026-10-12T08:16:00+09:00", sources: [{ kind: "publication", id: publication.publication_id, version: 12 }], metrics: { pending_requests: { value: leaveRequests.filter((row) => row.status === "PENDING").length, state: "available", reason: null } } } },
  { path: "/planning/schedule-stability", body: { scope_id: scopeId, observed_at: "2026-10-12T08:16:00+09:00", window_days: 14, publication_count: 2, change_event_count: stabilityDays.reduce((sum, item) => sum + item.change_count, 0), days: stabilityDays, meaning: "直近14日間の公開回数と変更イベント件数です。健康・離職・法令適合の効果は示しません。" } },
  { path: "/planning/daily-operations", own: ["scheduled_assignments"], body: { scope_id: "synthetic/clinical-pharmacy", day: "2026-10-12", observed_at: "2026-10-12T08:16:00+09:00", visibility: "department", scheduled_assignments: assignments, scheduled_count: assignments.length, open_case_count: changeCases.length, absence_case_count: changeCases.filter((item) => item.kind === "ABSENCE").length, coverage_finding_count: 0, undelivered_notification_count: 1, limitations: ["予定上の勤務であり、在席・出勤実績ではありません。", "配置注意は進行中ケースのサーバー検証結果だけを数えます。"] } },
  { path: "/planning/notifications", body: syntheticNotifications },
  { path: "/planning/inputs/latest", body: input },
  { path: /\/planning\/drafts\/synthetic-draft-[123]$/, body: { draft_id: "synthetic-draft-1", input_hash: input.input_hash, version: 1, review_hash: null, status: "DRAFT", proposal: { duty_ids: assignments.map((item) => item.duty_id), leave_ids: [] } } },
  // One story the server could return (application/plan_comparison.py) for a period whose
  // published schedule holds the two duties above, compared against the input made from it.
  // Plan 1 keeps both duties and one of them lies on one of the two day-off wishes; plan 2
  // moves one person's duty off the wish and has one unverified finding; plan 3 moves both.
  // The order is the server's key (violations, unverified, unsupported, changes, preference
  // cost, spread): 1, 3, 2. The server pairs every two plans, and its two sentences are its own.
  { path: "/planning/plan-comparison", body: { input_hash: input.input_hash, plans: ([
    { number: 1, unverified: 0, changes: 0, cost: 2, overlapped: 1, total: 57600, spread: 0 },
    { number: 2, unverified: 1, changes: 2, cost: 0, overlapped: 0, total: 55800, spread: 1800 },
    { number: 3, unverified: 0, changes: 4, cost: 0, overlapped: 0, total: 54000, spread: 3600 },
  ]).map((plan) => ({ draft_id: `synthetic-draft-${plan.number}`, findings: { violation: 0, unverified: plan.unverified, unsupported: 0 }, publishable: true, changes_from_previous: plan.changes, changes_from_publication: plan.changes, preference_cost: plan.cost, preferences_met: plan.overlapped, preferences_total: 2, work_seconds_total: plan.total, work_seconds_spread: plan.spread, assignment_count: assignments.length, proposal_hash: `synthetic-${plan.number}`, duplicate_of: null, solver: { job_id: `job-${plan.number}`, status: "FEASIBLE", random_seed: plan.number - 1, objective_by_level: [], proven_levels: 2 } })),
    pairs: [{ a: "synthetic-draft-1", b: "synthetic-draft-2", differing_duties: 2, affected_people: 1 }, { a: "synthetic-draft-1", b: "synthetic-draft-3", differing_duties: 4, affected_people: 2 }, { a: "synthetic-draft-2", b: "synthetic-draft-3", differing_duties: 2, affected_people: 1 }],
    order: ["synthetic-draft-1", "synthetic-draft-3", "synthetic-draft-2"],
    order_rule: "違反の数 → 未確認の数 → 未対応の数 → 前回からの変更数 → 希望のコスト → 勤務時間の差（最大と最小）の小さい順。同じ値なら作成順。",
    meaning: "合成の点数はありません。並びは確認の補助で、公開には確認（review）と検証が必要です。" } },
  { path: "/planning/inputs", body: [{ input_hash: input.input_hash, period, stale: false }] },
  { path: "/planning/publications", own: ["assignments"], body: [publication] },
  { path: "/planning/scopes", body: [{ scope_id: "synthetic/clinical-pharmacy", person_id: "synthetic-admin", role: "ADMIN", input_revision: 12 }] },
  { path: "/planning/memberships", body: memberships, byQuery: (body, query) => query.get("include_inactive") === "true" ? body : (body as typeof memberships).filter((item) => item.active) },
  { path: "/planning/lifecycle-cases", body: lifecycleCases },
  { path: "/planning/scope-settings", body: scopeSettings("ADMIN"), byRole: scopeSettings },
  { path: "/planning/audit-timeline", body: { entries: [{ at: publicationSummary.created_at, category: "schedule", kind: "schedule.published", actor_role: "LEADER", subject_count: 3, version: 12 }], next_cursor: null, limits: ["氏名・職員IDは表示しません。"] } },
  { path: "/planning/compliance/recovery-status", body: { state: "REPLAYED", manifest_hash: "synthetic-manifest-sha256", note: "隔離復旧演習で消去制御を再適用しました。" } },
  { path: "/planning/compliance/records", body: leaveRecords, byRole: (role, personId) => leaveRecords.filter((row) => planner(role) || (row.payload as { person_id?: string }).person_id === personId) },
  { path: "/planning/compliance/privacy", body: privacyListing("ADMIN", "synthetic-admin"), byRole: privacyListing },
  { path: /\/planning\/compliance\/subject-controls\/[^/]+$/, body: subjectControl },
  { path: "/planning/compliance/copies/account-backfill", body: { preview_hash: "c".repeat(64), changes: [{ copy_id: "synthetic-copy-database", revision: 2, additional_person_ids: ["synthetic-leader"] }], unresolved_copy_ids: [] } },
  { path: "/planning/compliance/copies", body: copyInventory },
  { path: "/planning/compliance/erasure-candidates", body: { observed_at: "2026-10-12T08:16:00+09:00", inputs: [
    { input_hash: "b".repeat(64), input_revision: 12, period, registered_at: "2026-09-20T09:00:00+09:00", erasable: false, blockers: ["保存期限未満または起算条件が未対応です", "現行入力として参照されています"], target_count: 4 },
    { input_hash: "9".repeat(64), input_revision: 3, period: { start: "2020-10-01T00:00:00+09:00", end: "2020-11-01T00:00:00+09:00" }, registered_at: "2020-09-20T09:00:00+09:00", erasable: true, blockers: [], target_count: 2 },
  ] } },
  { path: /\/planning\/compliance\/copies\/[^/]+\/joint-review$/, body: { copy_id: "synthetic-copy-file", revision: 3, source_hash: "d".repeat(64), context_hash: "e".repeat(64), context: { owners: ["synthetic-leader", "synthetic-pharmacist"], participants: [{ person_id: "synthetic-leader", case_id: "synthetic-case-erase", case_revision: 3, case_reason: "退職に伴う消去の請求", case_hash: "f".repeat(64), control_hash: "1".repeat(64) }], policy_key: "synthetic-rule-history", policy_revision: 2, policy_hash: "2".repeat(64), policy_purpose: "勤務表の作成と検証" } } },
  { path: /\/planning\/compliance\/copies\/[^/]+\/projection$/, body: { copy_id: "synthetic-copy-file", revision: 3, source_digest: "d".repeat(64), payload_hash: "3".repeat(64), person_ids: ["synthetic-pharmacist"], payload: { retained: { people: [{ person_id: "synthetic-pharmacist", name: "高橋 葵" }] }, removed_counts: { people: 1, assignments: 2 } } } },
  { path: "/planning/compliance/leave-report", body: leaveReport("ADMIN", "synthetic-admin"), byRole: leaveReport },
  { path: "/planning/compliance/workflow-context", body: workflowContext, byRole: (role) => ({ ...workflowContext, role, can_correct_actuals: role === "ADMIN" }) },
  { path: /\/planning\/compliance\/rule-impact\/[^/]+$/, body: ruleImpact },
  { path: "/planning/compliance/declaration-context", body: declarationContext("ADMIN", "synthetic-admin"), byRole: declarationContext },
  { path: "/planning/compliance/copies/context", body: { people } },
  { path: "/planning/compliance/grant-assessments/context", body: { input_hash: input.input_hash, source_revision: 12, as_of: "2026-10-12", accounts: leaveAccounts, candidates: [], findings: [] } },
  { path: "/planning/compliance/flex-adoptions", body: flexListing },
  { path: "/planning/compliance/flex-settlements", body: flexSettlements },
  { path: /\/planning\/compliance\/flex-adoptions\/[^/]+\/impact$/, body: flexImpact },
  { path: "/planning/requests", body: leaveRequests, byRole: (role, personId) => leaveRequests.filter((row) => planner(role) || row.person_id === personId) },
  { path: "/planning/leave-balances", body: [] },
];
