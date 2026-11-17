export type IdealRole = "ADMIN" | "LEADER" | "PHARMACIST";

export type IdealScreen =
  | "home"
  | "schedule"
  | "plan"
  | "operations"
  | "requests"
  | "people"
  | "governance"
  | "settings";

export type ShowcaseState =
  | "ready"
  | "empty"
  | "loading"
  | "failure"
  | "conflict"
  | "forbidden";

export interface PlanningScopeSummary {
  scope_id: string;
  display_name: string;
  person_id: string;
  role: IdealRole;
  input_revision: number;
}

export interface MembershipRevision {
  membership_id: string;
  issuer: string;
  subject: string;
  person_id: string;
  scope_id: string;
  role: IdealRole;
  active: boolean;
  revision: number;
  evidence: Record<string, unknown>;
  created_by: string;
  created_at: string;
  deactivated_at: string | null;
}

export interface ScheduleChangeCase {
  case_id: string;
  scope_id: string;
  publication_id: string;
  kind: "ABSENCE" | "SWAP";
  status: string;
  version: number;
  affected_assignments: Record<string, unknown>[];
  proposed_assignments: Record<string, unknown>[];
  validation: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
  approval_action?: "RECOMMEND" | "APPROVE" | null;
  can_reject?: boolean;
}

export interface ScheduleChangeApprovalResult {
  publication_id: string;
  version: number;
  input_hash: string;
  case_id: string;
  case_version: number;
}

export interface LifecycleCase {
  case_id: string;
  scope_id: string;
  person_id: string;
  kind: "ONBOARD" | "OFFBOARD";
  status: string;
  effective_date: string;
  version: number;
  tasks: LifecycleTaskState[];
  evidence: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface LifecycleTaskState {
  key: string;
  source: "SYSTEM" | "ATTESTATION";
  status: "NOT_STARTED" | "COMPLETED";
  completed_at: string | null;
  satisfied_by?: string[];
  can_complete?: boolean;
  blocked_reason?: string | null;
}

export interface PersonalScheduleExport {
  person_id: string;
  publication_id: string;
  format: "PRINT_HTML" | "ICALENDAR";
  period_start: string;
  period_end: string;
  assignment_count: number;
}

export interface ScopeSettingChange {
  revision: number;
  enabled: boolean;
  reason: string;
  reference: string;
  actor: string;
  at: string;
}

export interface AbsenceConsentSetting {
  enabled: boolean;
  revision: number;
  history: ScopeSettingChange[] | null;
}

export interface ScopeSettings {
  scope_id: string;
  absence_replacement_consent: AbsenceConsentSetting;
}

export interface OptionCounterpart {
  person_id: string;
  display_name: string | null;
}

export interface OptionDuty {
  start: string;
  end: string;
  kind: string;
  task: string;
  location: string;
}

export interface ChangeOption {
  option_id: string;
  affected_assignment_ids: string[];
  proposed_assignment_ids: string[];
  counterpart: OptionCounterpart;
  duty: OptionDuty;
  publishable: boolean;
  finding_count: number | null;
}

export interface ChangeOptions {
  publication_id: string;
  publication_version: number;
  duty_id: string;
  kind: "ABSENCE" | "SWAP";
  consent_required: boolean;
  options: ChangeOption[];
}

export interface FindingCounts {
  violation: number;
  unverified: number;
  unsupported: number;
}

export interface SolverRecord {
  job_id: string;
  status: string;
  random_seed: number;
  objective_by_level: number[];
  proven_levels: number;
}

export interface PlanFigures {
  draft_id: string;
  findings: FindingCounts;
  publishable: boolean;
  changes_from_previous: number | null;
  changes_from_publication: number | null;
  preference_cost: number;
  preferences_met: number;
  preferences_total: number;
  work_seconds_total: number;
  work_seconds_spread: number;
  assignment_count: number;
  proposal_hash: string;
  duplicate_of: string | null;
  solver: SolverRecord | null;
}

export interface PlanPair {
  a: string;
  b: string;
  differing_duties: number;
  affected_people: number;
}

export interface PlanComparison {
  input_hash: string;
  plans: PlanFigures[];
  pairs: PlanPair[];
  order: string[];
  order_rule: string;
  meaning: string;
}

export interface AuditEntry {
  at: string;
  kind: string;
  category: string;
  actor_role: IdealRole | null;
  subject_count: number | null;
  version: number | null;
}

export interface AuditTimelinePage {
  entries: AuditEntry[];
  next_cursor: string | null;
  sources: string[];
  limits: string[];
}

export interface PublicationSummary {
  publication_id: string;
  version: number;
  period: string;
  input_hash: string;
  created_at: string;
}

export interface ScheduleAssignmentChange {
  duty_id: string;
  kind: "ADDED" | "REMOVED" | "CHANGED";
}

export interface ScheduleCalendarView {
  scope_id: string;
  requested_period: string | null;
  visibility: "department" | "self";
  publication: PublicationSummary | null;
  previous_publication: PublicationSummary | null;
  assignments: Record<string, unknown>[];
  changes: ScheduleAssignmentChange[];
  can_export_department: boolean;
  limitations: string[];
}

export interface DailyOperationsSnapshot {
  scope_id: string;
  day: string;
  observed_at: string;
  visibility: "department" | "self";
  scheduled_assignments: Record<string, unknown>[];
  scheduled_count: number;
  open_case_count: number;
  absence_case_count: number;
  coverage_finding_count: number;
  undelivered_notification_count: number;
  limitations: string[];
}

export interface ScheduleStabilitySummary {
  scope_id: string;
  observed_at: string;
  window_days: number;
  publication_count: number;
  change_event_count: number;
  days: StabilityDay[];
  meaning: string;
}

export interface StabilityDay {
  day: string;
  change_count: number;
}

export interface DashboardMetric {
  value: number | null;
  state: "available" | "unknown";
  reason: string | null;
}

export interface DashboardSource {
  kind: string;
  id: string;
  version: number;
  input_hash?: string | null;
}

export interface DashboardSummary {
  scope_id: string;
  period: string;
  role: string;
  visibility: "department" | "self";
  observed_at: string;
  sources: DashboardSource[];
  metrics: Record<string, DashboardMetric>;
}

export interface WorkspaceNotification {
  event_id: string;
  kind: string;
  category: "schedule" | "change" | "lifecycle";
  publication_id: string | null;
  version: number | null;
  created_at: string;
  read: boolean;
}
