"use client";

import RouteProblem from "../shell/RouteProblem";
import { routeDefinition, routeKey } from "../shell/routes";
import WorkspaceShell, { type ShellInitial } from "../shell/WorkspaceShell";
import ShowcaseRoute, { SELECTED_PERSON, type WorkspaceShowcaseState } from "./ShowcaseRoute";
import { syntheticContext } from "./synthetic/context";
import type { IdealRole, IdealScreen } from "@/ideal/types";

/** The frame of the synthetic scope. */
const initialFor = (role: IdealRole, empty: boolean): ShellInitial => ({
  requestedPeriod: "2026-10",
  selectedPublicationId: "synthetic-publication-12",
  viewerName: role === "ADMIN" ? "佐藤 美咲" : role === "LEADER" ? "鈴木 悠斗" : "高橋 葵",
  scopes: [{ scope_id: "synthetic/clinical-pharmacy", display_name: "東都医療センター · 薬剤部", person_id: `synthetic-${role.toLowerCase()}`, role, input_revision: 12 }],
  scope: { scope_id: "synthetic/clinical-pharmacy", display_name: "東都医療センター · 薬剤部", person_id: `synthetic-${role.toLowerCase()}`, role, input_revision: 12 },
  publications: [{ publication_id: "synthetic-publication-12", version: 12, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00", assignments: [], validation_status: "valid" }],
  // The same notifications the routes are given, so the shell's count and the list agree.
  notifications: syntheticContext(role, empty).notifications,
});

/**
 * A workspace route as production shows it, on synthetic data: the same shell, the same
 * route definition (read and view) and the same refusal when the role has no route there.
 * Only the transport differs (see ShowcaseRoute).
 */
export default function CognitiveWorkspaceShowcase({ screen = "home", view, role = "LEADER", state = "ready" }: { screen?: IdealScreen; view?: string; role?: IdealRole; state?: WorkspaceShowcaseState }) {
  const key = routeKey(screen, view, role);
  // The frame is given what the route's URL would name, so its links carry it as in production.
  const routeContext = state === "selected-person" ? { person: SELECTED_PERSON } : undefined;
  return <WorkspaceShell initial={initialFor(role, Boolean(key) && state === "empty")} screen={screen} view={view} routeContext={routeContext}>
    {key ? <ShowcaseRoute definition={routeDefinition(key)} role={role} state={state} /> : <RouteProblem status={403} detail="" forbiddenRoute />}
  </WorkspaceShell>;
}
