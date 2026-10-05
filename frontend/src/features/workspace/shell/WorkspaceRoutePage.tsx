import { createIdealClient } from "@/ideal/api/client";
import type { IdealRole, IdealScreen } from "@/ideal/types";
import { refreshRoute } from "./actions/refreshRoute";
import RouteFrame from "./RouteFrame";
import RouteProblem from "./RouteProblem";
import { routeDefinition, routeKey } from "./routes";
import { readRoute, routeOf } from "./routeTypes";
import ScopeChoice from "./ScopeChoice";
import { loadWorkspaceContext } from "./server/context";
import type { QueryValue } from "./server/planSelection";
import { createServerTransport } from "./server/transport";
import WorkspaceRuntime from "./WorkspaceRuntime";
import WorkspaceShell from "./WorkspaceShell";

/** The query of a workspace URL. `draft` is repeated on the comparison of plans. */
export type WorkspaceSearch = { scope?: string; period?: string; publication?: string; case?: string; person?: string; draft?: QueryValue; input?: QueryValue };

/** The route a URL names, when the generated contract lets the role open it; otherwise null. */
const openRoute = (screen: IdealScreen, view: string | undefined, role: IdealRole) => {
  const key = routeKey(screen, view, role);
  return key && (routeOf(key).roles as readonly string[]).includes(role) ? key : null;
};

/**
 * One workspace route, rendered on the server: the mandatory context (who, which scope, what
 * the URL selects), then the role check, then only that route's own read. A route the role
 * may not open is refused before anything is read for it: neither its roster, nor the person
 * its URL names, nor its own data.
 */
export default async function WorkspaceRoutePage({ screen, view, search }: { screen: IdealScreen; view?: string; search: WorkspaceSearch }) {
  const transport = await createServerTransport();
  const context = await loadWorkspaceContext(
    transport,
    search.scope,
    { period: search.period, publicationId: search.publication, caseId: search.case, personId: search.person, draft: search.draft, input: search.input },
    (role) => {
      const key = openRoute(screen, view, role);
      return key ? routeDefinition(key).names : null;
    },
  );
  const ready = context.kind === "ready" ? context : null;
  const shell = {
    viewerName: context.viewerName,
    scopes: context.scopes,
    scope: ready?.ctx.scope ?? null,
    publications: ready?.ctx.publications ?? [],
    selectedPublicationId: ready?.ctx.publication?.publication_id ?? null,
    requestedPeriod: context.period,
    notifications: ready?.ctx.notifications ?? [],
  };
  // A role with no view of the screen has no route there: the frame is shown without a
  // selected view, and the route is refused below before anything is read for it.
  const shownKey = ready ? routeKey(screen, view, ready.ctx.role) : null;
  const selectedView = shownKey ? routeOf(shownKey).view : view;
  const frame = (body: React.ReactNode) => <WorkspaceShell
    initial={shell}
    screen={screen}
    view={selectedView === "index" ? undefined : selectedView}
    routeContext={{ case: ready?.ctx.selectedCaseId ?? undefined, person: ready?.ctx.selectedPersonId ?? undefined }}
  >{body}</WorkspaceShell>;

  if (context.kind === "select-scope") return frame(<ScopeChoice scopes={context.scopes} />);
  if (context.kind === "problem") return frame(<RouteProblem status={context.status} detail={context.detail} />);

  const { ctx } = context;
  const key = openRoute(screen, view, ctx.role);
  if (!key) return frame(<RouteProblem status={403} detail="" forbiddenRoute />);
  const definition = routeDefinition(key);
  const state = await readRoute(definition, createIdealClient("server-read", transport.request), ctx);
  const merged = state.kind === "ready" ? { ...state, partial: [...context.partial, ...state.partial] } : state;
  return frame(<WorkspaceRuntime ctx={ctx} refreshRoute={refreshRoute}><RouteFrame definition={definition} state={merged} ctx={ctx} /></WorkspaceRuntime>);
}
