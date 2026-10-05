import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { WorkspaceNotification } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const ctx = syntheticContext("PHARMACIST");
const notice = (over: Partial<WorkspaceNotification>): WorkspaceNotification =>
  ({ event_id: "n1", kind: "公開版が更新されました", category: "schedule", publication_id: "pub-1", version: 12, created_at: "2026-10-12T07:42:00+09:00", read: false, ...over });

/** The real typed client over a recording transport, so paths and bodies are the real ones. */
function api(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = createIdealClient("test", async <T,>(path: string, method = "GET", body?: unknown) => {
    const call = { method, path, body };
    calls.push(call);
    return answer(call) as T;
  });
  return { calls, client };
}

function mount(data: WorkspaceNotification[] | null, answer: (call: Call) => unknown) {
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const View = route.View;
  render(<LiveProvider live={liveFrom(ctx, { client, mutate: createMutator("test"), refresh })}><View data={data} ctx={ctx} /></LiveProvider>);
  return { calls, refresh };
}

test("the route shows the notifications of its context and reads nothing, without a roster", async () => {
  const { calls, client } = api(() => { throw new Error("nothing is read"); });
  const given = [notice({}), notice({ event_id: "n2", read: true })];
  expect(await readRoute(route, client, { ...ctx, notifications: given })).toEqual({ kind: "ready", partial: [], data: given });
  expect(calls).toEqual([]);
  expect(route.names).toBe("none");
});

test("notifications the context could not read are not shown as none", async () => {
  const { calls, client } = api(() => { throw new Error("nothing is read"); });
  // The context reports the failed read itself (resource 通知); the route claims nothing.
  const state = await readRoute(route, client, { ...ctx, notifications: [], notificationsRead: false });
  expect(state).toEqual({ kind: "ready", partial: [], data: null });
  expect(calls).toEqual([]);
  mount(null, () => ({}));
  expect(screen.getByText("通知を確認できません。")).toBeInTheDocument();
  expect(screen.queryByText("未確認の通知はありません。")).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "通知" })).toBeInTheDocument();
});

test("the showcase shows the notifications, and the route's own words when there are none", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="settings" view="notifications" role="PHARMACIST" />);
  expect(await screen.findByRole("button", { name: "確認しました" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "通知" })).toBeInTheDocument();
  expect(screen.getByText("公開版 12")).toBeInTheDocument();
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="settings" view="notifications" role="PHARMACIST" state="empty" />);
  expect(await screen.findByText("未確認の通知はありません。")).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a read notification offers no button; one without a publication shows its category", () => {
  mount([notice({ read: true }), notice({ event_id: "n2", publication_id: null, category: "change" })], () => ({ read: true }));
  expect(screen.getAllByRole("button", { name: "確認しました" })).toHaveLength(1);
  expect(screen.getByText("change")).toBeInTheDocument();
});

test("confirming sends the read request for that notification, then reads the route again", async () => {
  const { calls, refresh } = mount([notice({})], () => ({ read: true }));
  fireEvent.click(screen.getByRole("button", { name: "確認しました" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ method: "POST", path: `/notifications/n1/read?${SCOPE}`, body: undefined }]);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a refused confirmation is shown beside the button, and the route is not read again", async () => {
  const { refresh } = mount([notice({})], () => { throw new PlanningError(409, "stale"); });
  fireEvent.click(screen.getByRole("button", { name: "確認しました" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "確認しました" })).toBeInTheDocument();
});
