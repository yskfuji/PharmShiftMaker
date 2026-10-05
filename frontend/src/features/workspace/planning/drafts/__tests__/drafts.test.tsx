import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient, type Draft } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { browserNavigation } from "@/lib/browserNavigation";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { DraftSource } from "../DraftsView";
import route from "../route";

let mockQuery: URLSearchParams | null = null;
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useSearchParams: () => mockQuery }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

let replaced: jest.SpyInstance;
let pathname: jest.SpyInstance;
beforeEach(() => {
  mockQuery = new URLSearchParams("draft=d1");
  replaced = jest.spyOn(browserNavigation, "replaceWithFlash").mockImplementation(() => undefined);
  pathname = jest.spyOn(browserNavigation, "pathname").mockReturnValue("/workspace/plan/drafts");
});
afterEach(() => { jest.restoreAllMocks(); mockQuery = null; });

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const candidates = [
  { duty_id: "a", person_id: "synthetic-pharmacist", kind: "日勤", task: "病棟", location: "本館", start: "2026-10-12T08:30:00+09:00", end: "2026-10-12T17:30:00+09:00" },
  { duty_id: "b", person_id: "synthetic-leader", kind: "遅番", task: "調剤", location: "薬剤部", start: "2026-10-12T10:30:00+09:00", end: "2026-10-12T19:30:00+09:00" },
];
const draft = (over: Partial<Draft> = {}): Draft => ({ draft_id: "d1", input_hash: "hash-12", version: 3, review_hash: null, status: "DRAFT", proposal: { duty_ids: ["a"], leave_ids: ["l1"] }, ...over });
/** What the route's server read hands to the view: the input's duties and the plan of the URL. */
const source: DraftSource = { candidates, inputRevision: 12, inputHash: "hash-12", publicationVersion: 7, period: "2026-10", draftId: "d1", draft: { data: draft(), problem: null } };
const input = { input_hash: "hash-12", input_revision: 12, publication_version: 7, stale: false, snapshot: { people: [], candidates, period: { start: "2026-10-01T00:00:00+09:00", end: "2026-11-01T00:00:00+09:00" } } };
const chosen = (draftIds: string[]) => ({ ...syntheticContext("ADMIN"), selectedDraftIds: draftIds });

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

async function mount(answer: (call: Call) => unknown, data: DraftSource = source) {
  const ctx = syntheticContext("LEADER");
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  await act(async () => { render(<LiveProvider live={live}><View data={data} ctx={ctx} /></LiveProvider>); });
  return { calls, refresh };
}
const box = (dutyId: string) => screen.getByRole("checkbox", { name: `${dutyId}を採用` });
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const changes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");
const reads = (calls: Call[]) => calls.filter((call) => call.method === "GET");

test("the route reads the input the plan was made from and the plan the URL names, and names the people of its duties", async () => {
  const { calls, client } = api((call) => call.path.startsWith("/drafts/") ? draft() : input);
  expect(await readRoute(route, client, chosen(["d1", "d2"]))).toEqual({ kind: "ready", partial: [], data: source });
  expect(calls).toEqual([
    { method: "GET", path: `/inputs/latest?${SCOPE}`, body: undefined },
    { method: "GET", path: `/drafts/d1?${SCOPE}`, body: undefined },
  ]);
  expect(route.names).toBe("planning");
});

