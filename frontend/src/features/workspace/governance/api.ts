// The governance purpose's own calls for actual work and for personal-data requests,
// retention, holds and erasure, on the transport of the typed client (credentials, 401
// handling, error bodies; the server and the showcase pass their own).
// Literal paths, so devtools/er/ia_map.py can map them to their handlers.
import type { IdealClient, Keyed } from "@/ideal/api/client";

export type Piece = { start: string; end: string };
/** A duty as the server stores it. Fields this purpose does not edit are sent back as read. */
export type ActualDuty = Piece & { duty_id: string; person_id: string; relationship_id: string; kind: string; task: string; location: string; work: Piece[]; breaks: Piece[]; source: string } & Record<string, unknown>;
/** `reviewed`: a reconciliation note exists for the revision listed here (the current one). */
export type ActualRow = { external_id: string; revision: number; reviewed: boolean; duty: ActualDuty };
/** Which employment revisions an actual is counted under, and its scheduled hours. */
export type WorkTerms = { duty_id: string; employment_revision_id: string; employment_revision_ids?: string[]; scheduled_work: Piece[]; planned_publication_id?: string | null; planned_duty_id?: string | null };
/** `working_time_system`: the working-time system the employment revision is registered with. */
export type EmploymentRevision = { revision_id: string; relationship_id: string; person_id: string; start: string; end: string; working_time_system?: string };
export type DutyOption = { kind: string; task: string; location: string };
export type PublishedPlan = { publication_id: string; version: number; period: string; assignments: ActualDuty[] };
/** What this purpose reads of the workflow context. The endpoint returns more (contracts,
 * the leave ledger, demands, …); nothing else of it is used or kept. */
export type ActualsContext = {
  role: string;
  can_correct_actuals: boolean;
  people: Array<{ person_id: string; name: string }>;
  employments: EmploymentRevision[];
  duty_options?: DutyOption[];
  publications: PublishedPlan[];
  actuals: ActualRow[];
  records: Array<{ kind: string; entity_id: string; revision: number; payload: Record<string, unknown> }>;
};

export type ImportPreviewRow = { row: number; external_id: string; expected_revision: number; expected_work_terms_revision: number; person_id: string; start: string; end: string };
export type ImportPreview = { source_hash: string; preview_hash: string; rows: ImportPreviewRow[] };
export type ImportCommitBody = { expected_revision: 0; payload: { source_text: string; preview_hash: string } };
export type ImportCommitted = { source_hash: string; count: number };
export type ActualSaveBody = { expected_revision: number; payload: { external_id: string; revision: number; duty: ActualDuty; work_terms: WorkTerms; expected_work_terms_revision: number } };
export type ActualSaved = { event_id: string; duplicate: boolean };
export type ActualReviewBody = { expected_revision: number; payload: { external_id: string; reason: string } };
export type ActualReviewed = { event_id: string; revision: number; reviewed: boolean };

// --- Personal-data requests, retention rules, holds, person control and erasure ---
export type Named = { person_id: string; name: string };
/** The evidence a privacy record carries (no expiry is entered on these screens). */
export type Proof = { reference: string; status: string; verified_by: string | null };
export type CaseDecision = { expected_revision: number; status: string; reason: string; result_reference: string | null; identity_evidence: Proof };
/** `allowed_next`: the statuses the decision route accepts next for this viewer (none for a
 * viewer who may not decide, and none once the request is closed). `result_reference_required`:
 * those of them the server refuses without a result reference. */
export type PrivacyCase = {
  case_id: string; revision: number; status: string;
  payload: { person_id: string; kind: string; reason: string; decision_history?: CaseDecision[] };
  allowed_next: string[]; result_reference_required: string[];
};
export type RetentionPolicy = { category: string; purpose: string; anchor: string; retention_days: number; legal_minimum_days: number; effective_from: string; effective_until: string; owner: string; next_review: string; evidence: Proof };
export type RetentionRule = { key: string; revision: number; payload: RetentionPolicy };
export type LegalHold = { hold_id: string; revision: number; active: boolean; person_id: string | null; payload: { reason?: string } };
/** Rules and holds are given to administrators only; a pharmacist is given their own requests and name. */
export type PrivacyListing = { cases: PrivacyCase[]; rules: RetentionRule[]; holds: LegalHold[]; people: Named[] };
export type PrivacyRequestBody = { expected_revision: 0; payload: { person_id: string; kind: string; reason: string } };
export type CaseSaved = { case_id: string; revision: number; status: string };
export type CaseDecisionBody = { expected_revision: number; payload: CaseDecision };
export type RetentionRuleBody = { expected_revision: number; payload: RetentionPolicy };
export type RuleSaved = { key: string; revision: number };
export type HoldBody = { expected_revision: number; payload: { hold_id?: string; person_id: string | null; active: boolean; reason: string } };
export type HoldSaved = { hold_id: string; revision: number };

