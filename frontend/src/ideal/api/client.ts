// Access to the planning API for the ideal screens, on the existing transport (credentials,
// 401 handling, error bodies). Every mutation carries the caller's idempotency key (see
// mutations.ts); the server decides permissions and validity, never this client.
import { createPlanningTransport } from "@/lib/planningTransport";
import type {
  AuditTimelinePage,
  ChangeOptions,
  DailyOperationsSnapshot,
  DashboardSummary,
  LifecycleCase,
  MembershipRevision,
  PlanComparison,
  PlanningScopeSummary,
  ScheduleChangeApprovalResult,
  ScheduleChangeCase,
  ScheduleCalendarView,
  ScheduleStabilitySummary,
  ScopeSettings,
  WorkspaceNotification,
} from "../types";
import type { PublicationRead } from "./contracts";
import { scopePersonNames } from "./workspaceSelection";

export type Evidence = { reason: string; reference: string };
export type Keyed = { idempotency_key: string };
export type Job = { job_id: string; status: string; input_hash?: string; result?: { draft_id?: string; diagnostics?: string[]; random_seed?: number } | null };
export type Draft = { draft_id: string; input_hash: string; version: number; review_hash: string | null; status: string; proposal: { duty_ids: string[]; leave_ids?: string[] } };
export type InputLatest = { input_hash: string; input_revision: number; publication_version: number; stale: boolean; snapshot: {
  people: { person_id: string; name: string }[];
  candidates?: Array<{ duty_id: string; person_id: string; kind: string; task: string; location: string; start: string; end: string }>;
  contracts?: unknown[];
  capabilities?: unknown[];
  demands?: unknown[];
  period: { start: string; end: string };
} };
type InputPeriod = { input_hash: string };
type ComplianceRecord = { kind: string; entity_id: string; payload: Record<string, unknown> };

