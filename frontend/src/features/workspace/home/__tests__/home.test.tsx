import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole, ScheduleChangeCase } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute } from "../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../showcase/synthetic/context";
import type { HomeData } from "../model";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const READS = [`/schedule-calendar?${SCOPE}&period=2026-10`, `/dashboard?${SCOPE}&period=2026-10`, `/daily-operations?${SCOPE}&day=2026-10-12`, `/schedule-stability?${SCOPE}`, `/change-cases?${SCOPE}`];
const duty = (id: string, person: string) => ({ duty_id: id, person_id: person, kind: "日勤", task: "調剤", location: "中央", start: "2026-10-14T08:30:00+09:00", end: "2026-10-14T17:15:00+09:00" });
// The leader's absence, covered by the pharmacist, who is asked to consent.
const asked: ScheduleChangeCase = {
  case_id: "c1", scope_id: "synthetic/clinical-pharmacy", publication_id: "synthetic-publication-12", kind: "ABSENCE", status: "AWAITING_CONSENT", version: 1,
  affected_assignments: [], proposed_assignments: [duty("r1", "synthetic-pharmacist")],
  validation: { findings: [], publishable: true, required_consent_person_ids: ["synthetic-pharmacist"], consented_person_ids: [] },
  evidence: {}, created_by: "", created_at: "2026-10-12T07:00:00+09:00", updated_at: "2026-10-12T07:30:00+09:00",
};
const empty: HomeData = { calendar: null, dashboard: null, daily: null, stability: null, cases: [] };

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

async function mount(data: HomeData, answer: (call: Call) => unknown = () => asked, role: IdealRole = "PHARMACIST") {
  const ctx = syntheticContext(role);
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  const tree = (value: HomeData) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider>;
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(tree(data)); });
  return { calls, refresh, show: (value: HomeData) => view.rerender(tree(value)) };
}

function fillEvidence(scope: HTMLElement) {
  fireEvent.change(within(scope).getByLabelText(/^理由/), { target: { value: "本人から連絡" } });
  fireEvent.change(within(scope).getByLabelText(/^参照/), { target: { value: "TEL-1012" } });
}
const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;

test("the route reads the five parts of the home, each beside the others", async () => {
  const { calls, client } = api((call) => call.path.startsWith("/change-cases") ? [asked] : { read: call.path });
  const state = await readRoute(route, client, syntheticContext("LEADER"));
  expect(state).toMatchObject({ kind: "ready", partial: [], data: { cases: [asked], calendar: { read: READS[0] }, dashboard: { read: READS[1] }, daily: { read: READS[2] }, stability: { read: READS[3] } } });
  expect(calls).toEqual(READS.map((path) => ({ method: "GET", path, body: undefined })));
  expect(route.names).toBe("planning");
});

test("a pharmacist's home reads their calendar and the cases shown to them, not the scope's counts", async () => {
  const { calls, client } = api((call) => call.path.startsWith("/change-cases") ? [] : { read: call.path });
  const state = await readRoute(route, client, syntheticContext("PHARMACIST"));
  expect(state).toMatchObject({ kind: "ready", partial: [], data: { calendar: { read: READS[0] }, dashboard: null, daily: null, stability: null, cases: [] } });
  expect(calls.map((call) => call.path)).toEqual([READS[0], READS[4]]);
});

test("a part the server does not have yet is none, not a failure", async () => {
  const { client } = api((call) => {
    if (call.path.startsWith("/change-cases")) return [];
    throw new PlanningError(404, "Not Found");
  });
  expect(await readRoute(route, client, syntheticContext("LEADER"))).toEqual({ kind: "ready", partial: [], data: empty });
});

test("a part that cannot be read is reported and leaves the rest in place", async () => {
  const { client } = api((call) => {
    if (call.path.startsWith("/schedule-stability")) throw new PlanningError(503, "stability down");
    if (call.path.startsWith("/change-cases")) throw new PlanningError(500, "cases down");
    return { read: call.path };
  });
  const state = await readRoute(route, client, syntheticContext("LEADER"));
  expect(state).toMatchObject({ kind: "ready", data: { stability: null, cases: null, daily: { read: READS[2] } } });
  const partial = state.kind === "ready" ? state.partial : [];
  expect(partial).toHaveLength(2);
  expect(partial).toEqual(expect.arrayContaining([
    { resource: "変更安定性", status: 503, detail: "stability down" },
    { resource: "欠勤・交換", status: 500, detail: "cases down" },
  ]));
});

test("an expired session is a problem of the whole route, never a partial result", async () => {
  const { client } = api((call) => {
    if (call.path.startsWith("/dashboard")) throw new PlanningError(401, "ログインし直してください。");
    return [];
  });
  expect(await readRoute(route, client, syntheticContext("LEADER"))).toEqual({ kind: "problem", status: 401, detail: "ログインし直してください。" });
});

