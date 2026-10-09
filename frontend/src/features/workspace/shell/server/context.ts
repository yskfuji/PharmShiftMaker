// The mandatory boundary of every workspace route: who is signed in, which scope they
// belong to, and which period, publication, case, person, plan and input the URL selects.
// A route's own business data is read separately by that route (see routeTypes.ts).
import type { InputLatest } from "@/ideal/api/client";
import type { PublicationRead } from "@/ideal/api/contracts";
import {
  monthInTokyo,
  resolvePersonSelection,
  resolveWorkspaceSelection,
  scopePersonNames,
  WorkspaceSelectionError,
  type WorkspaceSelection,
} from "@/ideal/api/workspaceSelection";
import type { IdealRole, PlanningScopeSummary, WorkspaceNotification } from "@/ideal/types";
import { parseIdentity } from "@/lib/identity";
import { PlanningError } from "@/lib/planningTransport";
import type { PartialProblem, RouteContext, RouteNames } from "../routeTypes";
import { resolvePlanSelection, type QueryValue } from "./planSelection";
import type { ServerTransport } from "./transport";

/** What the URL selects: the shared selections, and the plan and input of a planning URL. */
export type RouteSelection = WorkspaceSelection & { draft?: QueryValue; input?: QueryValue };

type InputPeriod = { input_hash: string };
type ComplianceRecord = { kind: string; entity_id: string; payload: Record<string, unknown> };
type PrivacyPeople = { people: Array<{ person_id: string; name: string }> };

type Frame = { viewerName: string; scopes: PlanningScopeSummary[]; period: string };

export type WorkspaceContextResult =
  | (Frame & { kind: "ready"; ctx: RouteContext; partial: PartialProblem[] })
  | (Frame & { kind: "select-scope" })
  | (Frame & { kind: "problem"; status: number; detail: string });

const tokyoDay = (at: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const statusOf = (error: unknown) =>
  error instanceof PlanningError || error instanceof WorkspaceSelectionError ? error.status : 503;
const detailOf = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^\d{3}: /, "") : "初期情報を読み込めませんでした。";

