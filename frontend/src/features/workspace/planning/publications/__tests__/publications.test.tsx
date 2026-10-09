import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { WorkspaceNotification } from "@/ideal/types";
import { browserNavigation } from "@/lib/browserNavigation";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute, type RouteContext } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

let replaced: jest.SpyInstance;
beforeEach(() => {
  replaced = jest.spyOn(browserNavigation, "replaceWithFlash").mockImplementation(() => undefined);
  jest.spyOn(browserNavigation, "pathAndSearch").mockReturnValue("/workspace/plan/publications?scope=synthetic%2Fclinical-pharmacy");
});
afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
type Data = { notices: WorkspaceNotification[] | null };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const notice: WorkspaceNotification = { event_id: "n1", category: "schedule", kind: "schedule.published", publication_id: "synthetic-publication-12", version: 12, read: false, created_at: "2026-10-12T07:42:00+09:00" };

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

function tree(data: Data, answer: (call: Call) => unknown, over: Partial<RouteContext> = {}) {
  const ctx = { ...syntheticContext("LEADER"), ...over };
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  return { calls, refresh, node: <LiveProvider live={live}><View data={data} ctx={ctx} /></LiveProvider> };
}
async function mount(data: Data, answer: (call: Call) => unknown = () => ({}), over: Partial<RouteContext> = {}) {
  const { node, ...rest } = tree(data, answer, over);
  await act(async () => { render(node); });
  return rest;
}

test("the route shows the publications and the notifications of its context and reads nothing", async () => {
  const { calls, client } = api(() => { throw new Error("nothing is read"); });
  expect(await readRoute(route, client, { ...syntheticContext("ADMIN"), notifications: [notice] })).toEqual({ kind: "ready", partial: [], data: { notices: [notice] } });
  expect(calls).toEqual([]);
  expect(route.names).toBe("none");
});

test("notifications the context could not read are not shown as none, and the publications stay usable", async () => {
  const { calls, client } = api(() => { throw new Error("nothing is read"); });
  // The context reports the failed read itself (resource 通知); the route claims nothing.
  const state = await readRoute(route, client, { ...syntheticContext("ADMIN"), notifications: [], notificationsRead: false });
  expect(state).toEqual({ kind: "ready", partial: [], data: { notices: null } });
  expect(calls).toEqual([]);
  await mount({ notices: null });
  expect(screen.getByText("公開通知を確認できません。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "公開を取り消す" })).toBeInTheDocument();
});

test("the showcase shows the publication and its notice; empty lists say so", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="plan" view="publications" role="LEADER" />);
  const article = (await screen.findByText("公開版 v12")).closest("article")!;
  expect(article).toHaveTextContent("公開版 v12公開時に検証済み2026年10月1日（木）〜10月31日（土） · 勤務 2件");
  // The synthetic notification carries the kind the API sends (schedule.published).
  expect(screen.getByText("勤務表を公開").closest("li")).toHaveTextContent("公開版 v12 · あなたは未確認");
  // The process of the plan is the shell's navigation: the view repeats none.
  expect(screen.queryByRole("list", { name: "計画の工程" })).toBeNull();
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="plan" view="publications" role="LEADER" state="empty" />);
  expect(await screen.findByText("公開通知はありません。")).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a scope without publications says so; a publication to check again is marked", async () => {
  const view = await mount({ notices: [] }, () => ({}), { publications: [], publication: null });
  expect(screen.getByText("公開版はありません。")).toBeInTheDocument();
  expect(view.calls).toEqual([]);
  const ctx = syntheticContext("LEADER");
  await mount({ notices: [{ ...notice, read: true, version: null }] }, () => ({}), { publications: [{ ...ctx.publications[0], validation_status: "revalidation_required" }] });
  expect(screen.getByText("再検証が必要")).toBeInTheDocument();
  expect(screen.getByText("公開版 — · あなたは確認済み")).toBeInTheDocument();
});

test("a notice of a publication or of an approved case prints its publication's version; a cancellation's number is the head's, and the other kinds carry no publication", async () => {
  // The shapes the server sends (routers/planning.py, notifications): an approval carries
  // the publication it made (application/ideal_workflows.py, approve_change_case); a
  // recommendation carries neither a publication nor a version.
  await mount({ notices: [notice, { ...notice, event_id: "n2", kind: "schedule.cancelled", version: 13 },
    { ...notice, event_id: "n3", kind: "change.approved", category: "change", publication_id: "synthetic-publication-13", version: 13, read: true },
    { ...notice, event_id: "n4", kind: "change.recommended", category: "change", publication_id: null, version: null, read: true }] });
  expect(Array.from(document.querySelectorAll(".ideal-timeline li p")).map((line) => line.textContent)).toEqual(["公開版 v12 · あなたは未確認", "取り消された公開版 · あなたは未確認", "公開版 v13 · あなたは確認済み", "あなたは確認済み"]);
});

test("the cancel button is offered only once it can answer", () => {
  const html = renderToString(tree({ notices: [] }, () => ({})).node);
  expect(html).toContain("公開時に検証済み");
  expect(html).not.toContain("公開を取り消す");
});

