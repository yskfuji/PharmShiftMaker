import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { LifecycleCase, LifecycleTaskState } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute, type RouteContext } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const task = (key: string, over: Partial<LifecycleTaskState> = {}): LifecycleTaskState =>
  ({ key, source: "SYSTEM", status: "NOT_STARTED", completed_at: null, can_complete: false, blocked_reason: null, ...over });
const lifecycle = (over: Partial<LifecycleCase> = {}): LifecycleCase => ({
  case_id: "c1", scope_id: "synthetic/clinical-pharmacy", person_id: "synthetic-pharmacist", kind: "OFFBOARD", status: "IN_PROGRESS", effective_date: "2026-10-31", version: 3,
  tasks: [
    task("contract_end", { status: "COMPLETED", completed_at: "2026-10-01T09:00:00+09:00" }),
    task("membership_deactivation", { blocked_reason: "有効なアカウントが残っています。" }),
    task("candidate_exclusion"),
    task("balance_review", { source: "ATTESTATION", can_complete: true }),
  ],
  evidence: {}, created_by: "", created_at: "2026-10-01T09:00:00+09:00", updated_at: "2026-10-01T09:00:00+09:00", ...over,
});

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

function mount(data: LifecycleCase[], answer: (call: Call) => unknown = () => lifecycle(), over: Partial<RouteContext> = {}) {
  const ctx = { ...syntheticContext("ADMIN"), ...over };
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  const tree = (value: LifecycleCase[]) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider>;
  const view = render(tree(data));
  return { calls, refresh, show: (value: LifecycleCase[]) => view.rerender(tree(value)) };
}

function fillEvidence(scope: HTMLElement) {
  fireEvent.change(within(scope).getByLabelText(/^理由/), { target: { value: "退職届を受領" } });
  fireEvent.change(within(scope).getByLabelText(/^参照/), { target: { value: "HR-2040" } });
}
const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".ideal-lifecycle-list article"));

test("the route reads the lifecycle cases and nothing else", async () => {
  const { calls, client } = api(() => [lifecycle()]);
  const state = await readRoute(route, client, syntheticContext("ADMIN"));
  expect(state).toMatchObject({ kind: "ready", partial: [] });
  expect(calls).toEqual([{ method: "GET", path: `/lifecycle-cases?${SCOPE}`, body: undefined }]);
  expect(route.names).toBe("roster");
});

test("the showcase shows the cases, and the route's own words when there are none", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="people" view="lifecycle" role="ADMIN" />);
  // The synthetic cases are what the server derives: a joining with one record missing, a leaving with one attestation open.
  expect(await screen.findByRole("progressbar", { name: "高橋 葵のタスク進捗" })).toHaveAttribute("aria-valuenow", "3");
  expect(screen.getByRole("progressbar", { name: "鈴木 悠斗のタスク進捗" })).toHaveAttribute("aria-valuenow", "1");
  expect(cards()).toHaveLength(2);
  expect(cards()[0]).toHaveTextContent("入職 · 進行中");
  // A task the server completed from a record has no time, and is not called unfinished.
  expect(cards()[0]).toHaveTextContent("✓雇用契約の確認完了");
  // How each open task comes to be done is said with its state: from a record, or by a person.
  expect(cards()[0]).toHaveTextContent("資格の確認未完了（記録から自動で判定）対応する正本の登録・確定が必要です。");
  expect(cards()[1]).toHaveTextContent("退職 · 進行中");
  expect(cards()[1]).toHaveTextContent("休暇残高の確認未完了（担当者が確かめて記録）");
  expect(within(cards()[1]).getByRole("button", { name: "確認を記録" })).toBeInTheDocument();
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="people" view="lifecycle" role="ADMIN" state="empty" />);
  expect(await screen.findByText("進行中の手続きはありません。")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 3, name: "手続きを始める" })).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a case shows its progress, and each open task the action the server allows for it", () => {
  mount([lifecycle(), lifecycle({ case_id: "c2", person_id: "synthetic-leader", kind: "ONBOARD", status: "READY", tasks: [task("contract", { status: "COMPLETED", completed_at: "2026-10-01T09:00:00+09:00" })] })]);
  const [offboard, onboard] = cards();
  expect(within(offboard).getByRole("progressbar", { name: "高橋 葵のタスク進捗" })).toHaveAttribute("aria-valuemax", "4");
  expect(offboard).toHaveTextContent("退職 · 進行中");
  expect(offboard).toHaveTextContent("発効日 2026-10-31 · 第3版");
  expect(offboard).toHaveTextContent("有効なアカウントが残っています。");
  // A link says where it leads before it is followed.
  expect(within(offboard).getAllByRole("link").map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
    ["本人アカウントを開く", "/workspace/people/memberships?scope=synthetic%2Fclinical-pharmacy&person=synthetic-pharmacist"],
    ["前提・取込を開く", "/workspace/plan/input?scope=synthetic%2Fclinical-pharmacy&person=synthetic-pharmacist"],
  ]);
  expect(within(offboard).getAllByRole("button", { name: "確認を記録" })).toHaveLength(1);
  expect(onboard).toHaveTextContent("入職 · すべて完了");
  expect(within(onboard).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  expect(within(onboard).queryByRole("button")).toBeNull();
});

