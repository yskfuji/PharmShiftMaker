"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { API_BASE_URL } from "@/lib/apiTarget";
import { browserNavigation } from "@/lib/browserNavigation";
import { loginPath } from "@/lib/loginPath";
import { PlanningError } from "@/lib/planningTransport";
import { createIdealClient } from "../api/client";
import type { PublicationRead } from "../api/contracts";
import { createMutator } from "../api/mutations";
import { problemFrom } from "../api/errors";
import { toWorkspaceModel } from "../api/toModel";
import { resolvePersonSelection, resolveWorkspaceSelection, WorkspaceSelectionError } from "../api/workspaceSelection";
import type { LiveApi } from "../live/context";
import type { ProblemModel, WorkspaceModel } from "../model";
import type { IdealRole, PlanningScopeSummary } from "../types";
import type { InitialWorkspacePayload } from "./initial";
import { announceWorkspaceContext, type WorkspaceContextChangedDetail } from "./contextEvent";
import { WorkspaceContext, type WorkspaceSource } from "./WorkspaceContext";

type ProviderState = { model: WorkspaceModel | null; role: IdealRole | null; loading: boolean; problem: ProblemModel | null;
  scopes: PlanningScopeSummary[]; scope: PlanningScopeSummary | null; publication: PublicationRead | null; publications: PublicationRead[]; names: Record<string, string>; selectionRequired: boolean;
  selectedCaseId: string | null; selectedPersonId: string | null;
  partialProblems: Array<{ resource: string; status: number; detail: string }> };

const EMPTY_STATE: ProviderState = { model: null, role: null, loading: true, problem: null, scopes: [], scope: null, publication: null, publications: [], names: {}, selectionRequired: false, selectedCaseId: null, selectedPersonId: null, partialProblems: [] };

function fromInitial(initial: InitialWorkspacePayload | undefined): ProviderState {
  if (!initial) return EMPTY_STATE;
  if (initial.problem) {
    return { ...EMPTY_STATE, loading: false, problem: problemFrom(new PlanningError(initial.problem.status, initial.problem.detail)) };
  }
  if (!initial.scope) {
    return { ...EMPTY_STATE, loading: false, scopes: initial.scopes, selectionRequired: initial.selectionRequired };
  }
  const now = new Date(initial.observedAt);
  const publication = initial.publications.find((item) => item.publication_id === initial.selectedPublicationId) ?? null;
  const model = toWorkspaceModel({
    scope: initial.scope,
    publication,
    names: initial.names,
    viewerName: initial.viewerName,
    now,
    calendar: initial.calendar,
    dashboard: initial.dashboard,
    daily: initial.daily,
    stability: initial.stability,
    notifications: initial.notifications,
    exportUrl: (id, format) => createIdealClient("server-read").personalExportUrl(API_BASE_URL, initial.scope!.scope_id, id, format),
  });
  return { model, role: initial.scope.role, loading: false, problem: null, scopes: initial.scopes, scope: initial.scope,
    publication, publications: initial.publications, names: initial.names, selectionRequired: false,
    selectedCaseId: initial.selectedCaseId, selectedPersonId: initial.selectedPersonId, partialProblems: initial.partialProblems };
}

/**
 * The signed-in viewer's own scope. Role and scope come from the server's
 * memberships (/planning/scopes); the server also limits a pharmacist to their own duties.
 * The client decides nothing about permissions or legal validity.
 */
