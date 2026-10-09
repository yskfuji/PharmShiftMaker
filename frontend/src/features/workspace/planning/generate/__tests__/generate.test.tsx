import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient, type Job } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { GenerateData } from "../GenerateView";
import route from "../route";

let mockQuery: URLSearchParams | null = null;
jest.mock("next/navigation", () => ({ ...jest.requireActual("next/navigation"), useSearchParams: () => mockQuery }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); mockQuery = null; });

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const fresh: GenerateData = { revision: 12, inputHash: "hash-12", stale: false, period: { start: "2026-10-01T00:00:00+09:00", end: "2026-11-01T00:00:00+09:00" }, counts: { people: 3, demands: 2, candidates: 2 } };
const seedOf = (call: Call) => (call.body as { random_seed: number }).random_seed;
const queued = (call: Call): Job => ({ job_id: `job-${seedOf(call)}`, status: "QUEUED" });

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

async function mount(data: GenerateData, answer: (call: Call) => unknown) {
  const ctx = syntheticContext("LEADER");
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  await act(async () => { render(<LiveProvider live={live}><View data={data} ctx={ctx} /></LiveProvider>); });
  return { calls, refresh };
}
const start = () => fireEvent.click(screen.getByRole("button", { name: "3つの案を作る" }));
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");

test("the route reads the latest input and keeps its version, hash, staleness and what it holds in a line", async () => {
  const period = { start: "2026-10-01T00:00:00+09:00", end: "2026-11-01T00:00:00+09:00" };
  const { calls, client } = api(() => ({ input_hash: "hash-12", input_revision: 12, publication_version: 3, stale: true, snapshot: { people: [{ person_id: "p1", name: "名前" }], period, demands: [{}, {}], candidates: [{}, {}, {}] } }));
  const state = await readRoute(route, client, syntheticContext("ADMIN"));
  // No name of a person is kept: only how many the input holds.
  expect(state).toEqual({ kind: "ready", partial: [], data: { revision: 12, inputHash: "hash-12", stale: true, period, counts: { people: 1, demands: 2, candidates: 3 } } });
  expect(calls).toEqual([{ method: "GET", path: `/inputs/latest?${SCOPE}`, body: undefined }]);
  expect(route.names).toBe("none");
});

test("without an input the route is a problem, not an empty screen", async () => {
  const { client } = api(() => { throw new PlanningError(404, "Not Found"); });
  expect(await readRoute(route, client, syntheticContext("ADMIN"))).toEqual({ kind: "problem", status: 404, detail: "Not Found" });
});

test("the showcase shows the route, ready and empty, without a server", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  for (const state of ["ready", "empty"] as const) {
    const view = render(<CognitiveWorkspaceShowcase screen="plan" view="generate" role="LEADER" state={state} />);
    expect(await screen.findByRole("heading", { level: 2, name: "同じ前提から3案を作成" })).toBeInTheDocument();
    expect(screen.getByText("入力版 第12版")).toBeInTheDocument();
    expect(screen.getByText("生成可能")).toBeInTheDocument();
    // Which input the plans are made from, and what the action does to the plans that exist.
    expect(screen.getByText("もとにする入力版").closest("div")).toHaveTextContent(state === "ready" ? "入力版 第12版（職員 3名・必要配置 2件・勤務候補 2件）" : "入力版 第12版（職員 0名・必要配置 0件・勤務候補 0件）");
    expect(screen.getByText("もとにする入力版").closest("dl")).toHaveTextContent("対象期間2026年10月1日（木）〜10月31日（土）");
    expect(screen.getByRole("list", { name: "押したあとに起きること" })).toHaveTextContent("すでにある案は消えず、置き換わりません。");
    expect(screen.getByRole("list", { name: "押したあとに起きること" })).toHaveTextContent("1案あたりの探索は最長25秒です");
    // The process of the plan is the shell's navigation: the view repeats none.
    expect(screen.queryByRole("list", { name: "計画の工程" })).toBeNull();
    expect(screen.getByRole("button", { name: "3つの案を作る" })).toBeEnabled();
    view.unmount();
  }
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a stale input cannot be used", async () => {
  const { calls } = await mount({ ...fresh, stale: true }, queued);
  expect(screen.getByText("入力が古い")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "3つの案を作る" })).toBeDisabled();
  expect(calls).toEqual([]);
});