/** One registered copy of a person's data as the server lists it. `blockers`: the server's
 * reasons it stays (codes); none when the server would process it. */
/** `will_process`: the server's own statement that executing would act on this copy now
 * (erase the database record, queue the file). Absent in an answer from before the server
 * stated it. */
export type CopyTarget = { copy_id: string; revision: number; medium: string; state: string; blockers: string[]; expires_at: string | null; preservation?: { payload_hash: string }; will_process?: boolean };
export type ControlRecord = { table: string; object: string; subject_relation: string; purpose: string; retention_status: string; reason: string };
export type CopyInventory = { person_id: string; targets: CopyTarget[]; unverified_copies: string[]; database_records_remaining: string[]; database_inventory?: { control_records_remaining?: ControlRecord[] } };
/** `state`, `revision` and `applicable_cases` (the decisions the control route accepts now)
 * are the server's; nothing about them is worked out here. */
export type SubjectControl = { person_id: string; revision: number; state: string; all_copies_erased: boolean; identity_boundary: string; inventory: CopyInventory; applicable_cases: Array<{ case_id: string; revision: number; reason: string }> };
export type SubjectControlBody = { expected_revision: number; case_id: string; case_revision: number; reason: string };
export type SubjectControlApplied = { person_id: string; revision: number; state: string; all_copies_erased: boolean; case_id: string };
/** `targets`: per copy of the plan, whether executing it would act on the copy. */
export type SubjectPlan = { plan_id: string; fingerprint: string; revision: number; all_copies_erased: boolean; targets?: Array<{ copy_id: string; will_process: boolean }> };
export type SubjectExecuteBody = { expected_revision: number; plan_id: string; plan_revision: number; fingerprint: string };
export type SubjectExecuted = { plan_id: string; revision: number; state: string; queued_count: number; erased_database_count: number; preserved_archive_count: number; all_copies_erased: boolean };
export type JointParticipant = { person_id: string; case_id: string; case_revision: number; case_reason?: string; case_hash: string; control_hash: string };
export type JointReview = { copy_id: string; revision: number; source_hash: string; context_hash: string; context: { owners: string[]; participants: JointParticipant[]; policy_key: string; policy_revision: number; policy_hash: string; policy_purpose?: string } };
export type JointReviewBody = { expected_revision: number; source_hash: string; context_hash: string; shared_text_reviewed: true; reason: string; evidence: Proof };
export type BackfillPreview = { preview_hash: string; changes: Array<{ copy_id: string; revision: number; additional_person_ids: string[] }>; unresolved_copy_ids: string[] };
export type BackfillApplied = { updated_copies: number; unresolved_copy_ids: string[]; subject_reviews_required: boolean };
export type CopyPreview = CopyInventory & { plan_id: string; fingerprint: string; revision: number };
export type CopiesExecuted = { plan_id: string; revision: number; state: string; queued_copy_ids: string[]; erased_database_copy_ids: string[]; preserved_archive_ids: string[]; all_copies_complete: boolean };
export type ExternalConfirmBody = { expected_revision: number; payload: { copy_id: string; evidence: Proof } };
export type ExternalConfirmed = { copy_id: string; revision: number; state: string; confirmation: { local_physical_erasure_verified: boolean }; all_copies_complete: boolean };
export type CopyRegistrationBody = { expected_revision: 0; payload: { copy_id: string; category: "exports"; medium: "external"; relative_path: string; content_hash: string; person_ids: string[]; anchor: string; anchor_at: string; subject_status: "VERIFIED" | "UNVERIFIED"; evidence: Proof } };
export type CopyRegistered = { copy_id: string; revision: number };
export type Projection = { copy_id: string; revision: number; source_digest: string; payload_hash: string; person_ids: string[]; payload: { retained: Record<string, unknown>; removed_counts: Record<string, number> } };
export type PreservationBody = { expected_revision: number; payload: { copy_id: string; person_id: string; content_hash: string; projection_hash: string; shared_text_reviewed: true; evidence: Proof } };
export type PreservationReviewed = { copy_id: string; revision: number; projection_hash: string };

