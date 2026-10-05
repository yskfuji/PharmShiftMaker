import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { PlanComparison, PlanFigures } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { CompareData } from "../CompareView";
import route from "../route";

let mockQuery: URLSearchParams | null = null;
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useSearchParams: () => mockQuery }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => { jest.restoreAllMocks(); mockQuery = null; });

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const figures = (id: string, over: Partial<PlanFigures> = {}): PlanFigures => ({
  draft_id: id, findings: { violation: 0, unverified: 1, unsupported: 2 }, publishable: true, changes_from_previous: 4, changes_from_publication: 4, preference_cost: 1,
  preferences_met: 9, preferences_total: 12, work_seconds_total: 288000, work_seconds_spread: 5400, assignment_count: 2, proposal_hash: id, duplicate_of: null, solver: null, ...over,
});
const comparison: PlanComparison = {
  input_hash: "abc", plans: [figures("d1"), figures("d2", { duplicate_of: "d1", changes_from_previous: null }), figures("d3")],
  pairs: [{ a: "d1", b: "d3", differing_duties: 2, affected_people: 2 }], order: ["d3", "d1", "d2"], order_rule: "違反、変更数の順", meaning: "同じ定義の数値だけを比較します。",
};

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

const seeded = (over: Partial<CompareData> = {}): CompareData =>
  ({ draftIds: ["d1", "d2", "d3"], inputHash: "abc", comparison: { data: comparison, problem: null }, ...over });
const chosen = (draftIds: string[], inputHash: string | null = null) =>
  ({ ...syntheticContext("ADMIN"), selectedDraftIds: draftIds, selectedInputHash: inputHash });

async function mount(data: CompareData, answer: (call: Call) => unknown = () => comparison) {
  const ctx = syntheticContext("LEADER");
  const { calls, client } = api(answer);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh: jest.fn(async () => undefined) });
  const View = route.View;
  await act(async () => { render(<LiveProvider live={live}><View data={data} ctx={ctx} /></LiveProvider>); });
  return { calls };
}

test("the route reads the comparison of the plans and the input the URL names, and nothing else", async () => {
  const { calls, client } = api(() => comparison);
  const drafts = ["d1", "d2", "d3", "d4", "d5", "d6"];
  expect(await readRoute(route, client, chosen(drafts, "abc"))).toEqual({ kind: "ready", partial: [], data: { draftIds: drafts, inputHash: "abc", comparison: { data: comparison, problem: null } } });
  expect(calls).toEqual([{ method: "GET", path: `/plan-comparison?${SCOPE}&input_hash=abc${drafts.map((id) => `&draft_ids=${id}`).join("")}`, body: undefined }]);
  expect(route.names).toBe("none");
});

