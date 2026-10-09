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
  ({ event_id: "n1", kind: "schedule.published", category: "schedule", publication_id: "pub-1", version: 12, created_at: "2026-10-12T07:42:00+09:00", read: false, ...over });

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
  // What happened, as a sentence; the version as the rest of the workspace writes it; and
  // the way to the schedule of that publication, named with its own month.
  expect(screen.getByText("勤務表が公開されました")).toBeInTheDocument();
  expect(screen.getByText("公開版 v12。", { exact: false })).toBeInTheDocument();
  expect(Array.from(document.querySelectorAll(".ideal-v3-notifications a")).map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["この版の勤務表を開く", "/workspace/schedule?period=2026-10&publication=synthetic-publication-12"]]);
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="settings" view="notifications" role="PHARMACIST" state="empty" />);
  expect(await screen.findByText("未確認の通知はありません。")).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a read notification offers no button; one without a publication shows its category in words", () => {
  mount([notice({ read: true }), notice({ event_id: "n2", publication_id: null, category: "change" })], () => ({ read: true }));
  expect(screen.getAllByRole("button", { name: "確認しました" })).toHaveLength(1);
  expect(screen.getByText("欠勤・交換")).toBeInTheDocument();
  expect(screen.queryByText("change")).toBeNull();
  // What is still to confirm is counted in the header; a confirmed one says so.
  // The count claims only the rows shown: the server lists the latest hundred of the scope.
  expect(screen.getByText("表示中の未確認 1件", { selector: ".ideal-pill" })).toBeInTheDocument();
  expect(screen.getAllByText("確認済み")).toHaveLength(1);
});

test("a notification leads to the schedule only for a publication the scope still holds, named with that publication's month", () => {
  const held = ctx.publications[0];
  mount([notice({ publication_id: held.publication_id, version: held.version }), notice({ event_id: "n2", publication_id: "pub-replaced", version: 11 })], () => ({}));
  const links = screen.getAllByRole("link", { name: "この版の勤務表を開く" });
  // The link names the publication and its own month: never the month of the URL on screen.
  expect(links.map((link) => link.getAttribute("href"))).toEqual([`/workspace/schedule?period=${held.period.slice(0, 7)}&publication=${held.publication_id}`]);
  // A publication the context does not hold (replaced or cancelled) has no link, and is
  // said not to be the current one.
  expect(screen.getByText("公開版 v11。この版は、いまの公開版ではありません（新しい版が公開されたか、取り消されました）。いまの公開版は「勤務表」で確認できます。")).toBeInTheDocument();
});

test("a notice of a cancellation prints no version: its number is the head's after the cancel, not a publication's", () => {
  const held = ctx.publications[0];
  // Even with the identifier of a publication the context holds, a cancellation has no link.
  mount([notice({ kind: "schedule.cancelled", publication_id: held.publication_id, version: 13 })], () => ({}));
  const cancelled = screen.getByText("公開版が取り消されました").closest("li")!;
  expect(cancelled).toHaveTextContent("この通知の公開版は取り消されました。いまの公開版は「勤務表」で確認できます（その期間に、公開中の勤務表がないこともあります）。");
  expect(cancelled).not.toHaveTextContent(/公開版 v|13/);
  expect(screen.queryByRole("link", { name: "この版の勤務表を開く" })).toBeNull();
});

test("a notice of an approved case names the publication the approval made and leads to its schedule", () => {
  const held = ctx.publications[0];
  // What the server sends (application/ideal_workflows.py, approve_change_case): the new
  // publication's identifier and version. A person whose duty the approval took away gets
  // this notice only, so it is their way to the changed schedule.
  mount([notice({ kind: "change.approved", category: "change", publication_id: held.publication_id, version: held.version }),
    notice({ event_id: "n2", kind: "change.approved", category: "change", publication_id: "pub-replaced", version: 11 }),
    // The other kinds of a case carry no publication (their payload has neither field).
    notice({ event_id: "n3", kind: "change.recommended", category: "change", publication_id: null, version: null }),
    notice({ event_id: "n4", kind: "change.rejected", category: "change", publication_id: null, version: null })], () => ({}));
  const [current, replaced] = screen.getAllByText("欠勤・交換のケースが承認されました").map((line) => line.closest("li")!);
  expect(current).toHaveTextContent(`公開版 v${held.version}。この版の勤務表を開く`);
  expect(screen.getAllByRole("link", { name: "この版の勤務表を開く" }).map((link) => [link.closest("li"), link.getAttribute("href")])).toEqual([[current, `/workspace/schedule?period=${held.period.slice(0, 7)}&publication=${held.publication_id}`]]);
  expect(replaced).toHaveTextContent("公開版 v11。この版は、いまの公開版ではありません（新しい版が公開されたか、取り消されました）。いまの公開版は「勤務表」で確認できます。");
  for (const text of ["欠勤・交換のケースが、別の担当者の承認待ちになりました", "欠勤・交換のケースが却下されました"]) expect(screen.getByText(text).closest("li")).not.toHaveTextContent(/公開版/);
});

test("a recorded kind is named in words; a kind or a category this code does not know is not shown as a code", () => {
  mount([notice({ kind: "schedule.published", read: true }), notice({ event_id: "n2", kind: "NOT_A_KIND", publication_id: null, category: "other-area" as never, read: true }),
    // A recorded kind the server does not send as a notification today is still named in words.
    notice({ event_id: "n3", kind: "membership.linked", publication_id: null, category: "membership" as never, read: true }), notice({ event_id: "n4", kind: "change.recommended", publication_id: null, category: "change", read: true })], () => ({}));
  expect(screen.getByText("勤務表が公開されました")).toBeInTheDocument();
  expect(screen.getByText("本人アカウントを紐付け")).toBeInTheDocument();
  expect(screen.getByText("欠勤・交換のケースが、別の担当者の承認待ちになりました")).toBeInTheDocument();
  expect(screen.getAllByText("未対応の値")).toHaveLength(2);
  expect(document.body).not.toHaveTextContent(/schedule\.published|NOT_A_KIND|other-area|membership\.linked/);
  expect(screen.getByText("表示中の通知はすべて確認済み", { selector: ".ideal-pill" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "確認しました" })).toBeNull();
});

test("a notification whose time cannot be read is listed with the others; the route is not lost to it", () => {
  mount([notice({ read: true }), notice({ event_id: "n2", created_at: "未定" as never, read: true }), notice({ event_id: "n3", created_at: undefined as never, read: true })], () => ({}));
  expect(Array.from(document.querySelectorAll("time")).map((time) => time.textContent)).toEqual(["10/12 07:42", "日時未確認", "日時未確認"]);
  expect(screen.getAllByText("勤務表が公開されました")).toHaveLength(3);
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