export function createIdealClient(identity: string) {
  const request = createPlanningTransport(identity);
  // Literal paths, so devtools/er/ia_map.py can map these screens to their endpoints.
  const scope = (scopeId: string) => encodeURIComponent(scopeId);
  const id = (value: string) => encodeURIComponent(value);
  return {
    request,
    scopes: () => request<PlanningScopeSummary[]>("/scopes"),
    publications: (scopeId: string) => request<PublicationRead[]>(`/publications?scope_id=${scope(scopeId)}`),
    scheduleCalendar: (scopeId: string, period: string) => request<ScheduleCalendarView>(`/schedule-calendar?scope_id=${scope(scopeId)}&period=${id(period)}`),
    dashboard: (scopeId: string, period: string) => request<DashboardSummary>(`/dashboard?scope_id=${scope(scopeId)}&period=${id(period)}`),
    dailyOperations: (scopeId: string, day: string) => request<DailyOperationsSnapshot>(`/daily-operations?scope_id=${scope(scopeId)}&day=${id(day)}`),
    stability: (scopeId: string) => request<ScheduleStabilitySummary>(`/schedule-stability?scope_id=${scope(scopeId)}`),
    notifications: (scopeId: string) => request<WorkspaceNotification[]>(`/notifications?scope_id=${scope(scopeId)}`),
    markNotificationRead: (scopeId: string, eventId: string) => request<{ read: boolean }>(`/notifications/${id(eventId)}/read?scope_id=${scope(scopeId)}`, "POST"),
    inputLatest: (scopeId: string) => request<InputLatest>(`/inputs/latest?scope_id=${scope(scopeId)}`),
    /** Names of the scope's people (planners only: the server requires planning permission). */
    people: async (scopeId: string) => {
      const input = await request<InputLatest>(`/inputs/latest?scope_id=${scope(scopeId)}`);
      return Object.fromEntries(input.snapshot.people.map((p) => [p.person_id, p.name])) as Record<string, string>;
    },
    /** Exact roster accepted by the server for person-scoped workflows. */
    scopePeople: async (scopeId: string) => {
      const [periods, records] = await Promise.all([
        request<InputPeriod[]>(`/inputs?scope_id=${scope(scopeId)}`),
        request<ComplianceRecord[]>(`/compliance/records?scope_id=${scope(scopeId)}`),
      ]);
      const hashes = Array.from(new Set(periods.map((item) => item.input_hash)));
      const inputs = await Promise.all(hashes.map((inputHash) =>
        request<InputLatest>(`/inputs/latest?scope_id=${scope(scopeId)}&input_hash=${id(inputHash)}`)));
      return scopePersonNames(inputs, records);
    },
    /** Privacy-purpose roster. The server permits it while ordinary planning reads are restricted. */
    privacyPeople: async (scopeId: string) => {
      const result = await request<{ people: Array<{ person_id: string; name: string }> }>(
        `/compliance/privacy?scope_id=${scope(scopeId)}`,
      );
      return Object.fromEntries(result.people.map((person) => [person.person_id, person.name]));
    },
    personalExportUrl: (base: string, scopeId: string, publicationId: string, format: "print" | "ical") =>
      `${base}/planning/personal-schedule/${encodeURIComponent(publicationId)}/content?scope_id=${encodeURIComponent(scopeId)}&format=${format}`,

    // Change cases (absence and exchange)
    changeCases: (scopeId: string) => request<ScheduleChangeCase[]>(`/change-cases?scope_id=${scope(scopeId)}`),
    changeOptions: (scopeId: string, publicationId: string, dutyId: string, kind: "ABSENCE" | "SWAP") =>
      request<ChangeOptions>(`/change-cases/options?scope_id=${scope(scopeId)}&publication_id=${id(publicationId)}&duty_id=${id(dutyId)}&kind=${kind}`),
    createCase: (scopeId: string, body: { publication_id: string; kind: "ABSENCE" | "SWAP"; affected_assignment_ids: string[]; proposed_assignment_ids: string[]; evidence: Evidence } & Keyed) =>
      request<ScheduleChangeCase>(`/change-cases?scope_id=${scope(scopeId)}`, "POST", body),
    consent: (scopeId: string, caseId: string, body: { expected_version: number; evidence: Evidence } & Keyed) =>
      request<ScheduleChangeCase>(`/change-cases/${id(caseId)}/consent?scope_id=${scope(scopeId)}`, "POST", body),
    decline: (scopeId: string, caseId: string, body: { expected_version: number; evidence: Evidence } & Keyed) =>
      request<ScheduleChangeCase>(`/change-cases/${id(caseId)}/decline?scope_id=${scope(scopeId)}`, "POST", body),
    withdraw: (scopeId: string, caseId: string, body: { expected_version: number; evidence: Evidence } & Keyed) =>
      request<ScheduleChangeCase>(`/change-cases/${id(caseId)}/withdraw?scope_id=${scope(scopeId)}`, "POST", body),
    approve: (scopeId: string, caseId: string, body: { expected_version: number; expected_publication_version: number; evidence: Evidence } & Keyed) =>
      request<ScheduleChangeApprovalResult>(`/change-cases/${id(caseId)}/approve?scope_id=${scope(scopeId)}`, "POST", body),
    recommend: (scopeId: string, caseId: string, body: { expected_version: number; evidence: Evidence } & Keyed) =>
      request<ScheduleChangeCase>(`/change-cases/${id(caseId)}/recommend?scope_id=${scope(scopeId)}`, "POST", body),
    reject: (scopeId: string, caseId: string, body: { expected_version: number; evidence: Evidence } & Keyed) =>
      request<ScheduleChangeCase>(`/change-cases/${id(caseId)}/reject?scope_id=${scope(scopeId)}`, "POST", body),

    // Settings
    scopeSettings: (scopeId: string) => request<ScopeSettings>(`/scope-settings?scope_id=${scope(scopeId)}`),
    setAbsenceConsent: (scopeId: string, body: { enabled: boolean; expected_version: number; evidence: Evidence } & Keyed) =>
      request<ScopeSettings>(`/scope-settings/absence-consent?scope_id=${scope(scopeId)}`, "POST", body),

    // People: accounts and onboarding/offboarding
    memberships: (scopeId: string, includeInactive: boolean) =>
      request<MembershipRevision[]>(`/memberships?scope_id=${scope(scopeId)}&include_inactive=${includeInactive}`),
    linkMembership: (scopeId: string, body: { issuer: string; subject: string; person_id: string; role: "ADMIN" | "LEADER" | "PHARMACIST"; expected_version: number; evidence: Evidence } & Keyed) =>
      request<MembershipRevision>(`/memberships?scope_id=${scope(scopeId)}`, "POST", body),
    deactivateMembership: (scopeId: string, membershipId: string, body: { expected_version: number; evidence: Evidence } & Keyed) =>
      request<MembershipRevision>(`/memberships/${id(membershipId)}/deactivate?scope_id=${scope(scopeId)}`, "POST", body),
    lifecycleCases: (scopeId: string) => request<LifecycleCase[]>(`/lifecycle-cases?scope_id=${scope(scopeId)}`),
    createLifecycle: (scopeId: string, body: { person_id: string; kind: "ONBOARD" | "OFFBOARD"; effective_date: string; evidence: Evidence } & Keyed) =>
      request<LifecycleCase>(`/lifecycle-cases?scope_id=${scope(scopeId)}`, "POST", body),
    completeTask: (scopeId: string, caseId: string, body: { task_key: string; expected_version: number; evidence: Evidence } & Keyed) =>
      request<LifecycleCase>(`/lifecycle-cases/${id(caseId)}/tasks?scope_id=${scope(scopeId)}`, "POST", body),
    attestTask: (scopeId: string, caseId: string, taskKey: string, body: { expected_version: number; evidence: Evidence } & Keyed) =>
      request<LifecycleCase>(`/lifecycle-cases/${id(caseId)}/tasks/${id(taskKey)}/attest?scope_id=${scope(scopeId)}`, "POST", body),

    // Governance
    timeline: (scopeId: string, before: string | null, category: string | null) =>
      request<AuditTimelinePage>(`/audit-timeline?scope_id=${scope(scopeId)}&limit=20${before ? `&before=${id(before)}` : ""}${category ? `&category=${category}` : ""}`),

    // Planning studio
    refreshInput: (scopeId: string, expectedRevision: number) =>
      request<{ input_hash: string }>(`/inputs/refresh?scope_id=${scope(scopeId)}`, "POST", { expected_revision: expectedRevision }),
    enqueueJob: (scopeId: string, body: { input_hash: string; random_seed: number; budget_seconds: number } & Keyed) =>
      request<Job>(`/jobs?scope_id=${scope(scopeId)}`, "POST", body),
    job: (scopeId: string, jobId: string) => request<Job>(`/jobs/${id(jobId)}?scope_id=${scope(scopeId)}`),
    cancelJob: (scopeId: string, jobId: string, body: Keyed) => request<Job>(`/jobs/${id(jobId)}/cancel?scope_id=${scope(scopeId)}`, "POST", body),
    jobByKey: (scopeId: string, key: string) => request<Job>(`/jobs/by-key?scope_id=${scope(scopeId)}&idempotency_key=${id(key)}`),
    draft: (scopeId: string, draftId: string) => request<Draft>(`/drafts/${id(draftId)}?scope_id=${scope(scopeId)}`),
    updateDraft: (scopeId: string, draftId: string, body: { version: number; proposal: { duty_ids: string[]; leave_ids?: string[] } } & Keyed) =>
      request<Draft>(`/drafts/${id(draftId)}?scope_id=${scope(scopeId)}`, "PUT", body),
    comparison: (scopeId: string, inputHash: string, draftIds: string[]) =>
      request<PlanComparison>(`/plan-comparison?scope_id=${scope(scopeId)}&input_hash=${id(inputHash)}${draftIds.map((d) => `&draft_ids=${id(d)}`).join("")}`),
    review: (scopeId: string, draftId: string, body: { version: number } & Keyed) =>
      request<{ findings: unknown[]; publishable: boolean; review_hash: string | null }>(`/drafts/${id(draftId)}/review?scope_id=${scope(scopeId)}`, "POST", body),
    publish: (scopeId: string, draftId: string, body: { version: number; expected_publication_version: number; input_hash: string; review_hash: string } & Keyed) =>
      request<{ publication_id: string; version: number }>(`/drafts/${id(draftId)}/publish?scope_id=${scope(scopeId)}`, "POST", body),
    deriveCandidates: (scopeId: string, body: { expected_version: number; evidence: Evidence } & Keyed) =>
      request<{ input_hash: string }>(`/candidates/derive?scope_id=${scope(scopeId)}`, "POST", body),
    registerInput: (scopeId: string, body: { snapshot: unknown; expected_revision: number }) =>
      request<{ input_hash: string }>(`/inputs?scope_id=${scope(scopeId)}`, "POST", body),
    cancelPublication: (scopeId: string, publicationId: string, body: { expected_version: number; reason: string } & Keyed) =>
      request<{ publication_id: string; version: number }>(`/publications/${id(publicationId)}/cancel?scope_id=${scope(scopeId)}`, "POST", body),
  };
}

export type IdealClient = ReturnType<typeof createIdealClient>;
