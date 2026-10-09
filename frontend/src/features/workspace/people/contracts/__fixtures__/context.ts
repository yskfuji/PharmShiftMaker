// What the workflow context answers in the tests of the contracts route: one person with
// two adjacent employment revisions at one employer and a third at another, a contract, a
// qualification, an agreement, a rule review bound to its source and a calendar. It also
// holds what the endpoint returns for other screens, which this route must not keep.
export const UUID = "11111111-2222-4333-8444-555555555555";
export const evidence = { reference: "合成の原本", status: "verified", verified_by: "確認者", valid_until: null };
const period = { start: "2026-01-01T00:00:00+09:00", end: "2029-01-01T00:00:00+09:00" };

export const PERSON = { person_id: "p1", name: "合成 一" };
export const OTHER = { person_id: "p2", name: "合成 二" };
export const EMPLOYER = { employer_id: "hospital", name: "合成病院", evidence };
export const CLINIC = { employer_id: "clinic", name: "合成診療所", evidence };
export const SITE = { establishment_id: "site1", employer_id: "hospital", ...period, evidence };
export const SITE2 = { establishment_id: "site2", employer_id: "clinic", ...period, evidence };
const employment = (revision_id: string, relationship_id: string, establishment_id: string, employer_id: string, start: string, end: string) =>
  ({ revision_id, relationship_id, person_id: "p1", employer_id, establishment_id, start, end, contract_order: 1, activity: "employment", method: "standard", week_start: 0, statutory_holidays: ["2026-01-04", "2026-01-11"], calendar_confirmed: true, declaration: evidence, agreement_id: null });
export const EMPLOYMENTS = [
  employment("emp1", "rel1", "site1", "hospital", "2026-01-01T00:00:00+09:00", "2026-07-01T00:00:00+09:00"),
  employment("emp2", "rel1", "site1", "hospital", "2026-07-01T00:00:00+09:00", "2028-01-01T00:00:00+09:00"),
  employment("emp3", "rel2", "site2", "clinic", "2026-01-01T00:00:00+09:00", "2028-01-01T00:00:00+09:00"),
];
export const CONTRACT = {
  revision_id: "c1", relationship_id: "rel1", person_id: "p1", employer_id: "hospital", facility_id: "synthetic", department_id: "clinical-pharmacy", start: "2026-01-01T00:00:00+09:00", end: "2028-01-01T00:00:00+09:00",
  engagement: "direct", fixed_term: false, time_category: "full_time", regime: "general", evidence, regime_evidence: { reference: "合成の就業規則", status: "unverified", verified_by: null, valid_until: null }, dispatch_evidence: null, dispatch_tasks: [],
  external_work_confirmed: true, allowed_weekdays: [0, 1, 2, 3, 4], allowed_kinds: ["DAY"], period_min_seconds: 0, period_max_seconds: 576000, contractual_week_seconds: 144000, rest_seconds: 39600, max_consecutive_days: 5, overtime_agreement_id: null,
};
export const CAPABILITY = { person_id: "p1", task: "調剤", location: "薬剤部", start: "2026-01-01T00:00:00+09:00", end: "2028-01-01T00:00:00+09:00", evidence, supervision_required: false, supervisor_capacity: 0 };
export const CAPABILITY_HASH = "e".repeat(64);
export const AGREEMENT = { agreement_id: "a1", employer_id: "hospital", establishment_id: "site1", ...period, year_start: "2026-04-01", month_anchor: "2026-04-01", daily_limit_seconds: 10800, monthly_limit_seconds: 108000, annual_limit_seconds: 1080000, special_clause: false, holiday_work_permitted: false, evidence, invocation_evidence: null };
export const REVIEW = { review_id: "rev1", rule_id: "r-2026", source_url: "https://example.invalid/rule", document_version: "2026-04-01 改正", source_sha256: "c".repeat(64), provision: "合成の条項", transitional_provision: "経過措置なし", reviewed_on: "2026-04-01", next_review_on: "2027-04-01", ...period, evidence };
export const CALENDAR = { calendar_id: "cal1", employer_id: "hospital", establishment_id: "site1", start: "2026-04-01", end: "2027-04-01", first_period_end: "2027-04-01", week_start: 0, days: [{ day: "2026-04-01", seconds: 28800 }], segments: [], special_periods: [], evidence };
export const IMPACT = {
  scope_id: "synthetic/clinical-pharmacy", review_id: "rev1", rule_id: "r-2026", source_sha256: "c".repeat(64), document_version: "2026-04-01 改正", impact_hash: "d".repeat(64), impact_count: 2,
  publications: [{ publication_id: "pub1", period_key: "2026-01-05T00:00:00+09:00|2026-01-12T00:00:00+09:00", version: 3, rule_revision: "r-2025", period_known: true }],
  grant_assessments: [], grant_records: [{ account_id: "g1", granted_on: "2026-01-01", revision: 1 }],
};

const row = (kind: string, entity_id: string, revision: number, payload: Record<string, unknown>) => ({ kind, key: `k-${kind}-${entity_id}`, entity_id, revision, payload });
export const RECORDS = [
  row("person", "p1", 1, PERSON), row("person", "p2", 1, OTHER),
  row("employer", "hospital", 1, EMPLOYER), row("employer", "clinic", 1, CLINIC),
  row("establishment", "site1", 1, SITE), row("establishment", "site2", 1, SITE2),
  ...EMPLOYMENTS.map((item) => row("employment", item.revision_id, 1, item)),
  row("contract", "c1", 2, CONTRACT),
  row("capability", CAPABILITY_HASH, 1, CAPABILITY),
  row("agreement", "a1", 1, AGREEMENT),
  row("rule_review", "rev1", 1, REVIEW),
  row("annual_calendar", "cal1", 1, CALENDAR),
  // Records of other screens, which the endpoint returns as well.
  row("leave_account", "g1", 3, { account_id: "g1", person_id: "p1" }),
];
export const CONTEXT = {
  role: "ADMIN", can_correct_actuals: true, input_hash: "a".repeat(64), staging_valid: true, validation_issues: [] as Array<{ location: unknown[]; message: string; type: string }>, rule_revision: "r-2026",
  people: [PERSON, OTHER], employers: [EMPLOYER, CLINIC], establishments: [SITE, SITE2], employments: EMPLOYMENTS, contracts: [CONTRACT], capabilities: [CAPABILITY],
  capability_targets: [{ target_hash: CAPABILITY_HASH, revision: 1, payload: CAPABILITY }], capability_amendments: [], management_models: [],
  agreements: [AGREEMENT], rule_reviews: [REVIEW], rule_decisions: [], accounting_transitions: [], site_attribution_decisions: [], annual_calendars: [CALENDAR],
  duty_options: [{ kind: "DAY", task: "調剤", location: "薬剤部" }, { kind: "LATE", task: "病棟", location: "本館" }],
  leave_accounts: [{ account_id: "g1", person_id: "p1" }], leave_policies: [], leave_records: [], leave_obligations: [], ledger_recordings: [], work_terms: [], demands: [{ demand_id: "d1" }],
  flex_adoptions: [], flex_enrollments: [], publications: [{ publication_id: "pub1", version: 3, period: "x", assignments: [{ person_id: "p1" }] }], actuals: [{ external_id: "actual-1" }],
  records: RECORDS,
};