test("without an input in the URL the latest input is read and compared against", async () => {
  const { calls, client } = api((call) => call.path.startsWith("/inputs/latest") ? { input_hash: "hash-12", input_revision: 12, snapshot: { people: [{ person_id: "p1", name: "名前" }] } } : comparison);
  const state = await readRoute(route, client, chosen(["d1"]));
  expect(state).toEqual({ kind: "ready", partial: [], data: { draftIds: ["d1"], inputHash: "hash-12", comparison: { data: comparison, problem: null } } });
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /inputs/latest?${SCOPE}`, `GET /plan-comparison?${SCOPE}&input_hash=hash-12&draft_ids=d1`]);
});

test("without plans in the URL nothing is read and nothing is compared", async () => {
  const { calls, client } = api(() => { throw new Error("nothing is read"); });
  const state = await readRoute(route, client, chosen([], "abc"));
  expect(state).toEqual({ kind: "ready", partial: [], data: { draftIds: [], inputHash: "", comparison: null } });
  expect(calls).toEqual([]);
  const view = await mount({ draftIds: [], inputHash: "", comparison: null });
  expect(screen.getByRole("heading", { level: 2, name: "比較する案が指定されていません" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "候補生成へ" })).toHaveAttribute("href", "/workspace/plan/generate");
  expect(view.calls).toEqual([]);
});

test("no input yet is none; an input that cannot be read is reported beside the comparison", async () => {
  const answer = (status: number) => (call: Call) => { if (call.path.startsWith("/inputs/latest")) throw new PlanningError(status, status === 404 ? "Not Found" : "down"); return comparison; };
  const missing = api(answer(404));
  expect(await readRoute(route, missing.client, chosen(["d1"]))).toEqual({ kind: "ready", partial: [], data: { draftIds: ["d1"], inputHash: "", comparison: { data: comparison, problem: null } } });
  expect(missing.calls.map((call) => call.path)).toEqual([`/inputs/latest?${SCOPE}`, `/plan-comparison?${SCOPE}&input_hash=&draft_ids=d1`]);
  const down = api(answer(503));
  expect(await readRoute(route, down.client, chosen(["d1"]))).toMatchObject({ kind: "ready", partial: [{ resource: "入力版", status: 503, detail: "down" }], data: { inputHash: "" } });
});

test("the showcase compares three synthetic plans; with no plan chosen the route says so itself", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="plan" view="compare" role="LEADER" />);
  const table = await screen.findByRole("region", { name: "案ごとの数値" });
  expect(within(table).getAllByRole("row")).toHaveLength(4);
  expect(within(table).getAllByRole("row")[1]).toHaveTextContent("案 10・0・01110 / 120.5時間1");
  expect(screen.getByText("並びの規則：違反、変更数、希望、勤務時間差の順")).toBeInTheDocument();
  expect(screen.getByText("案 1 と案 2：異なる勤務 2件、関係する職員 2名")).toBeInTheDocument();
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="plan" view="compare" role="LEADER" state="empty" />);
  expect(await screen.findByRole("heading", { level: 2, name: "比較する案が指定されていません" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "案ごとの数値" })).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the comparison the server read is shown without another read; a duplicate cannot be chosen", async () => {
  mockQuery = new URLSearchParams("scope=synthetic/clinical-pharmacy&person=p1&input=abc&draft=d1&draft=d2&draft=d3");
  const { calls } = await mount(seeded());
  const table = screen.getByRole("region", { name: "案ごとの数値" });
  const rows = within(table).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("案 10・1・249 / 121.5時間2");
  expect(rows[2]).toHaveTextContent("案 2（案 1 と同じ）0・1・2—9 / 121.5時間3");
  expect(within(rows[2]).getByRole("radio")).toBeDisabled();
  expect(screen.getByText("案 1 と案 3：異なる勤務 2件、関係する職員 2名")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /選んだ案を確認・編集/ })).toBeNull();
  fireEvent.click(within(rows[3]).getByRole("radio"));
  // The display context is kept; the choice replaces the listed plans.
  expect(screen.getByRole("link", { name: /選んだ案を確認・編集/ })).toHaveAttribute("href", "/workspace/plan/drafts?scope=synthetic%2Fclinical-pharmacy&person=p1&input=abc&draft=d3");
  // Picking a plan is state of the island: the browser reads nothing for it.
  expect(calls).toEqual([]);
});

test("the next link names the input that was compared against, also when the URL named none", async () => {
  mockQuery = new URLSearchParams("draft=d1");
  await mount(seeded({ draftIds: ["d1"], inputHash: "hash-12", comparison: { data: { ...comparison, plans: [figures("d1")], pairs: [], order: ["d1"] }, problem: null } }));
  fireEvent.click(screen.getByRole("radio"));
  expect(screen.getByRole("link", { name: /選んだ案を確認・編集/ })).toHaveAttribute("href", "/workspace/plan/drafts?input=hash-12&draft=d1");
});

test("a comparison the server refuses is a problem of the panel, and can be read again", async () => {
  mockQuery = new URLSearchParams("input=abc&draft=d1");
  const refused = api(() => { throw new PlanningError(409, "moved"); });
  const state = await readRoute(route, refused.client, chosen(["d1"], "abc"));
  // Not the route's problem: the frame, the steps and the panel stay.
  expect(state).toMatchObject({ kind: "ready", partial: [], data: { draftIds: ["d1"], inputHash: "abc", comparison: { data: null, problem: { kind: "conflict", code: "409", title: "表示中の版が古くなりました" } } } });
  if (state.kind !== "ready") return;
  const { calls } = await mount(state.data);
  expect(screen.getByRole("alert")).toHaveTextContent("表示中の版が古くなりました");
  expect(screen.getByRole("heading", { level: 2, name: "案の比較" })).toBeInTheDocument();
  expect(calls).toEqual([]);
  fireEvent.click(within(screen.getByRole("alert")).getByRole("button"));
  await waitFor(() => expect(screen.getByRole("region", { name: "案ごとの数値" })).toBeInTheDocument());
  // Trying again is the only read the browser makes, for the same plans and input.
  expect(calls).toEqual([{ method: "GET", path: `/plan-comparison?${SCOPE}&input_hash=abc&draft_ids=d1`, body: undefined }]);
});

test("an expired session is the route's problem, never a panel", async () => {
  const expired = api(() => { throw new PlanningError(401, "expired"); });
  expect(await readRoute(route, expired.client, chosen(["d1"], "abc"))).toEqual({ kind: "problem", status: 401, detail: "expired" });
});
