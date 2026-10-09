import { startTransition, Suspense, use, useEffect, useState, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { LiveApi } from "@/ideal/live/context";
import { browserNavigation } from "@/lib/browserNavigation";
import { syntheticContext } from "../../showcase/synthetic/context";
import WorkspaceRuntime, { useLive } from "../WorkspaceRuntime";

jest.mock("@/components/IdentityProvider", () => ({ useIdentity: () => ({ identity: { user_id: "admin" } }) }));

// The app router as it behaves with a Server Action (app-router-instance.js). Every call
// puts its own pending state into the router inside a transition at once, but the requests
// are sent one after the other: the next one only when the one before has settled. A request
// that is answered makes the next version of the route; one that fails leaves the router's
// state as it is and only rejects the action's promise. Because the newest pending state is
// what React waits for, nothing is shown between two requests: the answer of the first
// appears when the second has settled. As in the application, the router's state is above
// the runtime, and every read the server answers renders the route with a new `observedAt`.
// A navigation takes the place of the request under way, whose result the router then drops.
type Request = { answer: () => void; fail: (error: unknown) => void };
type Shown = number | Promise<number>;
type Queued = { run: () => Promise<number>; next: Queued | null; resolve: (version: number) => void; discarded: boolean };
/** `served` counts the reads the server has answered; `version` is the one the router holds. */
const mockServer: { calls: number; requests: Request[]; served: number; version: number; pending: Queued | null; last: Queued | null; show: (next: Shown) => void } = { calls: 0, requests: [], served: 1, version: 1, pending: null, last: null, show: () => undefined };
function runAction(action: Queued) {
  mockServer.pending = action;
  void action.run().then((next) => {
    if (!action.discarded) mockServer.version = next;
    mockServer.pending = action.next;
    if (mockServer.pending) runAction(mockServer.pending);
    action.resolve(next);
  });
}
function dispatch(run: Queued["run"]) {
  let resolve!: (version: number) => void;
  const deferred = new Promise<number>((done) => { resolve = done; });
  startTransition(() => mockServer.show(deferred));
  const action: Queued = { run, next: null, resolve, discarded: false };
  if (mockServer.pending === null) { mockServer.last = action; runAction(action); }
  else { mockServer.last!.next = action; mockServer.last = action; }
}
const refreshRoute = () => {
  mockServer.calls += 1;
  return new Promise<void>((resolve, reject) => {
    // The request exists (and can be answered) only once the queue has reached it.
    dispatch(() => new Promise<number>((shown) => {
      mockServer.requests.push({
        answer: () => { resolve(); mockServer.served += 1; shown(mockServer.served); },
        fail: (error) => { reject(error); shown(mockServer.version); },
      });
    }));
  });
};
/** A navigation inside the workspace that keeps the route: the server reads it again. */
const navigate = () => act(async () => {
  if (mockServer.pending) mockServer.pending.discarded = true;
  mockServer.served += 1;
  const version = mockServer.version = mockServer.served;
  startTransition(() => mockServer.show(version));
});

let live: LiveApi;

function Island() {
  const api = useLive();
  useEffect(() => { live = api; }, [api]);
  return null;
}
function Page({ shown, action, content }: { shown: Shown; action: () => Promise<void>; content?: ReactNode }) {
  const version = typeof shown === "number" ? shown : use(shown);
  return <WorkspaceRuntime ctx={{ ...syntheticContext("LEADER"), observedAt: `read ${version}` }} refreshRoute={action}>
    {content ?? <p>版 {version}</p>}
    <Island />
  </WorkspaceRuntime>;
}
function Router({ action, content }: { action: () => Promise<void>; content?: ReactNode }) {
  const [shown, setShown] = useState<Shown>(1);
  useEffect(() => { mockServer.show = setShown; }, []);
  return <Page shown={shown} action={action} content={content} />;
}
const tree = (action: () => Promise<void>, content?: ReactNode) => <Suspense fallback={<p>読み込み中</p>}><Router action={action} content={content} /></Suspense>;
const mount = (action: () => Promise<void> = refreshRoute, content?: ReactNode) => render(tree(action, content));
/** Whether the promise has settled, and whether it did so by rejecting. */
const watch = (promise: Promise<void>) => {
  const state = { settled: false, rejected: false };
  promise.then(() => { state.settled = true; }, () => { state.settled = true; state.rejected = true; });
  return state;
};
const pause = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const STALE = "最新の内容を読み込めませんでした";

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
const scrolled = jest.fn();
beforeEach(() => {
  mockServer.calls = 0; mockServer.requests = []; mockServer.served = 1; mockServer.version = 1; mockServer.pending = null; mockServer.last = null; mockServer.show = () => undefined;
  unhandled = [];
  scrolled.mockClear();
  // jsdom has no layout: the notice asks to be brought into view through this.
  Element.prototype.scrollIntoView = scrolled;
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => { process.off("unhandledRejection", onUnhandled); jest.restoreAllMocks(); });

test("refresh settles only when the server's read is on screen", async () => {
  mount();
  expect(screen.getByText("版 1")).toBeInTheDocument();
  let refreshed = watch(Promise.resolve());
  await act(async () => { refreshed = watch(live.refresh()); });
  expect(mockServer.calls).toBe(1);
  // The read is under way: the earlier content stays, and whoever awaits is still waiting.
  await pause();
  expect(screen.getByText("版 1")).toBeInTheDocument();
  expect(screen.queryByText("読み込み中")).toBeNull();
  expect(refreshed.settled).toBe(false);
  await act(async () => { mockServer.requests[0].answer(); });
  expect(screen.getByText("版 2")).toBeInTheDocument();
  expect(refreshed).toEqual({ settled: true, rejected: false });
  // A read that was answered is never reported as missing.
  expect(screen.queryByText(STALE)).toBeNull();
});

test.each([
  ["fails", new TypeError("NetworkError when attempting to fetch resource.")],
  ["is aborted by a navigation", new DOMException("The operation was aborted.", "AbortError")],
  ["is refused by the server (ended session, new deployment, unforwarded host)", new Error("An unexpected response was received from the server.")],
])("a refresh whose request %s settles without rejecting, the route stays as it was, and the user is told", async (_what, error) => {
  const reload = jest.spyOn(browserNavigation, "reload").mockImplementation(() => undefined);
  mount();
  expect(screen.queryByText(STALE)).toBeNull();
  let refreshed = watch(Promise.resolve());
  await act(async () => { refreshed = watch(live.refresh()); });
  expect(refreshed.settled).toBe(false);
  // Nothing is reported while the read is still under way.
  expect(screen.queryByText(STALE)).toBeNull();
  await act(async () => { mockServer.requests[0].fail(error); });
  await pause();
  expect(refreshed).toEqual({ settled: true, rejected: false });
  expect(screen.getByText("版 1")).toBeInTheDocument();
  // The island is not handed the failure and nothing navigates by itself, but the page says
  // that what it shows was not read again, without claiming that anything was saved (the
  // route is also read again after a save was refused), and offers the document load that
  // does not depend on the request that failed.
  expect(unhandled).toEqual([]);
  expect(reload).not.toHaveBeenCalled();
  const notice = screen.getByRole("alert");
  expect(notice).toHaveTextContent(STALE);
  expect(notice).toHaveTextContent("最新ではない可能性があります");
  expect(notice).toHaveTextContent("保存できたかどうかを示すものではありません");
  expect(notice).not.toHaveTextContent(/保存済み|保存しました|残っています/);
  // Brought into view once, and the focus stays where the user was.
  expect(scrolled).toHaveBeenCalledTimes(1);
  expect(notice).not.toContainElement(document.activeElement as HTMLElement | null);
  fireEvent.click(screen.getByRole("button", { name: "ページを再読込み" }));
  expect(reload).toHaveBeenCalledTimes(1);
  // The next refresh works as usual, and the read it brings takes the notice away.
  let again = watch(Promise.resolve());
  await act(async () => { again = watch(live.refresh()); });
  expect(screen.getByText(STALE)).toBeInTheDocument();
  await act(async () => { mockServer.requests[1].answer(); });
  expect(again).toEqual({ settled: true, rejected: false });
  expect(screen.getByText("版 2")).toBeInTheDocument();
  expect(screen.queryByText(STALE)).toBeNull();
});

test("a refresh that cannot be sent at all settles without rejecting, and the user is told", async () => {
  mount(() => { throw new Error("no connection to the server"); });
  let refreshed = watch(Promise.resolve());
  await act(async () => { refreshed = watch(live.refresh()); });
  expect(refreshed).toEqual({ settled: true, rejected: false });
  expect(screen.getByText("版 1")).toBeInTheDocument();
  expect(unhandled).toEqual([]);
  expect(screen.getByRole("alert")).toHaveTextContent(STALE);
});

test("each refresh waits for its own read; a later one does not settle with an earlier one", async () => {
  mount();
  let first = watch(Promise.resolve());
  let second = watch(Promise.resolve());
  await act(async () => { first = watch(live.refresh()); });
  await act(async () => { mockServer.requests[0].answer(); });
  expect(first.settled).toBe(true);
  await act(async () => { second = watch(live.refresh()); });
  expect(second.settled).toBe(false);
  await act(async () => { mockServer.requests[1].answer(); });
  expect(second.settled).toBe(true);
  expect(screen.getByText("版 3")).toBeInTheDocument();
  expect(mockServer.calls).toBe(2);
});

test("two reads asked for one after the other: the second is sent when the first has settled, and both settle when the second read is shown", async () => {
  mount();
  let first = watch(Promise.resolve());
  let second = watch(Promise.resolve());
  await act(async () => { first = watch(live.refresh()); });
  await act(async () => { second = watch(live.refresh()); });
  expect(mockServer.calls).toBe(2);
  expect(mockServer.requests).toHaveLength(1);
  await act(async () => { mockServer.requests[0].answer(); });
  await pause();
  // The router shows nothing in between: neither read is on screen, and nobody is told
  // that theirs is.
  expect(mockServer.requests).toHaveLength(2);
  expect(screen.getByText("版 1")).toBeInTheDocument();
  expect([first.settled, second.settled]).toEqual([false, false]);
  await act(async () => { mockServer.requests[1].answer(); });
  expect(screen.getByText("版 3")).toBeInTheDocument();
  expect(first).toEqual({ settled: true, rejected: false });
  expect(second).toEqual({ settled: true, rejected: false });
  expect(screen.queryByText(STALE)).toBeNull();
});

test("two reads one after the other: when the first fails and the second is answered, nothing is reported at any moment", async () => {
  mount();
  let first = watch(Promise.resolve());
  let second = watch(Promise.resolve());
  await act(async () => { first = watch(live.refresh()); });
  await act(async () => { second = watch(live.refresh()); });
  await act(async () => { mockServer.requests[0].fail(new TypeError("Load failed")); });
  await pause();
  // The later read is still to come: no notice in the meantime.
  expect(screen.queryByText(STALE)).toBeNull();
  expect(second.settled).toBe(false);
  await act(async () => { mockServer.requests[1].answer(); });
  expect(screen.getByText("版 2")).toBeInTheDocument();
  expect(first).toEqual({ settled: true, rejected: false });
  expect(second).toEqual({ settled: true, rejected: false });
  expect(unhandled).toEqual([]);
  // The later read was answered: what is on screen is what the server last read.
  expect(screen.queryByText(STALE)).toBeNull();
});

test("two changes one after the other: when the first read is answered and the second fails, the user is told", async () => {
  // The first answer may have been read before the second change was saved. It appears
  // only when the second request has settled, with a new `observedAt`: the failure has to
  // mark that read, not the one both requests were sent from.
  mount();
  let first = watch(Promise.resolve());
  let second = watch(Promise.resolve());
  await act(async () => { first = watch(live.refresh()); });
  await act(async () => { second = watch(live.refresh()); });
  await act(async () => { mockServer.requests[0].answer(); });
  await pause();
  expect(screen.queryByText(STALE)).toBeNull();
  await act(async () => { mockServer.requests[1].fail(new TypeError("Load failed")); });
  await pause();
  expect(screen.getByText("版 2")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(STALE);
  expect(first).toEqual({ settled: true, rejected: false });
  expect(second).toEqual({ settled: true, rejected: false });
  // The next read that is answered takes the notice away.
  await act(async () => { void live.refresh(); });
  await act(async () => { mockServer.requests[2].answer(); });
  expect(screen.getByText("版 3")).toBeInTheDocument();
  expect(screen.queryByText(STALE)).toBeNull();
});

test("a read that fails just after the document began to leave is the browser cancelling it, and is not reported", async () => {
  mount();
  let refreshed = watch(Promise.resolve());
  await act(async () => { refreshed = watch(live.refresh()); });
  // Firefox and WebKit fail the page's requests as soon as a document navigation starts.
  act(() => { window.dispatchEvent(new Event("beforeunload")); });
  await act(async () => { mockServer.requests[0].fail(new DOMException("The operation was aborted.", "AbortError")); });
  await pause();
  expect(refreshed).toEqual({ settled: true, rejected: false });
  expect(screen.queryByText(STALE)).toBeNull();
  expect(scrolled).not.toHaveBeenCalled();
  expect(unhandled).toEqual([]);
});

test("a read that fails long after a navigation that did not happen is reported", async () => {
  const now = jest.spyOn(Date, "now");
  now.mockReturnValue(1_000_000);
  mount();
  act(() => { window.dispatchEvent(new Event("beforeunload")); });
  // The document stayed (a download, an answer without content), and time went by.
  now.mockReturnValue(1_000_000 + 1_500);
  await act(async () => { void live.refresh(); });
  await act(async () => { mockServer.requests[0].fail(new TypeError("Load failed")); });
  await pause();
  expect(screen.getByRole("alert")).toHaveTextContent(STALE);
});

test("a route the server has read since is not called stale: a navigation inside the workspace takes the notice away", async () => {
  mount();
  await act(async () => { void live.refresh(); });
  await act(async () => { mockServer.requests[0].fail(new TypeError("Load failed")); });
  await pause();
  expect(screen.getByRole("alert")).toHaveTextContent(STALE);
  // The same route is rendered by the server again (another selection in its address).
  await navigate();
  expect(screen.getByText("版 2")).toBeInTheDocument();
  expect(screen.queryByText(STALE)).toBeNull();
});

test("a request that fails after a navigation brought another read is still reported, for the read that is on screen then", async () => {
  // The browser cannot tell whether the read the navigation brought is newer than the
  // change the failed request was to show, so the read on screen is marked.
  mount();
  let refreshed = watch(Promise.resolve());
  await act(async () => { refreshed = watch(live.refresh()); });
  await navigate();
  expect(screen.getByText("版 2")).toBeInTheDocument();
  expect(screen.queryByText(STALE)).toBeNull();
  await act(async () => { mockServer.requests[0].fail(new TypeError("Load failed")); });
  await pause();
  expect(screen.getByText("版 2")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(STALE);
  expect(refreshed).toEqual({ settled: true, rejected: false });
  expect(unhandled).toEqual([]);
  // And the next read that is shown takes it away again.
  await navigate();
  expect(screen.queryByText(STALE)).toBeNull();
});

test("a refresh that changes nothing on screen still settles", async () => {
  let calls = 0;
  mount(async () => { calls += 1; }, <p>変わらない内容</p>);
  let refreshed = watch(Promise.resolve());
  await act(async () => { refreshed = watch(live.refresh()); });
  expect(calls).toBe(1);
  expect(refreshed).toEqual({ settled: true, rejected: false });
  expect(screen.queryByText(STALE)).toBeNull();
});

test("leaving the route settles a refresh that is still waiting, and it never rejects", async () => {
  const view = mount();
  let refreshed = watch(Promise.resolve());
  await act(async () => { refreshed = watch(live.refresh()); });
  expect(refreshed.settled).toBe(false);
  await act(async () => { view.unmount(); });
  expect(refreshed).toEqual({ settled: true, rejected: false });
  // The request that was under way fails afterwards (its page is gone): nothing to report.
  await act(async () => { mockServer.requests[0].fail(new TypeError("Load failed")); });
  await pause();
  expect(unhandled).toEqual([]);
});

test("the function is stable although the server hands over the action with every render, and the newest one is used", async () => {
  const view = mount();
  const before = live.refresh;
  await act(async () => { void live.refresh(); });
  await act(async () => { mockServer.requests[0].answer(); });
  expect(live.refresh).toBe(before);
  let newer = 0;
  view.rerender(tree(async () => { newer += 1; }));
  expect(live.refresh).toBe(before);
  let refreshed = watch(Promise.resolve());
  await act(async () => { refreshed = watch(live.refresh()); });
  expect(newer).toBe(1);
  expect(mockServer.calls).toBe(1);
  expect(refreshed).toEqual({ settled: true, rejected: false });
});
