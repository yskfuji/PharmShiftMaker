// Every workspace route with its own read boundary and view. The registry is total: a route
// of the generated contract without an entry, or an entry the contract does not have, is a
// type error, so there is no other way a workspace URL is rendered.
import type { IdealRole, IdealScreen } from "@/ideal/types";
import { defaultWorkspaceView } from "@/ideal/views";
import { WORKSPACE_ROUTE_KEYS, type WorkspaceRouteKey } from "../generated/usecaseRoutes";
import governanceActuals from "../governance/actuals/route";
import governanceAudit from "../governance/audit/route";
import governancePrivacy from "../governance/privacy/route";
import governanceRecovery from "../governance/recovery/route";
import homeIndex from "../home/route";
import operationsCases from "../operations/cases/route";
import operationsToday from "../operations/today/route";
import peopleContracts from "../people/contracts/route";
import peopleDirectory from "../people/directory/route";
import peopleLifecycle from "../people/lifecycle/route";
import peopleMemberships from "../people/memberships/route";
import planCompare from "../planning/compare/route";
import planDrafts from "../planning/drafts/route";
import planGenerate from "../planning/generate/route";
import planInput from "../planning/input/route";
import planPublications from "../planning/publications/route";
import requestsLeave from "../requests/leave/route";
import requestsMine from "../requests/mine/route";
import requestsOutside from "../requests/outside/route";
import requestsSwap from "../requests/swap/route";
import scheduleIndex from "../schedule/route";
import settingsAbsenceConsent from "../settings/absenceConsent/route";
import settingsAppearance from "../settings/appearance/route";
import settingsFlextime from "../settings/flextime/route";
import settingsNotifications from "../settings/notifications/route";
import type { RouteDefinition } from "./routeTypes";

// Each definition keeps its own data type; the registry only needs them to be definitions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouteDefinition = RouteDefinition<any>;

export const ROUTE_DEFINITIONS = {
  "governance/actuals": governanceActuals,
  "governance/audit": governanceAudit,
  "governance/privacy": governancePrivacy,
  "governance/recovery": governanceRecovery,
  "home/index": homeIndex,
  "operations/cases": operationsCases,
  "operations/today": operationsToday,
  "people/contracts": peopleContracts,
  "people/directory": peopleDirectory,
  "people/lifecycle": peopleLifecycle,
  "people/memberships": peopleMemberships,
  "plan/compare": planCompare,
  "plan/drafts": planDrafts,
  "plan/generate": planGenerate,
  "plan/input": planInput,
  "plan/publications": planPublications,
  "requests/leave": requestsLeave,
  "requests/mine": requestsMine,
  "requests/outside": requestsOutside,
  "requests/swap": requestsSwap,
  "schedule/index": scheduleIndex,
  "settings/absence-consent": settingsAbsenceConsent,
  "settings/appearance": settingsAppearance,
  "settings/flextime": settingsFlextime,
  "settings/notifications": settingsNotifications,
} satisfies { [K in WorkspaceRouteKey]: AnyRouteDefinition };

/**
 * The route a URL names for a role: the view of the URL, or the first view of the screen
 * the role has. Null when the screen has no view for the role, or the view is not one of
 * the contract: there is then no route, and nothing is read or shown for it.
 */
export const routeKey = (screen: IdealScreen, view: string | undefined, role: IdealRole): WorkspaceRouteKey | null => {
  const key = `${screen}/${view ?? defaultWorkspaceView(screen, role) ?? "index"}`;
  return (WORKSPACE_ROUTE_KEYS as readonly string[]).includes(key) ? (key as WorkspaceRouteKey) : null;
};

/** The definition of a route. Every route of the contract has one. */
export const routeDefinition = (key: WorkspaceRouteKey): AnyRouteDefinition => ROUTE_DEFINITIONS[key];
