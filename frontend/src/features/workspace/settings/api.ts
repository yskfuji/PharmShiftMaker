// The settings purpose's own calls for the facility's flextime adoption, on the transport
// of the typed client (credentials, 401 handling, error bodies; the server and the showcase
// pass their own). Literal paths, so devtools/er/ia_map.py can map them to their handlers.
import type { IdealClient, Keyed } from "@/ideal/api/client";
import type { RecordEvidence } from "../shared/records/evidence";

/** What the server answers this viewer for one step now, with its own reason when it refuses. */
export type FlexAction = { allowed: boolean; refusal: string | null };
export type FlexStatus = "registered" | "confirmed" | "withdrawn";
export type TimeWindow = { start: string; end: string };
export type FlexFiling = { filed_on: string; office: string; evidence: RecordEvidence };
/** The agreement's terms as registered. The server adds the status and who did what. */
export type AdoptionTerms = {
  adoption_id: string; employer_id: string; establishment_id: string; start: string; end: string; target_scope: string;
  settlement_months: number; settlement_anchor: string; total_hours_rule: "statutory_frame" | "full_two_day_weekend"; agreed_total_description: string;
  rest_weekdays?: number[]; standard_day_seconds: number | null; core_time?: TimeWindow[]; flexible_time?: TimeWindow[];
  work_rules_evidence: RecordEvidence; agreement_evidence: RecordEvidence; filing?: FlexFiling | null; agreement_valid_until?: string;
};
export type AdoptionPayload = AdoptionTerms & {
  status: FlexStatus; created_by: string; created_at: string; reviewed_by?: string; reviewed_at?: string;
  decided_by?: string; decided_at?: string; withdrawal_reason?: string; end_reason?: string;
};
export type EnrollmentRequest = { enrollment_id: string; adoption_id: string; person_id: string; start: string };
export type EnrollmentPayload = EnrollmentRequest & { status: FlexStatus; created_by: string; created_at: string; reviewed_by?: string; decided_by?: string; withdrawal_reason?: string };
/** `settlement_starts`: the days the server accepts from this viewer now, for a new
 * participant's start and for the adoption's end. */
export type AdoptionRow = {
  entity_id: string; revision: number; payload: AdoptionPayload;
  settlement_starts: { participant_start: string[]; end_on: string[] };
  actions: { confirm: FlexAction; withdraw: FlexAction; end: FlexAction; add_participant: FlexAction };
};
export type EnrollmentRow = { entity_id: string; revision: number; payload: EnrollmentPayload; actions: { confirm: FlexAction; withdraw: FlexAction } };
export type FlexSite = { establishment_id: string; employer_id: string; start: string; end: string };
export type FlexListing = {
  viewer: string; can_manage: boolean; manage_refusal: string | null;
  adoptions: AdoptionRow[]; enrollments: EnrollmentRow[]; establishments: FlexSite[]; people: Array<{ person_id: string; name: string }>;
};
/** What confirming an adoption changes and what stops it, with the value that binds a
 * confirmation to exactly this content. */
export type FlexImpact = {
  adoption_id: string; status: string;
  people: Array<{ person_id: string; enrollment_id: string; start: string; status: string; employment_revisions: string[] }>;
  timed_duties: Array<{ scope_id: string; duty_id: string; person_id: string; start: string }>;
  blocking: string[]; next_steps: string[]; impact_hash: string;
};
export type Settlement = {
  kind: "flextime" | "flextime_part"; start: string; end: string; frame_seconds: number; worked_seconds: number;
  monthly_overtime_seconds?: Record<string, number>; final_month_overtime_seconds?: number; unattributed_seconds?: number; settlement_seconds?: number;
};
export type FlexSettlements = { input_hash: string | null; people: Array<{ person_id: string; name: string; settlements: Settlement[] }>; findings: Array<{ status: string; message: string; rule_id: string }> };

export type FlexRegistered = { entity_id: string; revision: number; status: FlexStatus };
export type AdoptionConfirmed = { revision: number; status: FlexStatus; confirmed_enrollments: string[]; enrollments_needing_another_admin: string[] };
export type FlexDecided = { revision: number; status: FlexStatus };
export type AdoptionEnded = FlexDecided & { end: string; withdrawn_enrollments: string[] };

export function settingsApi(client: Pick<IdealClient, "request">) {
  const request = client.request;
  const scope = (scopeId: string) => encodeURIComponent(scopeId);
  const id = (value: string) => encodeURIComponent(value);
  return {
    /** The facility's adoptions and participants, with what this viewer may do with each now. */
    flexAdoptions: (scopeId: string) => request<FlexListing>(`/compliance/flex-adoptions?scope_id=${scope(scopeId)}`),
    /** The settlement of the latest registered input version of the scope. */
    flexSettlements: (scopeId: string) => request<FlexSettlements>(`/compliance/flex-settlements?scope_id=${scope(scopeId)}`),
    /** The settlement of the input version the URL names. */
    flexSettlementsOf: (scopeId: string, inputHash: string) => request<FlexSettlements>(`/compliance/flex-settlements?scope_id=${scope(scopeId)}&input_hash=${id(inputHash)}`),
    flexImpact: (scopeId: string, adoptionId: string) => request<FlexImpact>(`/compliance/flex-adoptions/${id(adoptionId)}/impact?scope_id=${scope(scopeId)}`),
    registerAdoption: (scopeId: string, body: { payload: AdoptionTerms } & Keyed) => request<FlexRegistered>(`/compliance/flex-adoptions?scope_id=${scope(scopeId)}`, "POST", body),
    confirmAdoption: (scopeId: string, adoptionId: string, body: { expected_revision: number; impact_hash: string } & Keyed) => request<AdoptionConfirmed>(`/compliance/flex-adoptions/${id(adoptionId)}/confirm?scope_id=${scope(scopeId)}`, "POST", body),
    withdrawAdoption: (scopeId: string, adoptionId: string, body: { expected_revision: number; reason: string } & Keyed) => request<FlexDecided>(`/compliance/flex-adoptions/${id(adoptionId)}/withdraw?scope_id=${scope(scopeId)}`, "POST", body),
    endAdoption: (scopeId: string, adoptionId: string, body: { expected_revision: number; end_on: string; reason: string } & Keyed) => request<AdoptionEnded>(`/compliance/flex-adoptions/${id(adoptionId)}/end?scope_id=${scope(scopeId)}`, "POST", body),
    registerEnrollment: (scopeId: string, body: { payload: EnrollmentRequest } & Keyed) => request<FlexRegistered>(`/compliance/flex-enrollments?scope_id=${scope(scopeId)}`, "POST", body),
    confirmEnrollment: (scopeId: string, enrollmentId: string, body: { expected_revision: number } & Keyed) => request<FlexDecided>(`/compliance/flex-enrollments/${id(enrollmentId)}/confirm?scope_id=${scope(scopeId)}`, "POST", body),
    withdrawEnrollment: (scopeId: string, enrollmentId: string, body: { expected_revision: number; reason: string } & Keyed) => request<FlexDecided>(`/compliance/flex-enrollments/${id(enrollmentId)}/withdraw?scope_id=${scope(scopeId)}`, "POST", body),
  };
}
