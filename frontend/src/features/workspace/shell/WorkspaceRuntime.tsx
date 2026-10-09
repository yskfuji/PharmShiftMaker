"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { LiveApi } from "@/ideal/live/context";
import { browserNavigation } from "@/lib/browserNavigation";
import { nameOf, type RouteContext } from "./routeTypes";

const LiveContext = createContext<LiveApi | null>(null);

/** What a client island needs to change something: the typed client, the key-keeping
 * mutation runner and a way to read the route again. Server data arrives as props. */
export function useLive(): LiveApi {
  const live = useContext(LiveContext);
  if (!live) throw new Error("useLive must be used inside a workspace route");
  return live;
}

export const liveFrom = (ctx: RouteContext, parts: Pick<LiveApi, "client" | "mutate" | "refresh"> & { isSynthetic?: boolean }): LiveApi => ({
  ...parts,
  scopeId: ctx.scope.scope_id,
  role: ctx.role,
  personId: ctx.scope.person_id,
  publication: ctx.publication,
  selectedCaseId: ctx.selectedCaseId,
  selectedPersonId: ctx.selectedPersonId,
  publicationOf: (id) => ctx.publications.find((item) => item.publication_id === id),
  nameOf: (person) => nameOf(ctx, person),
  people: Object.entries(ctx.names).map(([person_id, name]) => ({ person_id, name })),
});