test("the showcase shows a planner's home, and zero and 'nothing' where there is nothing yet", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const shown = render(<CognitiveWorkspaceShowcase screen="home" role="LEADER" />);
  // The largest heading of the route is today, with what waits for the viewer under it. The
  // publication on screen and its verification are the frame's to say: the route repeats neither.
  expect(await screen.findByRole("heading", { level: 2, name: "2026年10月12日（月）" })).toBeInTheDocument();
  expect(panel("2026年10月12日（月）")).toHaveTextContent("あなたへの同意の依頼が1件、承認を待つケースが1件あります。");
  const content = document.querySelector(".ideal-v3-content")!;
  expect(content).not.toHaveTextContent("公開版 v12");
  expect(content).not.toHaveTextContent(/検証済み|最終検証/);
  // The leader is asked for a consent, and sees the open cases by state.
  expect(within(panel("同意が必要な勤務")).getByText("1件")).toBeInTheDocument();
  expect(within(panel("次に判断すること")).getAllByRole("listitem").map((item) => item.textContent?.slice(0, 5))).toEqual(["1承認待ち", "0別担当の", "1同意待ち", "0指摘あり"]);
  expect(within(panel("次に判断すること")).getByRole("link", { name: "当日運用で開く" })).toHaveAttribute("href", "/workspace/operations/cases");
  // A state that has cases is a row that leads to them; a state without any leads nowhere.
  expect(within(panel("次に判断すること")).getAllByRole("link").slice(1).map((link) => [link.textContent?.slice(0, 5), link.getAttribute("href")])).toEqual([["1承認待ち", "/workspace/operations/cases"], ["1同意待ち", "/workspace/operations/cases"]]);
  // The note of a row says in plain words who does what next: text beside a dot, not a pill
  // (only the row is pressed).
  expect(within(panel("次に判断すること")).getAllByRole("listitem").map((item) => item.querySelector(".ideal-v3-home-next")?.textContent)).toEqual(["責任者が承認する", "別の責任者が承認する", "関係者の返事を待つ", "取り下げて作り直す"]);
  expect(panel("次に判断すること").querySelector(".ideal-pill")).toBeNull();
  // Each figure is named by what it counts; the cases of the day are the two open cases,
  // both about a duty of the day, so the tile and the rows above agree.
  expect(within(panel("今日把握すること")).getAllByRole("article").map((item) => item.textContent)).toEqual([
    "本日の予定勤務2件在席・出勤実績ではありません今日の予定を開く ", "今日の勤務に関わるケース2件進行中の欠勤・交換のうち、今日の勤務が対象のもの欠勤・交換を開く ",
    "確認待ちの申請1件2026年10月にかかる申請だけの件数（休暇の画面は全期間の申請を表示）休暇の申請を開く ", "送信待ちの記録1件監査の送付先へまだ送られていない操作の記録（通知を含む・部署全体）。送付は運用の処理が行います",
  ]);
  // A figure leads to the route that shows what it counts.
  expect(within(panel("今日把握すること")).getAllByRole("link").map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([["今日の予定を開く", "/workspace/operations/today"], ["欠勤・交換を開く", "/workspace/operations/cases"], ["休暇の申請を開く", "/workspace/requests/leave"]]);
  expect(panel("最近変わったこと")).toHaveTextContent("過去14日間 欠勤・交換の記録 5件 · 公開 2回");
  expect(within(panel("最近変わったこと")).getByRole("link", { name: "勤務表で変更された勤務を見る" })).toHaveAttribute("href", "/workspace/schedule");
  // The days on which something was recorded, with their dates; a day without is not listed.
  expect(within(screen.getByRole("list", { name: "記録があった日" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["10月11日（日）4件", "10月12日（月）1件"]);
  shown.unmount();
  render(<CognitiveWorkspaceShowcase screen="home" role="LEADER" state="empty" />);
  expect(await screen.findByRole("heading", { level: 2, name: "次に判断すること" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "同意が必要な勤務" })).toBeNull();
  expect(within(panel("次に判断すること")).getAllByRole("listitem").map((item) => item.textContent?.slice(0, 1))).toEqual(["0", "0", "0", "0"]);
  expect(within(panel("今日把握すること")).getAllByRole("article")[0]).toHaveTextContent("本日の予定勤務0件");
  expect(panel("最近変わったこと")).toHaveTextContent("過去14日間 欠勤・交換の記録 0件 · 公開 0回");
  expect(screen.queryByRole("list", { name: "記録があった日" })).toBeNull();
  expect(panel("2026年10月12日（月）")).toHaveTextContent("あなたへの依頼も、承認を待つケースもありません。");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the showcase shows a pharmacist their own next duty and no one else's name", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const shown = render(<CognitiveWorkspaceShowcase screen="home" role="PHARMACIST" />);
  expect(await screen.findByRole("heading", { level: 3, name: "10月12日（月） 08:30–17:30" })).toBeInTheDocument();
  expect(panel("次の勤務")).toHaveTextContent("今日出勤まで 1時間");
  expect(panel("次の勤務")).toHaveTextContent("本館 · 日勤 · 病棟");
  expect(screen.getByText("あなたに同意を求めている申請はありません。")).toBeInTheDocument();
  expect(panel("自分の勤務")).toHaveTextContent("公開版の自分の勤務1件公開版 v12");
  expect(within(panel("自分の勤務")).getByRole("link", { name: "勤務表で見る" })).toHaveAttribute("href", "/workspace/schedule");
  expect(screen.queryByRole("heading", { name: "次に判断すること" })).toBeNull();
  const content = document.querySelector(".ideal-v3-content")!;
  expect(content).not.toHaveTextContent("鈴木 悠斗");
  expect(content).not.toHaveTextContent("佐藤 美咲");
  shown.unmount();
  render(<CognitiveWorkspaceShowcase screen="home" role="PHARMACIST" state="empty" />);
  expect(await screen.findByRole("heading", { level: 3, name: "予定されている勤務はありません" })).toBeInTheDocument();
  expect(screen.getByText("あなたに同意を求めている申請はありません。")).toBeInTheDocument();
  expect(panel("自分の勤務")).toHaveTextContent("公開版の自分の勤務0件");
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a consent is given from the home queue; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  const { calls, refresh, show } = await mount({ ...empty, cases: [asked] }, () => {
    if (++attempts === 1) throw new PlanningError(503, "down");
    return { ...asked, status: "READY", version: 2 };
  });
  const queue = panel("同意が必要な勤務");
  expect(queue).toHaveTextContent("入るあなた · 10月14日（水） 08:30–17:15");
  // A pharmacist is told how many consents are needed, not whose.
  expect(within(queue).getByText(/^同意 0 \/ 1/).textContent).toBe("同意 0 / 1");
  fireEvent.click(within(queue).getByRole("button", { name: "同意する" }));
  fillEvidence(queue);
  fireEvent.click(within(queue).getByRole("button", { name: "同意する" }));
  expect(await within(queue).findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(queue).getByRole("button", { name: "同意する" }));
  expect(await screen.findByText("同意しました。")).toHaveAttribute("role", "status");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /change-cases/c1/consent?${SCOPE}`));
  const [first, second] = calls.map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ expected_version: 1, evidence: { reason: "本人から連絡", reference: "TEL-1012" }, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  // The confirmation stays on screen although the case leaves the queue on the next read.
  show({ ...empty, cases: [{ ...asked, status: "READY", version: 2 }] });
  expect(screen.queryByRole("heading", { name: "同意が必要な勤務" })).toBeNull();
  expect(screen.getByText("あなたに同意を求めている申請はありません。")).toBeInTheDocument();
  expect(screen.getByText("同意しました。")).toBeInTheDocument();
});

test("a conflict on a refusal is shown where it happened", async () => {
  const { calls, refresh } = await mount({ ...empty, cases: [asked] }, () => { throw new PlanningError(409, "Change case revision or status changed"); });
  const queue = panel("同意が必要な勤務");
  fireEvent.click(within(queue).getByRole("button", { name: "同意しない" }));
  fillEvidence(queue);
  fireEvent.click(within(queue).getByRole("button", { name: "同意しない" }));
  const alert = await within(queue).findByRole("alert");
  expect(alert).toHaveTextContent("409");
  expect(alert).toHaveTextContent("新しい変更があります");
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /change-cases/c1/decline?${SCOPE}`]);
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.queryByText(/同意しないことを記録しました/)).toBeNull();
});

test("cases that could not be read are not reported as none", async () => {
  for (const role of ["PHARMACIST", "LEADER"] as const) {
    await mount({ ...empty, cases: null }, undefined, role);
    expect(screen.getByText("欠勤・交換のケースを確認できません。")).toBeInTheDocument();
    expect(screen.queryByText("あなたに同意を求めている申請はありません。")).toBeNull();
    expect(screen.queryByRole("heading", { name: "次に判断すること" })).toBeNull();
    document.body.innerHTML = "";
  }
});

test("a planner's home says what could not be read instead of showing a figure", async () => {
  await mount(empty, undefined, "ADMIN");
  expect(within(panel("今日把握すること")).getAllByRole("article")[0]).toHaveTextContent("本日の予定勤務—当日情報を確認できません");
  expect(panel("最近変わったこと")).toHaveTextContent("変更履歴を確認できません。");
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "次に判断すること" })).toBeInTheDocument());
});
