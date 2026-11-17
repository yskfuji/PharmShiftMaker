import { getAuthToken } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/apiTarget";
import { ensureHttpsDispatcher } from "@/lib/httpsDispatcher";
import { parseIdentity } from "@/lib/identity";
import type { InitialWorkspacePayload } from "../providers/initial";
import type {
  DailyOperationsSnapshot,
  DashboardSummary,
  PlanningScopeSummary,
  ScheduleCalendarView,
  ScheduleStabilitySummary,
  WorkspaceNotification,
} from "../types";
import type { InputLatest } from "./client";
import type { PublicationRead } from "./contracts";
import type { IdealScreen } from "../types";
import { monthInTokyo, resolvePersonSelection, resolveWorkspaceSelection, scopePersonNames, WorkspaceSelectionError, type WorkspaceSelection } from "./workspaceSelection";

type InputPeriod = { input_hash: string };
type ComplianceRecord = { kind: string; entity_id: string; payload: Record<string, unknown> };
type PrivacyPeople = { people: Array<{ person_id: string; name: string }> };

class ServerReadError extends Error {
  constructor(readonly status: number, detail: string) {
    super(detail);
  }
}

async function detail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const value = JSON.parse(text) as { detail?: unknown };
    return typeof value.detail === "string" ? value.detail : text;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

/**
 * Read the signed-in viewer's initial workspace on the server. Every response is
 * user-specific and deliberately uncached; mutations and subsequent refreshes remain
 * in the client provider.
 */