/** One planning input with the server's answer on erasing it now. */
export type ErasureCandidate = { input_hash: string; input_revision: number; period: { start: string; end: string }; registered_at: string; erasable: boolean; blockers: string[]; target_count: number };
export type ErasureCandidates = { observed_at: string; inputs: ErasureCandidate[] };
export type InputErasurePlan = { plan_id: string; fingerprint: string; erasable: boolean; input_hash: string; rule_key: string | null; targets: Array<{ table: string; key: string; hash: string }>; blockers: string[]; irreversible: boolean; limitations: string[] };
export type InputErased = { plan_id: string; status: string; deleted?: number; duplicate: boolean };

export function governanceApi(client: Pick<IdealClient, "request">) {
  const request = client.request;
  const scope = (scopeId: string) => encodeURIComponent(scopeId);
  const id = (value: string) => encodeURIComponent(value);
  return {
    /** The actuals, the published duties and the employment revisions of the scope (planners only). */
    actualsContext: (scopeId: string) => request<ActualsContext>(`/compliance/workflow-context?scope_id=${scope(scopeId)}`),
    /** Checks a source file against the stored actuals; nothing is saved. */
    previewActualImport: (scopeId: string, body: { source_text: string }) => request<ImportPreview>(`/compliance/actual-import/preview?scope_id=${scope(scopeId)}`, "POST", body),
    /** Saves every row of the checked file, or none. */
    commitActualImport: (scopeId: string, body: ImportCommitBody & Keyed) => request<ImportCommitted>(`/compliance/actual-import/commit?scope_id=${scope(scopeId)}`, "POST", body),
    /** Saves one actual and its scheduled hours against the revisions the edit started from. */
    saveActual: (scopeId: string, body: ActualSaveBody & Keyed) => request<ActualSaved>(`/compliance/actual-events?scope_id=${scope(scopeId)}`, "POST", body),
    /** Records a reconciliation note against the current revision of one actual. */
    reviewActual: (scopeId: string, body: ActualReviewBody & Keyed) => request<ActualReviewed>(`/compliance/actual-reviews?scope_id=${scope(scopeId)}`, "POST", body),

    /** The requests, and for an administrator the retention rules, the holds and the scope's people. */
    privacy: (scopeId: string) => request<PrivacyListing>(`/compliance/privacy?scope_id=${scope(scopeId)}`),
    /** Files one request (a person for themselves; an administrator for anyone of the scope). */
    filePrivacyRequest: (scopeId: string, body: PrivacyRequestBody & Keyed) => request<CaseSaved>(`/compliance/privacy/requests?scope_id=${scope(scopeId)}`, "POST", body),
    /** Records the next decision on a request against the revision it was read at. */
    decidePrivacyCase: (scopeId: string, caseId: string, body: CaseDecisionBody & Keyed) => request<CaseSaved>(`/compliance/privacy/cases/${id(caseId)}?scope_id=${scope(scopeId)}`, "POST", body),
    /** Adds the next revision of one retention rule (a data kind and an anchor). */
    saveRetentionRule: (scopeId: string, body: RetentionRuleBody & Keyed) => request<RuleSaved>(`/compliance/retention-rules?scope_id=${scope(scopeId)}`, "POST", body),
    /** Records or releases a legal hold. */
    saveHold: (scopeId: string, body: HoldBody & Keyed) => request<HoldSaved>(`/compliance/holds?scope_id=${scope(scopeId)}`, "POST", body),
    /** The person control of one person: its state, what remains and the decisions it accepts. */
    subjectControl: (scopeId: string, personId: string) => request<SubjectControl>(`/compliance/subject-controls/${id(personId)}?scope_id=${scope(scopeId)}`),
    /** Applies the person control from an approved erasure decision. It cannot be undone. */
    applySubjectControl: (scopeId: string, personId: string, body: SubjectControlBody & Keyed) => request<SubjectControlApplied>(`/compliance/subject-controls/${id(personId)}?scope_id=${scope(scopeId)}`, "POST", body),
    /** Records the copies as they are now as a plan; nothing is erased. */
    planSubjectErasure: (scopeId: string, personId: string, body: { expected_revision: number } & Keyed) => request<SubjectPlan>(`/compliance/subject-controls/${id(personId)}/plans?scope_id=${scope(scopeId)}`, "POST", body),
    /** Erases what the plan found erasable. It cannot be undone. */
    executeSubjectErasure: (scopeId: string, personId: string, body: SubjectExecuteBody & Keyed) => request<SubjectExecuted>(`/compliance/subject-controls/${id(personId)}/execute?scope_id=${scope(scopeId)}`, "POST", body),
    /** Every owner of one shared copy with their current decision. */
    jointReview: (scopeId: string, copyId: string) => request<JointReview>(`/compliance/copies/${id(copyId)}/joint-review?scope_id=${scope(scopeId)}`),
    saveJointReview: (scopeId: string, copyId: string, body: JointReviewBody & Keyed) => request<Record<string, unknown>>(`/compliance/copies/${id(copyId)}/joint-review?scope_id=${scope(scopeId)}`, "POST", body),
    /** The person references that the account links would add to existing records. */
    backfillCandidates: (scopeId: string) => request<BackfillPreview>(`/compliance/copies/account-backfill?scope_id=${scope(scopeId)}`),
    applyBackfill: (scopeId: string, body: { expected_revision: 0; payload: { preview_hash: string } } & Keyed) => request<BackfillApplied>(`/compliance/copies/account-backfill?scope_id=${scope(scopeId)}`, "POST", body),
    /** The copies of one person as they are now; nothing is recorded. */
    copyInventory: (scopeId: string, personId: string) => request<CopyInventory>(`/compliance/copies?scope_id=${scope(scopeId)}&person_id=${id(personId)}`),
    /** Records the copies of one person as they are now as a plan; nothing is erased. */
    previewCopies: (scopeId: string, body: { expected_revision: 0; payload: { person_id: string } } & Keyed) => request<CopyPreview>(`/compliance/copies/preview?scope_id=${scope(scopeId)}`, "POST", body),
    /** Erases what the plan found erasable. It cannot be undone. */
    executeCopies: (scopeId: string, body: { expected_revision: number; payload: { plan_id: string; fingerprint: string } } & Keyed) => request<CopiesExecuted>(`/compliance/copies/execute?scope_id=${scope(scopeId)}`, "POST", body),
    /** Records an outside custodian's confirmation. It cannot be undone. */
    confirmExternalCopy: (scopeId: string, body: ExternalConfirmBody & Keyed) => request<ExternalConfirmed>(`/compliance/copies/confirm-external?scope_id=${scope(scopeId)}`, "POST", body),
    /** Registers a copy handed to somebody outside, by its hash; the file itself is never sent. */
    registerCopy: (scopeId: string, body: CopyRegistrationBody & Keyed) => request<CopyRegistered>(`/compliance/copies/register?scope_id=${scope(scopeId)}`, "POST", body),
    /** What a shared record would keep of the other people once one person is removed. */
    copyProjection: (scopeId: string, copyId: string, personId: string) => request<Projection>(`/compliance/copies/${id(copyId)}/projection?scope_id=${scope(scopeId)}&person_id=${id(personId)}`),
    reviewPreservation: (scopeId: string, body: PreservationBody & Keyed) => request<PreservationReviewed>(`/compliance/copies/review-preservation?scope_id=${scope(scopeId)}`, "POST", body),
    /** Every planning input of the scope with the server's answer on erasing it now. */
    erasureCandidates: (scopeId: string) => request<ErasureCandidates>(`/compliance/erasure-candidates?scope_id=${scope(scopeId)}`),
    /** Records what erasing one input would erase as a plan; nothing is erased. */
    previewInputErasure: (scopeId: string, body: { expected_revision: 0; payload: { input_hash: string } } & Keyed) => request<InputErasurePlan>(`/compliance/erasure-preview?scope_id=${scope(scopeId)}`, "POST", body),
    /** Erases the input and what refers to it. It cannot be undone. */
    executeInputErasure: (scopeId: string, body: { expected_revision: 0; payload: { plan_id: string; fingerprint: string } } & Keyed) => request<InputErased>(`/compliance/erasure-execute?scope_id=${scope(scopeId)}`, "POST", body),
  };
}