export default function ApiWorkspaceProvider({ scopeId, period, publicationId, caseId, personId, privacyPurpose = false, rosterPurpose = false, initial, children }: {
  scopeId?: string;
  period?: string;
  publicationId?: string;
  caseId?: string;
  personId?: string;
  privacyPurpose?: boolean;
  rosterPurpose?: boolean;
  initial?: InitialWorkspacePayload;
  children: ReactNode;
}) {
  const { identity } = useIdentity();
  const client = useMemo(() => createIdealClient(identity?.user_id ?? "anonymous"), [identity?.user_id]);
  // One retry journal per signed-in account, like the transport's.
  const account = identity?.user_id ?? "anonymous";
  const mutate = useMemo(() => createMutator(account), [account]);
  const [state, setState] = useState<ProviderState>(() => fromInitial(initial));
  const generation = useRef(0);
  const skipInitialLoad = useRef(Boolean(initial));
  const viewerName = identity?.display_name?.trim() || initial?.viewerName || "表示名未登録";

  const load = useCallback(async (): Promise<WorkspaceContextChangedDetail | null> => {
    const current = ++generation.current;
    setState((old) => ({ ...old, loading: true, problem: null }));
    try {
      const scopes = await client.scopes();
      // A scope named in the URL must be one of the viewer's own; never fall back silently.
      // Only a single available scope may be selected without an explicit user choice.
      const scope = scopeId ? scopes.find((s) => s.scope_id === scopeId) : scopes.length === 1 ? scopes[0] : undefined;
      if (!scopeId && scopes.length > 1) {
        if (current !== generation.current) return null;
        setState({ model: null, role: null, loading: false, problem: null, scopes, scope: null, publication: null, publications: [], names: {}, selectionRequired: true, selectedCaseId: null, selectedPersonId: null, partialProblems: [] });
        return null;
      }
      if (!scope) throw new PlanningError(403, scopeId ? "指定された施設・部署の所属がありません。" : "この施設・部署の所属がありません。");
      const now = new Date();
      const dateParts = Object.fromEntries(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
      const currentPeriod = `${dateParts.year}-${dateParts.month}`;
      const day = `${currentPeriod}-${dateParts.day}`;
      const optional = <T,>(read: Promise<T>): Promise<T | null> => read.catch((error: unknown) => {
        if (error instanceof PlanningError && error.status === 404) return null;
        throw error;
      });
      const publications = privacyPurpose ? [] : await client.publications(scope.scope_id);
      const resolved = resolveWorkspaceSelection(publications, now, {
        period,
        publicationId: privacyPurpose ? undefined : publicationId,
        caseId,
        personId,
      });
      const requestedPeriod = resolved.period;
      const partial = async <T,>(resource: string, promise: Promise<T>): Promise<{ value: T | null; problem: { resource: string; status: number; detail: string } | null }> => {
        try {
          return { value: await promise, problem: null };
        } catch (error) {
          if (error instanceof PlanningError && error.status === 401) throw error;
          return { value: null, problem: { resource, status: error instanceof PlanningError ? error.status : 503, detail: error instanceof Error ? error.message : "読取りに失敗しました。" } };
        }
      };
      const results = await Promise.all([
        partial("職員名", privacyPurpose && (!resolved.personId || resolved.personId === scope.person_id)
          ? Promise.resolve({ [scope.person_id]: viewerName })
          : privacyPurpose
          ? client.privacyPeople(scope.scope_id)
          : scope.role === "PHARMACIST"
          ? Promise.resolve({})
          : rosterPurpose || resolved.personId ? client.scopePeople(scope.scope_id) : client.people(scope.scope_id)),
        partial("勤務表", privacyPurpose ? Promise.resolve(null) : optional(client.scheduleCalendar(scope.scope_id, requestedPeriod))),
        partial("ホーム集計", privacyPurpose ? Promise.resolve(null) : optional(client.dashboard(scope.scope_id, requestedPeriod))),
        partial("当日運用", privacyPurpose ? Promise.resolve(null) : optional(client.dailyOperations(scope.scope_id, day))),
        partial("変更安定性", privacyPurpose ? Promise.resolve(null) : optional(client.stability(scope.scope_id))),
        partial("通知", privacyPurpose ? Promise.resolve([]) : optional(client.notifications(scope.scope_id))),
      ]);
      const [names, calendar, dashboard, daily, stability, notifications] = results.map((item) => item.value) as [Record<string, string> | null, import("../types").ScheduleCalendarView | null, import("../types").DashboardSummary | null, import("../types").DailyOperationsSnapshot | null, import("../types").ScheduleStabilitySummary | null, import("../types").WorkspaceNotification[] | null];
      if (current !== generation.current) return null;
      const peopleProblem = results[0].problem;
      if (resolved.personId && peopleProblem) {
        throw new PlanningError(peopleProblem.status, peopleProblem.detail);
      }
      const selectedPersonId = resolvePersonSelection(
        resolved.personId,
        scope.person_id,
        scope.role,
        names ?? {},
      );
      const publication = resolved.publication;
      const model = toWorkspaceModel({ scope, publication, names: names ?? {}, viewerName, now, calendar, dashboard, daily, stability, notifications: notifications ?? [],
        exportUrl: (id, format) => client.personalExportUrl(API_BASE_URL, scope.scope_id, id, format) });
      setState({ model, role: scope.role, loading: false, problem: null, scopes, scope, publication, publications, names: names ?? {}, selectionRequired: false,
        selectedCaseId: resolved.caseId, selectedPersonId,
        partialProblems: results.flatMap((item) => item.problem ? [item.problem] : []) });
      return {
        unreadNotifications: notifications === null ? undefined : notifications.filter((item) => !item.read).length,
        period: requestedPeriod,
        publication: publication ? {
          publication_id: publication.publication_id,
          version: publication.version,
          validation_status: publication.validation_status,
        } : null,
      };
    } catch (error) {
      if (current !== generation.current) return null;
      const problem = error instanceof WorkspaceSelectionError
        ? problemFrom(new PlanningError(error.status, error.message), "read")
        : problemFrom(error, "read");
      setState((old) => ({ model: null, role: null, loading: false, problem, scopes: old.scopes, scope: null, publication: null, publications: [], names: {}, selectionRequired: false, selectedCaseId: null, selectedPersonId: null, partialProblems: [] }));
      return null;
    }
  }, [client, scopeId, period, publicationId, caseId, personId, privacyPurpose, rosterPurpose, viewerName]);

  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void load();
  }, [load]);

  const reload = () => {
    if (state.problem?.kind === "unauthenticated") browserNavigation.replace(loginPath(browserNavigation.pathAndSearch(), "expired"));
    else void load();
  };
  const scope = state.scope;
  const live: LiveApi | null = useMemo(() => scope && {
    client, mutate, scopeId: scope.scope_id, role: scope.role, personId: scope.person_id, publication: state.publication,
    selectedCaseId: state.selectedCaseId, selectedPersonId: state.selectedPersonId,
    publicationOf: (id: string) => state.publications.find((p) => p.publication_id === id),
    // A pharmacist is not given other people's names; the other person is named only
    // where the server says so (exchange options).
    nameOf: (person: string) => state.names[person] ?? (person === scope.person_id ? "あなた" : scope.role === "PHARMACIST" ? "相手の職員" : person),
    people: Object.entries(state.names).map(([person_id, name]) => ({ person_id, name })),
    refresh: async () => {
      const detail = await load();
      if (detail) announceWorkspaceContext(detail);
    },
  }, [client, mutate, scope, state.publication, state.publications, state.names, state.selectedCaseId, state.selectedPersonId, load]);
  const chooseScope = (nextScopeId: string) => {
    const target = new URL(window.location.href);
    target.searchParams.set("scope", nextScopeId);
    browserNavigation.replace(`${target.pathname}${target.search}${target.hash}`);
  };
  const value: WorkspaceSource = { source: "api", model: state.model, role: state.role, loading: state.loading, problem: state.problem, reload, live,
    scopes: state.scopes, scope: state.scope, chooseScope, selectionRequired: state.selectionRequired, partialProblems: state.partialProblems };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
