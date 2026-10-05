// The requests purpose's own calls (leave and outside work), on the transport of the typed
// client (credentials, 401 handling, error bodies; the server and the showcase pass their
// own). Literal paths, so devtools/er/ia_map.py can map them to their handlers.
import type { IdealClient, Keyed } from "@/ideal/api/client";
import type { RecordEvidence } from "../shared/records/evidence";

export type Piece = { start: string; end: string };
export type RecordSaved = { key: string; revision: number; kind: string };
type Saved<P> = { expected_revision: number; payload: P } & Keyed;

// ── Outside work ────────────────────────────────────────────────────────────
export type DeclarationStatus = "SUBMITTED" | "REVIEWED" | "RETURNED" | "WITHDRAWN";
export type DeclarationPayload = {
  declaration_id: string; person_id: string; employer_id: string; establishment_id: string;
  contract_order: number | null; activity: "employment" | "nonemployment"; start: string; end: string;
  reference: string; status: DeclarationStatus; work_report_complete: boolean;
  scheduled_work: Piece[]; additional_work: Piece[]; other_holiday_work?: Piece[];
  review_evidence: RecordEvidence | null;
};
/** `actions.change`: what the declaration route answers this viewer for a correction or a
 * withdrawal of the stored version, with the route's own message when it refuses. */
export type DeclarationRow = { entity_id: string; revision: number; payload: DeclarationPayload; actions: { change: { allowed: boolean; refusal: string | null } } };
export type DeclarationContext = {
  person_id: string;
  employers: Array<{ employer_id: string; name: string }>;
  establishments: Array<{ establishment_id: string; employer_id: string; name?: string }>;
  declarations: DeclarationRow[];
};
export type DeclarationSaved = { key: string; revision: number; status: DeclarationStatus };

// ── Leave ───────────────────────────────────────────────────────────────────
export type LeaveUnit = "day" | "half_day" | "hour";
export type LeaveRequestRow = {
  request_id: string; person_id: string; version: number; kind: string; status: string;
  payload: { start: string; end: string; unit?: LeaveUnit; quantity?: number; account_id?: string; policy_id?: string; reference?: string };
  decision?: { reference: string } | null;
};
type Days = { numerator: number; denominator: number };
export type LeaveBalance = { account_id: string; person_id: string; remaining_days: Days; reserved_days: Days; available_days: Days; expired: boolean; person_name?: string | null; employer_name?: string | null; granted_on?: string | null };
export type LeaveObligationState = { obligation_id: string; person_id: string; required_half_days: number; taken_half_days: number; status: string; end: string; start?: string | null; person_name?: string | null; employer_name?: string | null };
export type LedgerFinding = { rule_id: string; status: string; message: string; subjects: string[] };
export type AmendmentTrace = { amendment_id: string; person_id?: string; previous_days?: number; corrected_days?: number; event_id?: string; previous_event?: { unit: LeaveUnit; quantity: number } | null; corrected_event?: { unit: LeaveUnit; quantity: number } | null; reason: string };
export type LeaveReport = { balances: LeaveBalance[]; obligations: LeaveObligationState[]; findings: LedgerFinding[]; requires_hr_reconciliation?: boolean; amendment_trace?: AmendmentTrace[] };
export type ComplianceRow = { kind: string; entity_id: string; revision: number; payload: Record<string, unknown> };

export type WishBody = { start: string; end: string; kind: "PUBLIC_HOLIDAY_REQUEST"; rank: 1; grant_id: null; amount: 1 };
export type PaidLeaveClaim = { account_id: string; policy_id: string; unit: LeaveUnit; quantity: number; interval: Piece; reference: string };
export type RequestAnswer = { request_id?: string; status: string; version?: number };

