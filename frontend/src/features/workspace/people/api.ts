// The people purpose's own calls to the records of staff, facility and rules, on the
// transport of the typed client (credentials, 401 handling, error bodies; the server and
// the showcase pass their own). Literal paths, so devtools/er/ia_map.py can map them to
// their handlers.
import type { IdealClient, Keyed } from "@/ideal/api/client";
import type { RecordEvidence } from "../shared/records/evidence";
import type { StoredRow } from "../shared/records/staged";

export type RecordSaved = { key: string; revision: number; kind: string };
type Saved<P> = { expected_revision: number; payload: P } & Keyed;

// ── Staff ───────────────────────────────────────────────────────────────────
export type PersonPayload = { person_id: string; name: string };
export type WorkingTimeSystem = "standard" | "monthly_variable" | "annual_variable" | "flex";
/** The server leaves out the fields of a working-time system that is not chosen, and the
 * holiday system when it is the weekly one. */
export type EmploymentPayload = {
  revision_id: string; relationship_id: string; person_id: string; employer_id: string; establishment_id?: string;
  start: string; end: string; contract_order: number | null; activity: "employment" | "nonemployment"; method: "standard" | "management";
  week_start: number; statutory_holidays: string[]; calendar_confirmed: boolean; declaration: RecordEvidence; agreement_id: string | null;
  holiday_system?: "weekly" | "four_week"; four_week_start?: string | null;
  working_time_system?: WorkingTimeSystem; variable_anchor?: string | null; variable_period_days?: number | null; variable_evidence?: RecordEvidence | null;
  annual_calendar_id?: string | null; flex_anchor?: string | null; flex_months?: number | null;
  flex_full_two_day_weekend?: boolean; flex_rest_weekdays?: number[]; flex_other_rest_days?: string[];
};
export type ContractPayload = {
  revision_id: string; relationship_id: string; person_id: string; employer_id: string; facility_id: string; department_id: string;
  start: string; end: string; engagement: "direct" | "agency"; fixed_term: boolean; time_category: "full_time" | "part_time"; regime: string;
  evidence: RecordEvidence; regime_evidence: RecordEvidence; dispatch_evidence: RecordEvidence | null; dispatch_tasks: string[];
  external_work_confirmed: boolean; allowed_weekdays: number[]; allowed_kinds: string[];
  period_min_seconds: number; period_max_seconds: number; contractual_week_seconds: number; rest_seconds: number; max_consecutive_days: number;
  overtime_agreement_id: string | null;
};
export type CapabilityPayload = { person_id: string; task: string; location: string; start: string; end: string; evidence: RecordEvidence; supervision_required: boolean; supervisor_capacity: number };
export type CapabilityAmendmentPayload = { amendment_id: string; person_id: string; target_hash: string; effective_at: string; reason: string; evidence: RecordEvidence };

// ── Facility ────────────────────────────────────────────────────────────────
export type EmployerPayload = { employer_id: string; name: string; evidence: RecordEvidence };
export type EstablishmentPayload = { establishment_id: string; employer_id: string; start: string; end: string; evidence: RecordEvidence };
export type ManagementModelPayload = {
  model_id: string; person_id: string; first_employer: string; second_employer: string; start: string; end: string; month_anchor: string;
  first_month_limit_seconds: number; second_month_limit_seconds: number; first_consent: RecordEvidence; second_consent: RecordEvidence; notification: RecordEvidence;
};

// ── Rules ───────────────────────────────────────────────────────────────────
export type AgreementPayload = {
  agreement_id: string; employer_id: string; establishment_id?: string; start: string; end: string; year_start: string; month_anchor: string;
  daily_limit_seconds: number; monthly_limit_seconds: number; annual_limit_seconds: number; special_clause: boolean; holiday_work_permitted: boolean;
  evidence: RecordEvidence; invocation_evidence: RecordEvidence | null;
};
export type RuleReviewPayload = {
  review_id: string; rule_id: string; source_url: string; document_version?: string; source_sha256?: string; provision: string; transitional_provision: string;
  reviewed_on: string; next_review_on: string; start: string; end: string; evidence: RecordEvidence;
};
export type RuleDecisionPayload = { decision_id: string; review_id: string; rule_id: string; source_sha256: string; decision: "publish" | "hold"; impact_hash: string; impact_count: number; decided_on: string; evidence: RecordEvidence };
export type AccountingTransitionPayload = { transition_id: string; before_revision_id: string; after_revision_id: string; calculation_basis: "effective_calendar_windows" | "preserve_overlapping_full_weeks"; evidence: RecordEvidence };
export type SiteAttributionDecisionPayload = { decision_id: string; employer_id: string; reading: "scheduled_first" | "time_order"; reason: string; start: string; end: string; evidence: RecordEvidence };
export type CalendarDay = { day: string; seconds: number };
export type CalendarSegment = { start: string; end: string; working_days: number; total_seconds: number; fixed_on: string | null; consent: RecordEvidence | null };
export type DateRange = { start: string; end: string };
export type AnnualCalendarPayload = {
  calendar_id: string; employer_id: string; establishment_id: string; start: string; end: string; first_period_end: string; week_start: number | null;
  days: CalendarDay[]; segments: CalendarSegment[]; special_periods: DateRange[]; evidence: RecordEvidence;
};
/** What an earlier rule revision decided within a review's interval, as the server lists
 * it now. A decision is saved bound to `impact_hash` and `impact_count`. */