export async function loadWorkspaceContext(
  transport: ServerTransport,
  scopeId: string | undefined,
  selection: RouteSelection,
  /**
   * The roster the route needs. The route may depend on the role (a screen's default view).
   * Null when the role may not open the route: only the mandatory context is then read, and
   * the person the URL names is neither looked up nor selected.
   */
  namesFor: (role: IdealRole) => RouteNames | null,
): Promise<WorkspaceContextResult> {
  const observedAt = new Date();
  const requested = selection.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(selection.period)
    ? selection.period
    : monthInTokyo(observedAt);
  let frame: Frame = { viewerName: "表示名未登録", scopes: [], period: requested };
  try {
    const [identityValue, scopes] = await Promise.all([
      transport.read<unknown>("/auth/me"),
      transport.read<PlanningScopeSummary[]>("/planning/scopes"),
    ]);
    const viewerName = parseIdentity(identityValue).display_name?.trim() || "表示名未登録";
    frame = { viewerName, scopes, period: requested };
    // More than one scope and none named: nothing person-specific is read until one is chosen.
    if (!scopeId && scopes.length > 1) return { kind: "select-scope", ...frame };
    const scope = scopeId
      ? scopes.find((candidate) => candidate.scope_id === scopeId)
      : scopes.length === 1 ? scopes[0] : undefined;
    if (!scope) {
      throw new PlanningError(403, scopeId ? "指定された施設・部署の所属がありません。" : "この施設・部署の所属がありません。");
    }
    // A malformed plan or input in the URL is refused before anything is read for the route.
    const plan = resolvePlanSelection(selection.draft, selection.input);
    const queryScope = encodeURIComponent(scope.scope_id);
    const need = namesFor(scope.role);
    const names = need ?? "none";
    const privacyPurpose = names === "privacy";
    // An approved use restriction blocks ordinary planning reads. The privacy-purpose route
    // must stay reachable to review and complete that case, so it reads none of them.
    const publications = privacyPurpose
      ? []
      : await transport.read<PublicationRead[]>(`/planning/publications?scope_id=${queryScope}`);
    const selected = resolveWorkspaceSelection(publications, observedAt, {
      period: selection.period,
      publicationId: privacyPurpose ? undefined : selection.publicationId,
      caseId: selection.caseId,
      personId: selection.personId,
    });
    // A route the role may not open confirms no person: the roster is not read for a refusal.
    const resolved = need === null ? { ...selected, personId: null } : selected;
    frame = { ...frame, period: resolved.period };

    const partial: PartialProblem[] = [];
    const supplementary = async <T,>(resource: string, read: Promise<T>): Promise<T | null> => {
      try {
        return await read;
      } catch (error) {
        if (statusOf(error) === 401) throw error;
        partial.push({ resource, status: statusOf(error), detail: detailOf(error) });
        return null;
      }
    };
    const missing = <T,>(read: Promise<T>): Promise<T | null> => read.catch((error: unknown) => {
      if (statusOf(error) === 404) return null;
      throw error;
    });
    const roster = async (): Promise<Record<string, string>> => {
      const [periods, records] = await Promise.all([
        transport.read<InputPeriod[]>(`/planning/inputs?scope_id=${queryScope}`),
        transport.read<ComplianceRecord[]>(`/planning/compliance/records?scope_id=${queryScope}`),
      ]);
      const hashes = Array.from(new Set(periods.map((item) => item.input_hash)));
      const inputs = await Promise.all(hashes.map((inputHash) =>
        transport.read<InputLatest>(`/planning/inputs/latest?scope_id=${queryScope}&input_hash=${encodeURIComponent(inputHash)}`)));
      return scopePersonNames(inputs, records);
    };
    const readNames = (): Promise<Record<string, string>> => {
      if (privacyPurpose) {
        if (!resolved.personId || resolved.personId === scope.person_id) {
          return Promise.resolve({ [scope.person_id]: viewerName });
        }
        return transport.read<PrivacyPeople>(`/planning/compliance/privacy?scope_id=${queryScope}`)
          .then((value) => Object.fromEntries(value.people.map((person) => [person.person_id, person.name])));
      }
      // A pharmacist is never given the roster; a person named in the URL needs the exact one.
      if (scope.role === "PHARMACIST") return Promise.resolve({});
      if (names === "roster" || resolved.personId) return roster();
      if (names === "none") return Promise.resolve({});
      return missing(transport.read<InputLatest>(`/planning/inputs/latest?scope_id=${queryScope}`))
        .then((input) => input ? Object.fromEntries(input.snapshot.people.map((person) => [person.person_id, person.name])) : {});
    };
    const [nameMap, notifications] = await Promise.all([
      supplementary("職員名", readNames()),
      supplementary("通知", privacyPurpose
        ? Promise.resolve<WorkspaceNotification[]>([])
        : missing(transport.read<WorkspaceNotification[]>(`/planning/notifications?scope_id=${queryScope}`))),
    ]);
    const namesProblem = nameMap === null ? partial.find((item) => item.resource === "職員名") : undefined;
    // A person selected in the URL cannot be checked without the roster: refuse, never guess.
    if (resolved.personId && namesProblem) throw new PlanningError(namesProblem.status, namesProblem.detail);
    const selectedPersonId = resolvePersonSelection(resolved.personId, scope.person_id, scope.role, nameMap ?? {});
    return {
      kind: "ready",
      ...frame,
      ctx: {
        observedAt: observedAt.toISOString(),
        day: tokyoDay(observedAt),
        period: resolved.period,
        viewerName,
        scope,
        role: scope.role,
        publications,
        publication: resolved.publication,
        selectedCaseId: resolved.caseId,
        selectedPersonId,
        selectedDraftIds: plan.draftIds,
        selectedInputHash: plan.inputHash,
        names: nameMap ?? {},
        notifications: notifications ?? [],
        notificationsRead: !privacyPurpose && !partial.some((item) => item.resource === "通知"),
      },
      partial,
    };
  } catch (error) {
    return { kind: "problem", ...frame, status: statusOf(error), detail: detailOf(error) };
  }
}