export type LeavePolicyPayload = { policy_id: string; person_id: string; employer_id: string; start: string; end: string; hourly_enabled: boolean; half_day_enabled: boolean; hours_per_day: number; hourly_quantum: number; hourly_year_start: string; hourly_cap_days: number; evidence: RecordEvidence };
export type LeaveAccountPayload = { account_id: string; person_id: string; employer_id: string; granted_on: string; expires_on: string; statutory_days: number; granted_days: number; evidence: RecordEvidence; grant_cycle_id: string | null };
export type LeaveEventKind = "reserve" | "release" | "take" | "reverse" | "expire" | "conversion";
export type LeaveEventPayload = { event_id: string; account_id: string; kind: LeaveEventKind; unit: LeaveUnit; quantity: number; effective_on: string; policy_id: string; interval: Piece | null; related_event_id: string | null; evidence: RecordEvidence; conversion_old_hours: number | null; conversion_new_hours: number | null };
export type LeaveObligationPayload = { obligation_id: string; person_id: string; employer_id: string; start: string; end: string; required_half_days: number; qualifying_grant_ids: string[]; evidence: RecordEvidence; method: "separate" | "consolidated" | "split_advance"; rounding_unit: "day" | "half_day"; half_day_request_evidence: RecordEvidence | null };
export type LedgerRecordingPayload = { recording_id: string; object_kind: "leave_account" | "leave_record"; object_id: string; external_event_id: string; external_revision: number; recorded_at: string; evidence: RecordEvidence };
/** What the ledger tasks read of the workflow context. The endpoint returns more (contracts,
 * publications, actuals, …); nothing else of it is used or kept. */
export type LedgerContext = {
  people: Array<{ person_id: string; name: string }>;
  employers?: Array<{ employer_id: string; name: string }>;
  contracts: Array<{ person_id?: string; employer_id?: string }>;
  employments: Array<{ person_id?: string; employer_id?: string }>;
  leave_policies?: LeavePolicyPayload[];
  leave_accounts?: LeaveAccountPayload[];
  leave_records?: LeaveEventPayload[];
  leave_obligations?: LeaveObligationPayload[];
  ledger_recordings?: LedgerRecordingPayload[];
  records: ComplianceRow[];
};
type VerifiedEvidence = { reference: string; status: "verified"; verified_by: string };
type AmendmentBase = { amendment_id: string; person_id: unknown; external_event_id: unknown; external_revision: number; supersedes_revision: number; recorded_at: string; reason: string; evidence: VerifiedEvidence };
export type GrantAmendment = AmendmentBase & { account_id: string; effective_on: string; granted_days: number; statutory_days: number };
export type LeaveAmendment = AmendmentBase & { event_id: string; replacement: Record<string, unknown> | null };
export type AmendmentAnswer = { key: string; revision: number; requires_hr_reconciliation: boolean };
export type GrantAccount = { account_id: string; person_id: string; employer_id: string; granted_on: string; statutory_days: number; grant_cycle_id?: string | null };
export type GrantAssessmentContext = { input_hash: string; source_revision: number; as_of?: string; accounts: GrantAccount[]; findings: Array<{ message?: string }> };
export type GrantAssessmentBody = { payload: Record<string, unknown>; input_hash: string; expected_revision: number };
export type GrantAssessmentReport = { status: string; computed_status?: string; expected_statutory_days: number | null; imported_statutory_days: number; findings: string[]; source: string; guidance?: { version: string; basis_before_revision: boolean; confirmed: boolean | null } };

