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
  input_hash: "abc", plans: [figures("d1"), figures("d2", { duplicate_of: "d1", changes_from_previous: null }), figures("d3", { changes_from_publication: 6 })],
  pairs: [{ a: "d1", b: "d3", differing_duties: 2, affected_people: 2 }], order: ["d3", "d1", "d2"], order_rule: "違反、変更数の順", meaning: "同じ定義の数値だけを比較します。",
};

// The count against the current publication is the server's own figure, with its own base
// (every duty of the publication that is current now): it is said under each plan whenever
// the server returned it, in neutral words, and the browser does not compare it with the
// table's column. Plan 2 has no previous duties, and still has this figure.
const PLAN_LINES = [
  ["案 1", "勤務 2件・公開中の勤務表と異なる勤務 4件", "案 3 とは：異なる勤務 2件、関係する職員 2名"],
  ["案 2", "勤務 2件・公開中の勤務表と異なる勤務 4件"],
  ["案 3", "勤務 2件・公開中の勤務表と異なる勤務 6件", "案 1 とは：異なる勤務 2件、関係する職員 2名"],
];

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
  // The decisive columns come first: the plan, its place, the findings; then the figures.
  expect(within(table).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["案", "順位", "違反", "未確認", "未対応", "前回からの変更", "勤務が重なった希望", "勤務時間の差"]);
  // One story: plan 1 keeps the two published duties and lies on one of two wishes; plan 2
  // has an unverified finding and is last; plan 3 changes both duties.
  expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual(["案 11位0件0件0件0件1 / 2件0時間", "案 23位0件1件0件2件0 / 2件0.5時間", "案 32位0件0件0件4件0 / 2件1時間"]);
  // The server's two sentences about the order (the synthetic answer has the server's exact
  // words) are said in this screen's words: no 「review」, no 「コスト」.
  expect(screen.getByText("順位", { selector: "dt" }).nextElementSibling).toHaveTextContent(/^違反、未確認、未対応、前回からの変更、希望に重なった勤務の数（希望の順位で重みづけ）、勤務時間の差の順に比べ、少ない案が上位です。すべて同じなら、案の番号の順です。$/);
  expect(document.querySelector(".ideal-v3-planning-meaning")).toHaveTextContent(/^案を1つの点数にまとめた値はありません。順位は確認の手がかりです。公開するには、「確認・編集」の画面でサーバーの検証を通す必要があります。$/);
  expect(document.body).not.toHaveTextContent(/review|コスト/);
  expect(within(screen.getByRole("list", { name: "案ごとの勤務の件数とほかの案との違い" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "案 1勤務 2件・公開中の勤務表と異なる勤務 0件案 2 とは：異なる勤務 2件、関係する職員 1名案 3 とは：異なる勤務 4件、関係する職員 2名",
    "案 2勤務 2件・公開中の勤務表と異なる勤務 2件案 1 とは：異なる勤務 2件、関係する職員 1名案 3 とは：異なる勤務 2件、関係する職員 1名",
    "案 3勤務 2件・公開中の勤務表と異なる勤務 4件案 1 とは：異なる勤務 4件、関係する職員 2名案 2 とは：異なる勤務 2件、関係する職員 1名",
  ]);
  // What the wish column counts is the server's: wishes a duty overlaps, so fewer is better.
  expect(screen.getByText("勤務が重なった希望", { selector: "dt" }).nextElementSibling).toHaveTextContent("勤務を入れないでほしい日時の希望（公休の希望など）のうち、その案の勤務が重なった希望の数 / 希望の総数です。少ないほど希望に沿っています。");
  expect(screen.getByText("勤務時間の差", { selector: "dt" }).nextElementSibling).toHaveTextContent("その案で割当のある職員のうち、勤務時間の合計がいちばん長い職員と、いちばん短い職員との差です。");
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
  expect(rows[1]).toHaveTextContent("案 12位0件1件2件4件9 / 12件1.5時間");
  expect(rows[2]).toHaveTextContent("案 2（案 1 と同じ）3位0件1件2件—9 / 12件1.5時間");
  expect(within(rows[2]).getByRole("radio")).toBeDisabled();
  // Each plan with what the read says of it and how it differs from each other plan it was paired with.
  expect(within(screen.getByRole("list", { name: "案ごとの勤務の件数とほかの案との違い" })).getAllByRole("listitem").map((item) => Array.from(item.children).map((part) => part.textContent))).toEqual(PLAN_LINES);
  // A rule and a meaning this code has no words for are the server's own sentences, as it wrote them.
  expect(screen.getByText("順位", { selector: "dt" }).nextElementSibling).toHaveTextContent(/^サーバーの規則で並べたときの順位です（1位が先頭）。規則：違反、変更数の順$/);
  expect(document.querySelector(".ideal-v3-planning-meaning")).toHaveTextContent(/^同じ定義の数値だけを比較します。$/);
  expect(screen.getByText(/このボタンが「選んだ案を確認・編集」に変わります。/)).toBeInTheDocument();
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
