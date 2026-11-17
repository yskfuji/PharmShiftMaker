import type { IdealRole, IdealScreen } from "./types";
import { USE_CASE_ROUTES, WORKSPACE_ROUTES } from "@/features/workspace/generated/usecaseRoutes";

export type WorkspaceView = { key: string; label: string; short: string; description: string; roles: IdealRole[] };

/** Runtime navigation comes from docs/ideal-ui/usecases.json through the generator. */
export const workspaceViews = Object.fromEntries(
  WORKSPACE_ROUTES
    .filter((route) => route.view !== "index")
    .reduce((entries, route) => {
      const current = entries.get(route.screen) ?? [];
      current.push({
        key: route.view,
        label: route.label,
        short: route.short,
        description: route.description,
        roles: [...route.roles] as IdealRole[],
      });
      entries.set(route.screen, current);
      return entries;
    }, new Map<string, WorkspaceView[]>())
    .entries(),
) as Partial<Record<IdealScreen, WorkspaceView[]>>;

export const defaultWorkspaceView = (screen: IdealScreen, role: IdealRole): string | undefined =>
  workspaceViews[screen]?.find((view) => view.roles.includes(role))?.key;

export const isWorkspaceView = (screen: IdealScreen, view: string): boolean =>
  Boolean(workspaceViews[screen]?.some((item) => item.key === view));

export const workspaceRoute = (screen: IdealScreen, view = "index") =>
  WORKSPACE_ROUTES.find((route) => route.screen === screen && route.view === view);

/** Machine-generated U01-U27 route coverage. */
export const declaredWorkspaceRoutes = USE_CASE_ROUTES;
