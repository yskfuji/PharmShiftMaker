// The one place a workspace URL is built. A destination is a route of the generated
// contract (docs/ideal-ui/usecases.json), never a free URL, and what travels with it is
// display context only: the server validates every selection again and decides the rest.
import type { WorkspaceRoutePath } from "../generated/usecaseRoutes";

/** What every workspace URL may carry. `person: null` names nobody and inherits nobody:
 * the link that clears the selected person says so. */
export type WorkspaceLinkContext = { scope?: string; period?: string; publication?: string; case?: string; person?: string | null };
/** What a planning URL may carry besides: the input version and the plans it names. */
export type PlanSelection = { input?: string; draft?: readonly string[] };

export type PlanRoutePath = Extract<WorkspaceRoutePath, `/workspace/plan/${string}`>;

const CONTEXT_KEYS = ["scope", "period", "publication", "case", "person"] as const;
// As the server reads them (planSelection.ts, workspaceSelection.ts): a letter or a digit
// first, so a value is never "." or "..".
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const PATTERN: Record<(typeof CONTEXT_KEYS)[number], RegExp> = {
  scope: /^[A-Za-z0-9._:/-]{1,256}$/,
  period: /^\d{4}-\d{2}$/,
  publication: IDENTIFIER,
  case: IDENTIFIER,
  person: IDENTIFIER,
};
const PRIVACY_ROUTE: WorkspaceRoutePath = "/workspace/governance/privacy";
const PLAN_ROUTES = "/workspace/plan/";
/**
 * The routes that look at the person a URL names: the ones whose definition reads a roster
 * (`names: "roster"`, the people screens) or the privacy-purpose route (`names: "privacy"`).
 * Only a link to one of them carries a person, named or inherited: on any other route the
 * server does not use the person, and a URL that carried one would read as if the account
 * had changed. The structure test keeps this list equal to those definitions.
 */
export const PERSON_ROUTES: readonly WorkspaceRoutePath[] = [
  "/workspace/people/directory",
  "/workspace/people/memberships",
  "/workspace/people/lifecycle",
  "/workspace/people/contracts",
  "/workspace/governance/privacy",
];

/**
 * The href of a workspace path with its context. A value that is not well-formed is left
 * out, never passed on. `inherited` (the context of the URL on screen) fills only what the
 * caller did not name: a value the caller named and that was refused is not replaced by
 * another, and `person: null` is a name for nobody, so nobody is inherited. What the caller
 * named comes first in the query. The privacy-purpose route is never given a publication or
 * a change case, a person travels only to a route of `PERSON_ROUTES`, and a link to another
 * month never inherits the publication or the case of the month on screen.
 */
export const workspaceHrefWithContext = (
  path: string,
  context: WorkspaceLinkContext & PlanSelection,
  inherited: WorkspaceLinkContext = {},
): string => {
  const query = new URLSearchParams();
  const privacyPurpose = path === PRIVACY_ROUTE;
  const personRoute = (PERSON_ROUTES as readonly string[]).includes(path);
  const carried = (key: (typeof CONTEXT_KEYS)[number]) =>
    !(privacyPurpose && (key === "publication" || key === "case")) && !(key === "person" && !personRoute);
  for (const key of CONTEXT_KEYS) {
    const value = context[key];
    if (carried(key) && value && PATTERN[key].test(value)) query.set(key, value);
  }
  // A link that names another month than the one on screen leaves the screen's publication
  // and case behind: they belong to the month on screen, and the server refuses a
  // publication together with another month (409).
  const otherMonth = Boolean(context.period && PATTERN.period.test(context.period) && context.period !== inherited.period);
  const leftBehind = (key: (typeof CONTEXT_KEYS)[number]) => otherMonth && (key === "publication" || key === "case");
  for (const key of CONTEXT_KEYS) {
    const value = inherited[key];
    const named = context[key];
    if (carried(key) && !leftBehind(key) && named !== null && !named && value && PATTERN[key].test(value)) query.set(key, value);
  }
  if (path.startsWith(PLAN_ROUTES)) {
    if (context.input && IDENTIFIER.test(context.input)) query.set("input", context.input);
    for (const draft of context.draft ?? []) if (IDENTIFIER.test(draft)) query.append("draft", draft);
  }
  return `${path}${query.size ? `?${query}` : ""}`;
};

/** The context a URL carries, as a link may inherit it. */
export const contextOfQuery = (query: URLSearchParams): WorkspaceLinkContext =>
  Object.fromEntries(CONTEXT_KEYS.flatMap((key) => {
    const value = query.get(key);
    return value ? [[key, value]] : [];
  }));

/** True on a workspace URL. Storybook and the tests render the same views elsewhere, and
 * there a view stays where it is instead of opening another route. */
export const onWorkspaceRoute = (pathname: string): boolean => pathname.startsWith("/workspace/");