export type RuleImpact = {
  review_id: string; rule_id: string; source_sha256: string; impact_hash: string; impact_count: number;
  publications: Array<{ publication_id: string; period_key: string; version: number; rule_revision: string | null }>;
  grant_assessments: Array<{ assessment_id: string | null; account_id: string; rule_revision: string | null; as_of: string | null }>;
  grant_records: Array<{ account_id: string; granted_on: string }>;
};

/** What the roster screen reads of the workflow context. The endpoint returns more (the
 * leave ledger, demands, publications, actuals, …); nothing else of it is used or kept. */
export type RosterContext = {
  staging_valid?: boolean;
  validation_issues?: Array<{ location: string | unknown[]; message: string }>;
  rule_revision?: string;
  duty_options?: Array<{ kind: string; task: string; location: string }>;
  people: PersonPayload[];
  employers?: EmployerPayload[];
  establishments?: EstablishmentPayload[];
  management_models?: ManagementModelPayload[];
  employments: EmploymentPayload[];
  contracts: ContractPayload[];
  capabilities: CapabilityPayload[];
  capability_targets?: Array<{ target_hash: string; revision: number; payload: CapabilityPayload }>;
  capability_amendments?: CapabilityAmendmentPayload[];
  agreements?: AgreementPayload[];
  rule_reviews?: RuleReviewPayload[];
  rule_decisions?: RuleDecisionPayload[];
  accounting_transitions?: AccountingTransitionPayload[];
  site_attribution_decisions?: SiteAttributionDecisionPayload[];
  annual_calendars?: AnnualCalendarPayload[];
  records: StoredRow[];
};

export function peopleApi(client: Pick<IdealClient, "request">) {
  const request = client.request;
  const scope = (scopeId: string) => encodeURIComponent(scopeId);
  return {
    /** The records staged over the latest input version (planners only; saving them is an administrator's). */
    rosterContext: (scopeId: string) => request<RosterContext>(`/compliance/workflow-context?scope_id=${scope(scopeId)}`),
    /** What a publish-or-hold decision on this review is bound to (administrators only). */
    ruleImpact: (scopeId: string, reviewId: string) => request<RuleImpact>(`/compliance/rule-impact/${encodeURIComponent(reviewId)}?scope_id=${scope(scopeId)}`),

    savePerson: (scopeId: string, body: Saved<PersonPayload>) => request<RecordSaved>(`/compliance/records/person?scope_id=${scope(scopeId)}`, "POST", body),
    saveEmployment: (scopeId: string, body: Saved<EmploymentPayload>) => request<RecordSaved>(`/compliance/records/employment?scope_id=${scope(scopeId)}`, "POST", body),
    saveContract: (scopeId: string, body: Saved<ContractPayload>) => request<RecordSaved>(`/compliance/records/contract?scope_id=${scope(scopeId)}`, "POST", body),
    saveCapability: (scopeId: string, body: Saved<CapabilityPayload>) => request<RecordSaved>(`/compliance/records/capability?scope_id=${scope(scopeId)}`, "POST", body),
    saveCapabilityAmendment: (scopeId: string, body: Saved<CapabilityAmendmentPayload>) => request<RecordSaved>(`/compliance/records/capability_amendment?scope_id=${scope(scopeId)}`, "POST", body),

    saveEmployer: (scopeId: string, body: Saved<EmployerPayload>) => request<RecordSaved>(`/compliance/records/employer?scope_id=${scope(scopeId)}`, "POST", body),
    saveEstablishment: (scopeId: string, body: Saved<EstablishmentPayload>) => request<RecordSaved>(`/compliance/records/establishment?scope_id=${scope(scopeId)}`, "POST", body),
    saveManagementModel: (scopeId: string, body: Saved<ManagementModelPayload>) => request<RecordSaved>(`/compliance/records/management_model?scope_id=${scope(scopeId)}`, "POST", body),

    saveAgreement: (scopeId: string, body: Saved<AgreementPayload>) => request<RecordSaved>(`/compliance/records/agreement?scope_id=${scope(scopeId)}`, "POST", body),
    saveRuleReview: (scopeId: string, body: Saved<RuleReviewPayload>) => request<RecordSaved>(`/compliance/records/rule_review?scope_id=${scope(scopeId)}`, "POST", body),
    saveRuleDecision: (scopeId: string, body: Saved<RuleDecisionPayload>) => request<RecordSaved>(`/compliance/records/rule_decision?scope_id=${scope(scopeId)}`, "POST", body),
    saveAccountingTransition: (scopeId: string, body: Saved<AccountingTransitionPayload>) => request<RecordSaved>(`/compliance/records/accounting_transition?scope_id=${scope(scopeId)}`, "POST", body),
    saveSiteAttributionDecision: (scopeId: string, body: Saved<SiteAttributionDecisionPayload>) => request<RecordSaved>(`/compliance/records/site_attribution_decision?scope_id=${scope(scopeId)}`, "POST", body),
    saveAnnualCalendar: (scopeId: string, body: Saved<AnnualCalendarPayload>) => request<RecordSaved>(`/compliance/records/annual_calendar?scope_id=${scope(scopeId)}`, "POST", body),
  };
}
