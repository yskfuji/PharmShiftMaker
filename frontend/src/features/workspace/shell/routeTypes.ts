// The contract every workspace route implements: one read boundary and one purpose-built
// view. Roles, labels and paths come only from the generated route contract
// (docs/ideal-ui/usecases.json); a definition adds how the route reads and what it shows.
import type { ComponentType } from "react";
import type { IdealClient } from "@/ideal/api/client";
import type { PublicationRead } from "@/ideal/api/contracts";
import type { IdealRole, PlanningScopeSummary, WorkspaceNotification } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { WORKSPACE_ROUTES, type WorkspaceRouteKey } from "../generated/usecaseRoutes";

export type PartialProblem = { resource: string; status: number; detail: string };

/** Which roster a route needs. The server never returns more people than this allows. */
export type RouteNames = "none" | "planning" | "roster" | "privacy";

/**
 * Request-time context of one route, already validated by the server (scope membership,
 * period, publication, case and person; the plan and input of a planning URL by their
 * syntax). Serializable, and never carries a credential.
 */
export type RouteContext = {
  observedAt: string;
  /** Today in Asia/Tokyo, YYYY-MM-DD. */
  day: string;
  period: string;
  viewerName: string;
  scope: PlanningScopeSummary;
  role: IdealRole;
  publications: PublicationRead[];
  publication: PublicationRead | null;
  selectedCaseId: string | null;
  selectedPersonId: string | null;
  /** The plans `?draft=` names, in the order of the URL (at most six). Syntax-checked only:
   * the API decides whether they belong to the scope and the input. */
  selectedDraftIds: string[];
  /** The input version `?input=` names, syntax-checked only; null when the URL names none. */
  selectedInputHash: string | null;
  names: Record<string, string>;
  /** The viewer's own notifications, as the shell shows them. */
  notifications: WorkspaceNotification[];
  /** False when they were not read (the privacy-purpose route) or could not be read (then
   * the context reports `通知`): an empty list is then not "no notifications". */
  notificationsRead: boolean;
};

/** Marks a read whose failure must not hide the rest of the route. */
export type Optional = <T>(resource: string, read: Promise<T>) => Promise<T | null>;

export type RouteDefinition<T> = {
  key: WorkspaceRouteKey;
  names: RouteNames;
  /** The only place this route reads from the API before it is shown. */
  read: (api: IdealClient, ctx: RouteContext, optional: Optional) => Promise<T>;
  View: ComponentType<{ data: T; ctx: RouteContext }>;
};

export const defineRoute = <T,>(definition: RouteDefinition<T>): RouteDefinition<T> => definition;

export type RouteState<T> =
  | { kind: "ready"; data: T; partial: PartialProblem[] }
  | { kind: "problem"; status: number; detail: string };

const statusOf = (error: unknown) => (error instanceof PlanningError ? error.status : 503);
const detailOf = (error: unknown) =>
  error instanceof Error ? error.message.replace(/^\d{3}: /, "") : "読取りに失敗しました。";

/** Run a route's read. A failed optional read is reported beside what was loaded. */
export async function readRoute<T>(
  definition: RouteDefinition<T>,
  api: IdealClient,
  ctx: RouteContext,
): Promise<RouteState<T>> {
  const partial: PartialProblem[] = [];
  const optional: Optional = async (resource, read) => {
    try {
      return await read;
    } catch (error) {
      // An expired session is never a partial result.
      if (statusOf(error) === 401) throw error;
      partial.push({ resource, status: statusOf(error), detail: detailOf(error) });
      return null;
    }
  };
  try {
    return { kind: "ready", data: await definition.read(api, ctx, optional), partial };
  } catch (error) {
    return { kind: "problem", status: statusOf(error), detail: detailOf(error) };
  }
}

type ContractRoute = (typeof WORKSPACE_ROUTES)[number];
/** The contract row of a key, so that `routeOf("plan/input").route` is that one path. */
type RouteOf<K extends WorkspaceRouteKey> =
  K extends `${infer S}/${infer V}` ? Extract<ContractRoute, { screen: S; view: V }> : never;

export const routeOf = <K extends WorkspaceRouteKey>(key: K): RouteOf<K> =>
  WORKSPACE_ROUTES.find((route) => `${route.screen}/${route.view}` === key)! as RouteOf<K>;

/** A pharmacist is not given other people's names; the server names them where it allows.
 * Only an identifier the context holds itself is looked up: `constructor`, `toString` or
 * `__proto__` as an identifier is a key like any other, never what every object inherits. */
export const nameOf = (ctx: RouteContext, personId: string): string =>
  (Object.hasOwn(ctx.names, personId) ? ctx.names[personId] : null)
  ?? (personId === ctx.scope.person_id ? "あなた" : ctx.role === "PHARMACIST" ? "相手の職員" : personId);