test("the showcase shows a synthetic plan with names; with no plan chosen the route says so itself", async () => {
  mockQuery = null;
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="plan" view="drafts" role="LEADER" />);
  const table = await screen.findByRole("region", { name: "勤務案の割当" });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getAllByRole("row")[1]).toHaveTextContent("高橋 葵2026-10-12T08:30:00+09:00〜2026-10-12T17:30:00+09:00病棟・本館");
  expect(screen.getByText("勤務案 版1")).toBeInTheDocument();
  expect(await screen.findByText("未検証")).toBeInTheDocument();
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="plan" view="drafts" role="LEADER" state="empty" />);
  expect(await screen.findByRole("heading", { level: 2, name: "確認する案が指定されていません" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "勤務案の割当" })).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("without a plan in the URL only the input is read, and the browser reads nothing", async () => {
  const server = api(() => input);
  const state = await readRoute(route, server.client, chosen([]));
  expect(state).toEqual({ kind: "ready", partial: [], data: { ...source, draftId: null, draft: null } });
  expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /inputs/latest?${SCOPE}`]);
  const { calls } = await mount(() => draft(), { ...source, draftId: null, draft: null });
  expect(screen.getByRole("heading", { level: 2, name: "確認する案が指定されていません" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "案比較へ" })).toHaveAttribute("href", "/workspace/plan/compare");
  expect(calls).toEqual([]);
});

test("the plan the server read is shown without another read", async () => {
  const { calls } = await mount(() => draft());
  expect(screen.getByRole("heading", { level: 2, name: "割当を確認・編集" })).toBeInTheDocument();
  expect(screen.getByText("勤務案 版3")).toBeInTheDocument();
  expect(box("a")).toBeChecked();
  expect(box("b")).not.toBeChecked();
  expect(screen.getByText("未検証")).toBeInTheDocument();
  expect(calls).toEqual([]);
});

test("a plan that cannot be read is a problem of its panel, and can be read again", async () => {
  const refused = api((call) => { if (call.path.startsWith("/drafts/")) throw new PlanningError(404, "Not Found"); return input; });
  const state = await readRoute(route, refused.client, chosen(["d1"]));
  // Not the route's problem: the frame and the steps stay.
  expect(state).toMatchObject({ kind: "ready", partial: [], data: { draftId: "d1", draft: { data: null, problem: { kind: "notFound", code: "404", title: "見つかりません" } } } });
  if (state.kind !== "ready") return;
  const { calls } = await mount(() => draft(), state.data);
  expect(screen.getByRole("alert")).toHaveTextContent("見つかりません");
  expect(screen.getByRole("list", { name: "計画の工程" })).toBeInTheDocument();
  expect(calls).toEqual([]);
  fireEvent.click(within(screen.getByRole("alert")).getByRole("button"));
  expect(await screen.findByRole("heading", { level: 2, name: "割当を確認・編集" })).toBeInTheDocument();
  // Trying again is the only read the browser makes.
  expect(calls).toEqual([{ method: "GET", path: `/drafts/d1?${SCOPE}`, body: undefined }]);
  await waitFor(() => expect(box("a")).toBeChecked());
  expect(box("b")).not.toBeChecked();
});

test("an expired session, or an input that cannot be read, is the route's problem", async () => {
  const expired = api((call) => { if (call.path.startsWith("/drafts/")) throw new PlanningError(401, "expired"); return input; });
  expect(await readRoute(route, expired.client, chosen(["d1"]))).toEqual({ kind: "problem", status: 401, detail: "expired" });
  const down = api((call) => { if (call.path.startsWith("/inputs/")) throw new PlanningError(503, "down"); return draft(); });
  expect(await readRoute(route, down.client, chosen(["d1"]))).toEqual({ kind: "problem", status: 503, detail: "down" });
});

test("saving sends the ticked duties against the version read; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  let stored = draft();
  const { calls, refresh } = await mount((call) => {
    if (call.method !== "PUT") return stored;
    if (++attempts === 1) throw new PlanningError(503, "down");
    stored = draft({ version: 4, proposal: { duty_ids: ["a", "b"], leave_ids: ["l1"] } });
    return stored;
  });
  await screen.findByRole("heading", { level: 2, name: "割当を確認・編集" });
  expect(screen.getByRole("button", { name: "編集を保存" })).toBeDisabled();
  fireEvent.click(box("b"));
  expect(screen.getByText("未保存")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "サーバーで再検証" })).toBeDisabled();
  press("編集を保存");
  expect(await screen.findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(box("b")).toBeChecked();
  press("編集を保存");
  await waitFor(() => expect(screen.getAllByRole("status").map((item) => item.textContent)).toContain("編集を保存しました。検証は解除されています。"));
  expect(changes(calls).map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`PUT /drafts/d1?${SCOPE}`));
  // Fields of the proposal that are not edited here are sent back as they were read.
  expect(changes(calls)[0].body).toEqual({ version: 3, proposal: { duty_ids: ["a", "b"], leave_ids: ["l1"] }, idempotency_key: expect.any(String) });
  expect(changes(calls)[1].body).toEqual(changes(calls)[0].body);
  // After the save the island reads its plan again by itself, once; the route is not read.
  expect(reads(calls).map((call) => call.path)).toEqual([`/drafts/d1?${SCOPE}`]);
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByText("勤務案 版4")).toBeInTheDocument();
  expect(screen.getByText("未検証")).toBeInTheDocument();
});

test("a conflict shows the three plans and keeps the edit; nothing is rebased silently", async () => {
  let stored = draft();
  let conflict = true;
  const { calls } = await mount((call) => {
    if (call.method === "PUT") { if (conflict) { conflict = false; stored = draft({ version: 4, proposal: { duty_ids: [] } }); throw new PlanningError(409, "moved"); } stored = draft({ version: 5, proposal: (call.body as Draft).proposal }); }
    return stored;
  });
  await screen.findByRole("heading", { level: 2, name: "割当を確認・編集" });
  fireEvent.click(box("b"));
  press("編集を保存");
  const review = (await screen.findByRole("heading", { level: 3, name: "勤務案の更新競合" })).closest("section")!;
  expect(review).toHaveTextContent("編集開始時（第3版）：a");
  expect(review).toHaveTextContent("現在（第4版）：割当なし");
  expect(review).toHaveTextContent("編集中：a、b");
  expect(screen.getByRole("button", { name: "編集を保存" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "サーバーで再検証" })).toBeDisabled();
  press("三つの勤務案を確認して編集を続ける");
  await waitFor(() => expect(screen.queryByRole("heading", { name: "勤務案の更新競合" })).toBeNull());
  // The edit is kept over the current version, and is saved against that version.
  expect(box("a")).toBeChecked();
  expect(box("b")).toBeChecked();
  expect(screen.getByText("勤務案 版4")).toBeInTheDocument();
  press("編集を保存");
  await waitFor(() => expect(changes(calls)).toHaveLength(2));
  expect(changes(calls)[1].body).toEqual({ version: 4, proposal: { duty_ids: ["a", "b"] }, idempotency_key: expect.any(String) });
});

test("the server's check comes before the final confirmation; publishing opens the schedule on the new version", async () => {
  let attempts = 0;
  const { calls, refresh } = await mount((call) => {
    if (call.path.includes("/review")) return { findings: [], publishable: true, review_hash: "review-1" };
    if (call.path.includes("/publish")) { if (++attempts === 1) throw new PlanningError(503, "down"); return { publication_id: "pub-13", version: 13 }; }
    return draft();
  });
  await screen.findByRole("heading", { level: 2, name: "割当を確認・編集" });
  expect(document.querySelector(".ideal-confirm")).toBeNull();
  press("サーバーで再検証");
  const heading = await screen.findByRole("heading", { level: 3, name: "公開前の最終確認" });
  const surface = heading.closest(".ideal-confirm") as HTMLElement;
  expect(surface).toHaveTextContent("scopesynthetic/clinical-pharmacy入力版12選択案d1割当1件通知関係する職員");
  expect(surface).toHaveTextContent("実行すると既存版を上書きせず、新しい公開版を作ります。");
  expect(screen.getByText("検証済み")).toBeInTheDocument();
  fireEvent.click(within(surface).getByRole("button", { name: "確認した案を公開" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(replaced).not.toHaveBeenCalled();
  fireEvent.click(within(surface).getByRole("button", { name: "確認した案を公開" }));
  await waitFor(() => expect(replaced).toHaveBeenCalledTimes(1));
  expect(replaced).toHaveBeenCalledWith("/workspace/schedule?scope=synthetic%2Fclinical-pharmacy&period=2026-10&publication=pub-13", "plan-published");
  expect(changes(calls).map((call) => `${call.method} ${call.path}`)).toEqual([`POST /drafts/d1/review?${SCOPE}`, ...Array(2).fill(`POST /drafts/d1/publish?${SCOPE}`)]);
  expect(changes(calls)[0].body).toEqual({ version: 3, idempotency_key: expect.any(String) });
  expect(changes(calls)[1].body).toEqual({ version: 3, expected_publication_version: 7, input_hash: "hash-12", review_hash: "review-1", idempotency_key: expect.any(String) });
  expect(changes(calls)[2].body).toEqual(changes(calls)[1].body);
  expect(refresh).not.toHaveBeenCalled();
});

test("an edit after the check withdraws the confirmation; a refused publication is shown", async () => {
  const { refresh } = await mount((call) => {
    if (call.path.includes("/review")) return { findings: [], publishable: true, review_hash: "review-1" };
    if (call.path.includes("/publish")) throw new PlanningError(422, "入力版が古くなりました。");
    return draft();
  });
  await screen.findByRole("heading", { level: 2, name: "割当を確認・編集" });
  press("サーバーで再検証");
  await screen.findByRole("heading", { level: 3, name: "公開前の最終確認" });
  press("確認した案を公開");
  expect(await screen.findByRole("alert")).toHaveTextContent("サーバーの検証で止まりました入力版が古くなりました。");
  expect(replaced).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(box("b"));
  expect(screen.queryByRole("heading", { name: "公開前の最終確認" })).toBeNull();
});

test("findings stop the publication; outside the workspace the route is read again instead of leaving", async () => {
  let publishable = false;
  pathname.mockReturnValue("/showcase");
  const { refresh } = await mount((call) => {
    if (call.path.includes("/review")) return publishable ? { findings: [], publishable: true, review_hash: "review-1" } : { findings: [1, 2], publishable: false, review_hash: null };
    if (call.path.includes("/publish")) return { publication_id: "pub-13", version: 13 };
    return draft();
  });
  await screen.findByRole("heading", { level: 2, name: "割当を確認・編集" });
  press("サーバーで再検証");
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(document.querySelector(".ideal-confirm")).toBeNull();
  publishable = true;
  press("サーバーで再検証");
  await screen.findByRole("heading", { level: 3, name: "公開前の最終確認" });
  press("確認した案を公開");
  await waitFor(() => expect(screen.getAllByRole("status").map((item) => item.textContent)).toContain("公開版 v13 を作成しました。"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(replaced).not.toHaveBeenCalled();
});