test("the person the URL names narrows the cases and starts the form", () => {
  mount([lifecycle()], () => lifecycle(), { selectedPersonId: "synthetic-leader" });
  expect(screen.getByText("選択した職員に進行中の手続きはありません。")).toBeInTheDocument();
  expect(screen.getByLabelText("職員ID")).toHaveValue("synthetic-leader");
});

test("starting a case sends the form with its evidence; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  const { calls, refresh, show } = mount([], (call) => {
    if (call.method === "POST" && ++attempts === 1) throw new PlanningError(503, "down");
    return lifecycle();
  });
  const form = screen.getByRole("heading", { level: 3, name: "手続きを始める" }).parentElement!;
  fireEvent.change(within(form).getByLabelText("職員ID"), { target: { value: "synthetic-pharmacist" } });
  fireEvent.click(within(form).getByRole("radio", { name: "退職" }));
  fireEvent.change(within(form).getByLabelText("発効日"), { target: { value: "2026-10-31" } });
  fillEvidence(form);
  fireEvent.click(within(form).getByRole("button", { name: "始める" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(form).getByRole("button", { name: "始める" }));
  await waitFor(() => expect(within(form).getByRole("status")).toHaveTextContent("手続きを始めました。"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /lifecycle-cases?${SCOPE}`));
  const [first, second] = calls.map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ person_id: "synthetic-pharmacist", kind: "OFFBOARD", effective_date: "2026-10-31", evidence: { reason: "退職届を受領", reference: "HR-2040" }, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  // The list is drawn from what the route reads next, not from the form.
  expect(cards()).toHaveLength(0);
  show([lifecycle()]);
  expect(cards()).toHaveLength(1);
});

test("a conflict on starting a case is shown in the form", async () => {
  const { refresh } = mount([], () => { throw new PlanningError(409, "stale"); }, { selectedPersonId: "synthetic-pharmacist" });
  const form = screen.getByRole("heading", { level: 3, name: "手続きを始める" }).parentElement!;
  fireEvent.change(within(form).getByLabelText("発効日"), { target: { value: "2026-10-31" } });
  fillEvidence(form);
  fireEvent.click(within(form).getByRole("button", { name: "始める" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(refresh).not.toHaveBeenCalled();
});

test("confirming a task is sent against the case version on screen; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  const { calls, refresh, show } = mount([lifecycle()], (call) => {
    if (call.method === "POST" && ++attempts === 1) throw new PlanningError(503, "down");
    return lifecycle({ version: 4 });
  });
  const card = cards()[0];
  fireEvent.click(within(card).getByRole("button", { name: "確認を記録" }));
  expect(within(card).getByRole("group", { name: "「休暇残高の確認」の完了の根拠" })).toBeInTheDocument();
  fillEvidence(card);
  fireEvent.click(within(card).getByRole("button", { name: "完了にする" }));
  expect(await within(card).findByRole("alert")).toHaveTextContent("結果を確認できません");
  fireEvent.click(within(card).getByRole("button", { name: "完了にする" }));
  await waitFor(() => expect(within(card).getByRole("status")).toHaveTextContent("完了にしました。"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /lifecycle-cases/c1/tasks/balance_review/attest?${SCOPE}`));
  const [first, second] = calls.map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ expected_version: 3, evidence: { reason: "退職届を受領", reference: "HR-2040" }, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  // The card follows the next read and keeps the message of the change just made.
  show([lifecycle({ version: 4, status: "READY", tasks: lifecycle().tasks.map((item) => ({ ...item, status: "COMPLETED" as const, completed_at: "2026-10-12T09:00:00+09:00", blocked_reason: null })) })]);
  expect(within(cards()[0]).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  expect(cards()[0]).toHaveTextContent("退職 · すべて完了");
  expect(within(cards()[0]).getByRole("status")).toHaveTextContent("完了にしました。");
});

test("a conflict on confirming a task is shown in the card and keeps the evidence", async () => {
  const { refresh } = mount([lifecycle()], () => { throw new PlanningError(409, "stale"); });
  const card = cards()[0];
  fireEvent.click(within(card).getByRole("button", { name: "確認を記録" }));
  fillEvidence(card);
  fireEvent.click(within(card).getByRole("button", { name: "完了にする" }));
  expect(await within(card).findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(within(card).getByLabelText(/^理由/)).toHaveValue("退職届を受領");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(card).getByRole("button", { name: "やめる" }));
  expect(within(card).queryByRole("group")).toBeNull();
});

test("only the state the server calls in progress is counted as in progress; an unknown state is named as unknown and counted as nothing", () => {
  mount([lifecycle({ status: "ON_HOLD" })]);
  const head = screen.getByRole("heading", { level: 2, name: "手続きの進み具合" }).closest(".ideal-panel__head")!;
  expect(head.querySelector(".ideal-pill")).toHaveTextContent("未対応の値");
  expect(head).not.toHaveTextContent("進行中");
  expect(cards()[0].querySelector(".ideal-pill")).toHaveTextContent("退職 · 未対応の値");
  expect(cards()[0].querySelector(".ideal-pill")).toHaveClass("ideal-pill--neutral");
  document.body.innerHTML = "";
  mount([lifecycle(), lifecycle({ case_id: "c2", status: "ON_HOLD" }), lifecycle({ case_id: "c3", status: "READY" })]);
  expect(screen.getByRole("heading", { level: 2, name: "手続きの進み具合" }).closest(".ideal-panel__head")!.querySelector(".ideal-pill")).toHaveTextContent("進行中 1件");
});