export async function loadInitialWorkspace(
  scopeId?: string,
  screen: IdealScreen = "home",
  selection: WorkspaceSelection = {},
  view?: string,
): Promise<InitialWorkspacePayload> {
  ensureHttpsDispatcher();
  const observedAt = new Date().toISOString();
  const token = await getAuthToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const read = async <T,>(path: string): Promise<T> => {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new ServerReadError(response.status, await detail(response));
    return response.json() as Promise<T>;
  };
  const optional = async <T,>(promise: Promise<T>): Promise<T | null> => {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ServerReadError && error.status === 404) return null;
      throw error;
    }
  };
  const empty = (problem: InitialWorkspacePayload["problem"]): InitialWorkspacePayload => ({
    observedAt,
    requestedPeriod: selection.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(selection.period)
      ? selection.period
      : monthInTokyo(new Date(observedAt)),
    selectedPublicationId: null,
    selectedCaseId: null,
    selectedPersonId: null,
    viewerName: "表示名未登録",
    scopes: [],
    scope: null,
    selectionRequired: false,
    problem,
    publications: [],
    names: {},
    calendar: null,
    dashboard: null,
    daily: null,
    stability: null,
    notifications: [],
    partialProblems: [],
  });

  try {
    const [identityValue, scopes] = await Promise.all([
      read<unknown>("/auth/me"),
      read<PlanningScopeSummary[]>("/planning/scopes"),
    ]);
    const identity = parseIdentity(identityValue);
    const viewerName = identity.display_name?.trim() || "表示名未登録";
    if (!scopeId && scopes.length > 1) {
      return { ...empty(null), viewerName, scopes, selectionRequired: true };
    }
    const scope = scopeId
      ? scopes.find((candidate) => candidate.scope_id === scopeId)
      : scopes.length === 1
        ? scopes[0]
        : undefined;
    if (!scope) {
      throw new ServerReadError(
        403,
        scopeId ? "指定された施設・部署の所属がありません。" : "この施設・部署の所属がありません。",
      );
    }

    const dateParts = Object.fromEntries(
      new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date(observedAt)).map((part) => [part.type, part.value]),
    );
    const currentPeriod = `${dateParts.year}-${dateParts.month}`;
    const day = `${currentPeriod}-${dateParts.day}`;
    const queryScope = encodeURIComponent(scope.scope_id);
    const privacyPurpose = screen === "governance" && view === "privacy";
    const needsNames = ["home", "schedule", "operations", "requests", "people"].includes(screen)
      || Boolean(selection.personId);
    // An approved use restriction deliberately blocks ordinary planning reads. The
    // privacy-purpose route must remain available to review and complete that case.
    const publications = privacyPurpose
      ? []
      : await read<PublicationRead[]>(`/planning/publications?scope_id=${queryScope}`);
    const resolved = resolveWorkspaceSelection(publications, new Date(observedAt), {
      ...selection,
      // A publication is unrelated to a privacy request. Carrying one from a
      // previous screen must not make the restricted-purpose route unreachable.
      publicationId: privacyPurpose ? undefined : selection.publicationId,
    });
    const period = resolved.period;
    const scopePeople = async (): Promise<Record<string, string>> => {
      const [periods, records] = await Promise.all([
        read<InputPeriod[]>(`/planning/inputs?scope_id=${queryScope}`),
        read<ComplianceRecord[]>(`/planning/compliance/records?scope_id=${queryScope}`),
      ]);
      const hashes = Array.from(new Set(periods.map((item) => item.input_hash)));
      const inputs = await Promise.all(hashes.map((inputHash) =>
        read<InputLatest>(`/planning/inputs/latest?scope_id=${queryScope}&input_hash=${encodeURIComponent(inputHash)}`)));
      return scopePersonNames(inputs, records);
    };
    type PartialProblem = InitialWorkspacePayload["partialProblems"][number];
    const supplementary = async <T,>(resource: string, promise: Promise<T | null>): Promise<{ value: T | null; problem: PartialProblem | null }> => {
      try {
        return { value: await promise, problem: null };
      } catch (error) {
        if (error instanceof ServerReadError && error.status === 401) throw error;
        return {
          value: null,
          problem: {
            resource,
            status: error instanceof ServerReadError ? error.status : 503,
            detail: error instanceof Error ? error.message : "読取りに失敗しました。",
          },
        };
      }
    };
    const results = await Promise.all([
      supplementary("職員名", privacyPurpose && (!resolved.personId || resolved.personId === scope.person_id)
        ? Promise.resolve({ [scope.person_id]: viewerName })
        : privacyPurpose
          ? read<PrivacyPeople>(`/planning/compliance/privacy?scope_id=${queryScope}`).then((value) =>
              Object.fromEntries(value.people.map((person) => [person.person_id, person.name])))
        : scope.role === "PHARMACIST" || !needsNames
        ? Promise.resolve(null)
        : screen === "people" || resolved.personId
          ? scopePeople()
          : optional(read<InputLatest>(`/planning/inputs/latest?scope_id=${queryScope}`)).then((input) =>
              input ? Object.fromEntries(input.snapshot.people.map((person) => [person.person_id, person.name])) : {})),
      supplementary("勤務表", ["home", "schedule"].includes(screen) ? optional(read<ScheduleCalendarView>(`/planning/schedule-calendar?scope_id=${queryScope}&period=${period}`)) : Promise.resolve(null)),
      supplementary("ホーム集計", screen === "home" ? optional(read<DashboardSummary>(`/planning/dashboard?scope_id=${queryScope}&period=${period}`)) : Promise.resolve(null)),
      supplementary("当日運用", ["home", "operations"].includes(screen) ? optional(read<DailyOperationsSnapshot>(`/planning/daily-operations?scope_id=${queryScope}&day=${day}`)) : Promise.resolve(null)),
      supplementary("変更安定性", screen === "home" ? optional(read<ScheduleStabilitySummary>(`/planning/schedule-stability?scope_id=${queryScope}`)) : Promise.resolve(null)),
      supplementary("通知", privacyPurpose
        ? Promise.resolve([])
        : optional(read<WorkspaceNotification[]>(`/planning/notifications?scope_id=${queryScope}`))),
    ]);
    const [namesValue, calendar, dashboard, daily, stability, notifications] = results.map((item) => item.value) as [Record<string, string> | null, ScheduleCalendarView | null, DashboardSummary | null, DailyOperationsSnapshot | null, ScheduleStabilitySummary | null, WorkspaceNotification[] | null];
    const names = namesValue ?? {};
    const peopleProblem = results[0].problem;
    if (resolved.personId && peopleProblem) {
      throw new ServerReadError(peopleProblem.status, peopleProblem.detail);
    }
    const selectedPersonId = resolvePersonSelection(
      resolved.personId,
      scope.person_id,
      scope.role,
      names,
    );
    return {
      observedAt,
      requestedPeriod: period,
      selectedPublicationId: resolved.publication?.publication_id ?? null,
      selectedCaseId: resolved.caseId,
      selectedPersonId,
      viewerName,
      scopes,
      scope,
      selectionRequired: false,
      problem: null,
      publications,
      names,
      calendar,
      dashboard,
      daily,
      stability,
      notifications: notifications ?? [],
      partialProblems: results.flatMap((item) => item.problem ? [item.problem] : []),
    };
  } catch (error) {
    const status = error instanceof ServerReadError || error instanceof WorkspaceSelectionError ? error.status : 503;
    const message = error instanceof Error ? error.message : "初期情報を読み込めませんでした。";
    return empty({ status, detail: message });
  }
}
