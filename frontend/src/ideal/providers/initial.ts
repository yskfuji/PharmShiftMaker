import type { PublicationRead } from "../api/contracts";
import type {
  DailyOperationsSnapshot,
  DashboardSummary,
  PlanningScopeSummary,
  ScheduleCalendarView,
  ScheduleStabilitySummary,
  WorkspaceNotification,
} from "../types";

/** Serializable result of the authenticated Server Component read. */
export type InitialWorkspacePayload = {
  observedAt: string;
  requestedPeriod: string;
  selectedPublicationId: string | null;
  selectedCaseId: string | null;
  selectedPersonId: string | null;
  viewerName: string;
  scopes: PlanningScopeSummary[];
  scope: PlanningScopeSummary | null;
  selectionRequired: boolean;
  problem: { status: number; detail: string } | null;
  publications: PublicationRead[];
  names: Record<string, string>;
  calendar: ScheduleCalendarView | null;
  dashboard: DashboardSummary | null;
  daily: DailyOperationsSnapshot | null;
  stability: ScheduleStabilitySummary | null;
  notifications: WorkspaceNotification[];
  partialProblems: Array<{ resource: string; status: number; detail: string }>;
};