test("three jobs are started, one per seed; an unknown outcome keeps that job's key", async () => {
  let failures = 1;
  const { calls, refresh } = await mount(fresh, (call) => {
    if (seedOf(call) === 1 && failures-- > 0) throw new PlanningError(503, "down");
    return { ...queued(call), status: "CANCELLED" };
  });
  start();
  expect(await screen.findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(screen.getAllByRole("listitem").filter((item) => item.textContent?.startsWith("案 "))).toHaveLength(1);
  start();
  await waitFor(() => expect(posts(calls)).toHaveLength(5));
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(5).fill(`POST /jobs?${SCOPE}`));
  const bodies = calls.map((call) => call.body as { random_seed: number; idempotency_key: string });
  expect(bodies.map((body) => body.random_seed)).toEqual([0, 1, 0, 1, 2]);
  expect(bodies[4]).toEqual({ input_hash: "hash-12", random_seed: 2, budget_seconds: 25, idempotency_key: expect.any(String) });
  // The job whose outcome was unknown is asked for again with the key it had.
  expect(bodies[3]).toEqual(bodies[1]);
  // The first job had a definite answer, so asking again is a new job.
  expect(bodies[2].idempotency_key).not.toBe(bodies[0].idempotency_key);
  // Jobs are not part of what the route reads.
  expect(refresh).not.toHaveBeenCalled();
});

test("running jobs are asked for every second until each has ended; then the plans can be compared", async () => {
  jest.useFakeTimers();
  mockQuery = new URLSearchParams("scope=synthetic/clinical-pharmacy&period=2026-10&draft=earlier&input=earlier");
  let round = 0;
  const { calls } = await mount(fresh, (call) => {
    if (call.method === "POST") return queued(call);
    const id = call.path.split("/")[2].split("?")[0];
    if (id === "job-2") round += 1;
    // The third job needs one more second than the others.
    return round < 2 && id === "job-2" ? { job_id: id, status: "RUNNING" } : { job_id: id, status: id === "job-1" ? "OPTIMAL" : "FEASIBLE", result: { draft_id: `draft-${id}` } };
  });
  await act(async () => { start(); });
  await waitFor(() => expect(screen.getAllByText("待機中")).toHaveLength(3));
  expect(screen.getByRole("button", { name: "3つの案を作る" })).toBeDisabled();
  expect(screen.getAllByRole("button", { name: "中止" })).toHaveLength(3);
  expect(calls.filter((call) => call.method === "GET")).toEqual([]);
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  expect(calls.filter((call) => call.method === "GET").map((call) => call.path)).toEqual([0, 1, 2].map((seed) => `/jobs/job-${seed}?${SCOPE}`));
  expect(screen.getByText("作成済み（時間内の最良）")).toBeInTheDocument();
  expect(screen.getByText("作成済み（最適）")).toBeInTheDocument();
  expect(screen.getByText("作成中")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /3案を同じ定義で比較/ })).toBeNull();
  await act(async () => { await jest.advanceTimersByTimeAsync(1000); });
  // Only the job still running is asked for again.
  expect(calls.filter((call) => call.method === "GET").map((call) => call.path).slice(3)).toEqual([`/jobs/job-2?${SCOPE}`]);
  expect(screen.getByRole("link", { name: /3案を同じ定義で比較/ })).toHaveAttribute("href",
    "/workspace/plan/compare?scope=synthetic%2Fclinical-pharmacy&period=2026-10&input=hash-12&draft=draft-job-0&draft=draft-job-1&draft=draft-job-2");
  expect(screen.getByRole("button", { name: "3つの案を作る" })).toBeEnabled();
  await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
  expect(calls.filter((call) => call.method === "GET")).toHaveLength(4);
});

test("a running job is cancelled with its own key; a refusal is shown", async () => {
  let refuse = true;
  const { calls } = await mount(fresh, (call) => {
    if (call.path.includes("/cancel")) { if (refuse) { refuse = false; throw new PlanningError(409, "ended"); } return { job_id: "job-2", status: "CANCELLED" }; }
    return queued(call);
  });
  await act(async () => { start(); });
  await waitFor(() => expect(screen.getAllByRole("button", { name: "中止" })).toHaveLength(3));
  const third = screen.getByText("案 3").closest("li")!;
  fireEvent.click(within(third).getByRole("button", { name: "中止" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(within(third).getByText("待機中")).toBeInTheDocument();
  fireEvent.click(within(third).getByRole("button", { name: "中止" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("案 3 の生成を中止しました。"));
  expect(within(third).getByText("中止")).toBeInTheDocument();
  expect(within(third).queryByRole("button")).toBeNull();
  const cancels = calls.filter((call) => call.path.includes("/cancel"));
  expect(cancels.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /jobs/job-2/cancel?${SCOPE}`));
  expect(cancels[0].body).toEqual({ idempotency_key: expect.any(String) });
});