test("cancelling is confirmed in place with a reason, against the version on screen; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  const { calls, refresh } = await mount({ notices: [] }, () => { if (++attempts === 1) throw new PlanningError(503, "down"); return { publication_id: "synthetic-publication-12", version: 12 }; });
  const article = screen.getByText("公開版 v12").closest("article")!;
  fireEvent.click(within(article).getByRole("button", { name: "公開を取り消す" }));
  const surface = article.querySelector(".ideal-confirm") as HTMLElement;
  expect(within(surface).getByRole("heading", { level: 3, name: "公開取消の確認" })).toBeInTheDocument();
  expect(surface).toHaveTextContent("勤務の再調整と関係者への通知が必要です。取消前の版と監査記録は残ります。");
  // What cancelling does is said before the button, in the zone itself.
  expect(within(within(article).getByRole("list", { name: "取消で起きること" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "この期間は、公開中の勤務表がない状態になります。前の版には戻りません。", "この版で確保していた休暇の予約は解除されます。", "この版に勤務が入っていた職員に、取消の通知が届きます。",
    "取り消した版と監査の記録は残ります。取消は元に戻せません。もう一度公開するには、勤務案を確認して公開し直します。",
  ]);
  const confirm = within(surface).getByRole("button", { name: "理由を記録して公開取消" });
  expect(confirm).toBeDisabled();
  // While the reason is empty, the sentence under its field is the button's description too.
  expect(confirm).toHaveAccessibleDescription("理由を入力すると、取消を実行できます。");
  fireEvent.change(within(surface).getByLabelText("理由"), { target: { value: "  " } });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(surface).getByLabelText("理由"), { target: { value: "勤務の再調整" } });
  expect(confirm).not.toHaveAttribute("aria-describedby");
  fireEvent.click(confirm);
  expect(await screen.findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(replaced).not.toHaveBeenCalled();
  // The surface and the reason stay, so the same content can be sent again.
  fireEvent.click(within(surface).getByRole("button", { name: "理由を記録して公開取消" }));
  await waitFor(() => expect(replaced).toHaveBeenCalledTimes(1));
  expect(replaced).toHaveBeenCalledWith("/workspace/plan/publications?scope=synthetic%2Fclinical-pharmacy", "publication-cancelled");
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /publications/synthetic-publication-12/cancel?${SCOPE}`));
  expect(calls[0].body).toEqual({ expected_version: 12, reason: "勤務の再調整", idempotency_key: expect.any(String) });
  expect(calls[1].body).toEqual(calls[0].body);
  expect(article.querySelector(".ideal-confirm")).toBeNull();
  // Replacing the document reads the route again; no second read is started beside it.
  expect(refresh).not.toHaveBeenCalled();
});

test("a publication that moved on, or a refusal, is shown; backing out closes the surface", async () => {
  let status = 409;
  const { calls } = await mount({ notices: [] }, () => { throw new PlanningError(status, "理由は1000字以内です。"); });
  const article = screen.getByText("公開版 v12").closest("article")!;
  fireEvent.click(within(article).getByRole("button", { name: "公開を取り消す" }));
  fireEvent.change(within(article).getByLabelText("理由"), { target: { value: "勤務の再調整" } });
  fireEvent.click(within(article).getByRole("button", { name: "理由を記録して公開取消" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("新しい変更があります");
  status = 422;
  fireEvent.click(within(article).getByRole("button", { name: "理由を記録して公開取消" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("サーバーの検証で止まりました理由は1000字以内です。"));
  expect(replaced).not.toHaveBeenCalled();
  // A definite refusal ends the attempt: the next one has a new key.
  expect((calls[1].body as { idempotency_key: string }).idempotency_key).not.toBe((calls[0].body as { idempotency_key: string }).idempotency_key);
  fireEvent.click(within(article).getByRole("button", { name: "やめる" }));
  expect(article.querySelector(".ideal-confirm")).toBeNull();
  fireEvent.click(within(article).getByRole("button", { name: "公開を取り消す" }));
  expect(within(article).getByLabelText("理由")).toHaveValue("");
});

test("a publication whose period cannot be read is not cancelled from here: the surface says why and its button stays disabled", async () => {
  const ctx = syntheticContext("LEADER");
  const { calls } = await mount({ notices: [] }, () => ({}), { publications: [{ ...ctx.publications[0], period: "not-a-date|2026-11-01T00:00:00+09:00" }] });
  const article = screen.getByText("公開版 v12").closest("article")!;
  fireEvent.click(within(article).getByRole("button", { name: "公開を取り消す" }));
  const surface = article.querySelector(".ideal-confirm") as HTMLElement;
  expect(surface).toHaveTextContent("この公開版の期間を読み取れません。");
  fireEvent.change(within(surface).getByLabelText("理由"), { target: { value: "勤務の再調整" } });
  expect(within(surface).getByRole("button", { name: "理由を記録して公開取消" })).toBeDisabled();
  expect(calls).toEqual([]);
});