/** Supplies a ready `LiveApi` (Storybook and tests pass a synthetic one). */
export function LiveProvider({ live, children }: { live: LiveApi; children: ReactNode }) {
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

/** The Server Action that renders the current route again (`shell/actions/refreshRoute`). */
export type RefreshRoute = () => Promise<void>;

/** How long after the document began to leave a failed read is taken for the browser
 * cancelling the page's requests (Firefox and WebKit do that at once), in milliseconds. */
const LEAVING_WINDOW = 1500;

/**
 * Asks the server to read the route again. The promise settles when that read is on screen:
 * the request and a counter are updated in one transition, which React commits only once
 * the refreshed route is ready, and the counter's commit settles the promise. It also
 * settles when the runtime goes away, and never rejects: what the server could not read is
 * shown by the refreshed route itself. A request that got no answer leaves the route as it
 * was, and `unanswered` says so until the server's next read of the route is shown.
 *
 * The read is a Server Action and not `router.refresh()`. When the request of a
 * `router.refresh()` fails, the router navigates the document to the address it was
 * reading, which is the current page. Firefox and WebKit fail the pending requests of a
 * page as soon as a document navigation starts, so a navigation the user began while the
 * read was under way (the scope form, sign-out, a plain link) was cancelled and the browser
 * returned to the page being left. A Server Action that fails only rejects, the router
 * keeps its state, and the navigation goes on.
 *
 * The rejection is not passed on to the island. Only a request that fails just after the
 * document began to leave is taken for that navigation and ignored. A request is also
 * refused when the session has ended, when the application was deployed again since the
 * page was opened, or when a reverse proxy does not forward the host the browser used:
 * whatever the reason, what is on screen was not read again, and the runtime tells the user
 * (`StaleRoute`).
 *
 * Which read is marked. The router runs Server Actions one after the other and shows
 * nothing in between: when two reads were asked for, the answer of the first appears only
 * when the second has settled, in the commit that also carries this hook's counter. So a
 * failure is remembered by its request and judged in that commit: if the newest request
 * shown then is one that failed, the read on screen (`observedAt` names it) may have been
 * made before the change that request was to show, and it is marked; if a later request was
 * answered, nothing is. A failure that becomes known after its request was already shown
 * (a navigation inside the workspace took its place) marks the read on screen at that
 * moment: the browser cannot tell whether that read is newer than the change. The mark
 * holds until another read is shown.
 */
function useRouteRefresh(refreshRoute: RefreshRoute, observedAt: string): { refresh: () => Promise<void>; unanswered: boolean } {
  const [, startTransition] = useTransition();
  const [shown, setShown] = useState(0);
  const [unanswered, setUnanswered] = useState<string | null>(null);
  const requested = useRef(0);
  const committed = useRef({ request: 0, observedAt });
  const failed = useRef(new Set<number>());
  const leftAt = useRef(Number.NEGATIVE_INFINITY);
  const waiting = useRef<Array<{ request: number; resolve: () => void }>>([]);
  // The server sends the action with every render of the route; any of them does the same.
  const action = useRef(refreshRoute);
  useEffect(() => { action.current = refreshRoute; }, [refreshRoute]);
  useEffect(() => {
    const leaving = () => { leftAt.current = Date.now(); };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, []);
  const settle = useCallback((upTo: number) => {
    const done = waiting.current.filter((item) => item.request <= upTo);
    waiting.current = waiting.current.filter((item) => item.request > upTo);
    for (const item of done) item.resolve();
  }, []);
  useEffect(() => {
    committed.current = { request: shown, observedAt };
    if (failed.current.has(shown)) setUnanswered(observedAt);
    failed.current.forEach((request) => { if (request <= shown) failed.current.delete(request); });
    settle(shown);
  }, [shown, observedAt, settle]);
  useEffect(() => () => settle(Number.POSITIVE_INFINITY), [settle]);
  const refresh = useCallback(() => new Promise<void>((resolve) => {
    const request = ++requested.current;
    waiting.current.push({ request, resolve });
    const notRead = () => {
      if (Date.now() - leftAt.current < LEAVING_WINDOW) return;
      if (request > committed.current.request) failed.current.add(request);
      else if (request === committed.current.request) setUnanswered(committed.current.observedAt);
    };
    startTransition(() => {
      // Called inside the transition: the router puts the answer on screen in this same
      // transition, so the counter below commits with the refreshed route. When the
      // request fails the router changes nothing, and the counter commits alone.
      try {
        void action.current().catch(notRead);
      } catch {
        // An action that cannot even be sent is a request without an answer.
        notRead();
      }
      setShown((old) => Math.max(old, request));
    });
  }), []);
  return { refresh, unanswered: unanswered === observedAt };
}

/**
 * Shown while a read of the route got no answer: what is on screen may be older than what
 * the server holds. It says nothing about a save: the route is also read again after a
 * save was refused (a conflict) and on request, so whether something was saved is what the
 * place of the operation says. Loading the document again is the one way out that does not
 * depend on the request that failed; it discards what is being typed, hence the warning.
 * An alert, because it is inserted with its content and asks for something before going on;
 * it is brought into view once without moving the focus (the operation may be far down the
 * page; the page jumps to the notice, also when a conflict was just shown further down).
 */
function StaleRoute() {
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => { notice.current?.scrollIntoView?.({ block: "nearest" }); }, []);
  return <div ref={notice} className="ideal-inline-problem ideal-v3-stale" role="alert">
    <div>
      <strong>最新の内容を読み込めませんでした</strong>
      <p>表示は読み直す前のままで、最新ではない可能性があります。この表示は、保存できたかどうかを示すものではありません。保存の結果は、操作した箇所の表示で確認してください。入力中の内容がある場合は控えてから、ページを再読込みしてください。</p>
    </div>
    <button type="button" className="ideal-button ideal-button--secondary" onClick={() => browserNavigation.reload()}>ページを再読込み</button>
  </div>;
}

/** The production runtime: one retry journal per signed-in account, and a refresh that asks
 * the server to read the route again, so the shell and the view update from one source.
 * `refreshRoute` is handed over by the server-rendered route (a client module never imports
 * the action), which also keeps Storybook's synthetic runtime free of it. */
export default function WorkspaceRuntime({ ctx, refreshRoute, children }: { ctx: RouteContext; refreshRoute: RefreshRoute; children: ReactNode }) {
  const { identity } = useIdentity();
  const account = identity?.user_id ?? "anonymous";
  const client = useMemo(() => createIdealClient(account), [account]);
  const mutate = useMemo(() => createMutator(account), [account]);
  const { refresh, unanswered } = useRouteRefresh(refreshRoute, ctx.observedAt);
  const live = useMemo(() => liveFrom(ctx, { client, mutate, refresh }), [ctx, client, mutate, refresh]);
  return <LiveContext.Provider value={live}>{unanswered && <StaleRoute />}{children}</LiveContext.Provider>;
}