export function requestsApi(client: Pick<IdealClient, "request">) {
  const request = client.request;
  const scope = (scopeId: string) => encodeURIComponent(scopeId);
  const id = (value: string) => encodeURIComponent(value);
  return {
    /** The viewer's declarations (everyone's for an administrator) and the employers and sites they may name. */
    declarationContext: (scopeId: string) => request<DeclarationContext>(`/compliance/declaration-context?scope_id=${scope(scopeId)}`),
    /** Registers, corrects, withdraws or reviews one declaration against the revision the edit started from. */
    saveDeclaration: (scopeId: string, body: Saved<DeclarationPayload>) => request<DeclarationSaved>(`/compliance/outside-declarations?scope_id=${scope(scopeId)}`, "POST", body),

    /** The viewer's wishes and claims (everyone's for a planner). */
    leaveRequests: (scopeId: string) => request<LeaveRequestRow[]>(`/requests?scope_id=${scope(scopeId)}`),
    submitWish: (scopeId: string, body: WishBody & Keyed) => request<RequestAnswer>(`/requests?scope_id=${scope(scopeId)}`, "POST", body),
    claimPaidLeave: (scopeId: string, body: Saved<PaidLeaveClaim>) => request<RequestAnswer>(`/compliance/leave-requests?scope_id=${scope(scopeId)}`, "POST", body),
    decideRequest: (scopeId: string, requestId: string, body: { version: number; approved: boolean; reference: string } & Keyed) => request<RequestAnswer>(`/requests/${id(requestId)}/decision?scope_id=${scope(scopeId)}`, "POST", body),
    withdrawRequest: (scopeId: string, requestId: string, body: { version: number } & Keyed) => request<RequestAnswer>(`/requests/${id(requestId)}/withdraw?scope_id=${scope(scopeId)}`, "POST", body),
    /** The ledger as the server accounts it now. */
    leaveReport: (scopeId: string) => request<LeaveReport>(`/compliance/leave-report?scope_id=${scope(scopeId)}`),
    /** The ledger on `effectiveAt` (a day) as it was known at `knownAt` (an instant with its offset). */
    leaveReportAsOf: (scopeId: string, effectiveAt: string, knownAt: string) => request<LeaveReport>(`/compliance/leave-report?scope_id=${scope(scopeId)}&effective_at=${id(effectiveAt)}&known_at=${id(knownAt)}`),
    /** The records the viewer may read (their own grants and rules; everything for a planner). */
    records: (scopeId: string) => request<ComplianceRow[]>(`/compliance/records?scope_id=${scope(scopeId)}`),

    /** The ledger's records and the people and employers they name (planners only). */
    ledgerContext: (scopeId: string) => request<LedgerContext>(`/compliance/workflow-context?scope_id=${scope(scopeId)}`),
    saveLeaveAccount: (scopeId: string, body: Saved<LeaveAccountPayload>) => request<RecordSaved>(`/compliance/records/leave_account?scope_id=${scope(scopeId)}`, "POST", body),
    saveLeavePolicy: (scopeId: string, body: Saved<LeavePolicyPayload>) => request<RecordSaved>(`/compliance/records/leave_policy?scope_id=${scope(scopeId)}`, "POST", body),
    saveLeaveObligation: (scopeId: string, body: Saved<LeaveObligationPayload>) => request<RecordSaved>(`/compliance/records/leave_obligation?scope_id=${scope(scopeId)}`, "POST", body),
    saveLedgerRecording: (scopeId: string, body: Saved<LedgerRecordingPayload>) => request<RecordSaved>(`/compliance/records/ledger_recording?scope_id=${scope(scopeId)}`, "POST", body),
    /** Adds one leave event against the revision of its grant (the shared balance). */
    appendLeaveEvent: (scopeId: string, body: Saved<LeaveEventPayload>) => request<{ event_id: string; duplicate: boolean; account_revision: number; requires_hr_reconciliation?: boolean }>(`/compliance/leave-events?scope_id=${scope(scopeId)}`, "POST", body),
    amendGrant: (scopeId: string, body: Saved<GrantAmendment>) => request<AmendmentAnswer>(`/compliance/grant-amendments?scope_id=${scope(scopeId)}`, "POST", body),
    amendLeaveEvent: (scopeId: string, body: Saved<LeaveAmendment>) => request<AmendmentAnswer>(`/compliance/leave-amendments?scope_id=${scope(scopeId)}`, "POST", body),
    grantAssessmentContext: (scopeId: string) => request<GrantAssessmentContext>(`/compliance/grant-assessments/context?scope_id=${scope(scopeId)}`),
    assessGrant: (scopeId: string, body: GrantAssessmentBody & Keyed) => request<GrantAssessmentReport>(`/compliance/grant-assessments?scope_id=${scope(scopeId)}`, "POST", body),
  };
}
