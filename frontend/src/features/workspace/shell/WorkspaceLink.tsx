"use client";

import type { ComponentProps } from "react";
import type { WorkspaceRoutePath } from "../generated/usecaseRoutes";
import { useRouteParams } from "./useRouteParams";
import { contextOfQuery, workspaceHrefWithContext, type PlanRoutePath, type PlanSelection, type WorkspaceLinkContext } from "./workspaceHref";

type Props<R extends WorkspaceRoutePath> = Omit<ComponentProps<"a">, "href"> & {
  /** A route of the generated contract; `routeOf("people/contracts").route` names one. */
  route: R;
  /** What this link selects. Only a planning route takes an input version and plans. */
  context?: R extends PlanRoutePath ? WorkspaceLinkContext & PlanSelection : WorkspaceLinkContext;
};

/**
 * A link from one workspace route to another. The destination is a route of the contract
 * and nothing else: there is no free `href` and no return URL. The scope, period,
 * publication, case and person of the URL on screen travel with it unless the link names
 * its own, each checked for its form (see `workspaceHrefWithContext`). It is a plain
 * anchor, so the destination is read again by the server.
 */
export default function WorkspaceLink<R extends WorkspaceRoutePath>({ route, context, children, ...anchor }: Props<R>) {
  const inherited = contextOfQuery(useRouteParams());
  return <a {...anchor} href={workspaceHrefWithContext(route, context ?? {}, inherited)}>{children}</a>;
}
