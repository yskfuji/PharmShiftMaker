import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { ScheduleChangeCase } from "@/ideal/types";
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
const when = { start: "2026-10-12T10:30:00+09:00", end: "2026-10-12T19:30:00+09:00", kind: "遅番", task: "調剤", location: "薬剤部" };
const options = { publication_id: "synthetic-publication-12", publication_version: 12, duty_id: "synthetic-duty-1", kind: "SWAP", consent_required: true, options: [
  // The server names the counterpart for an exchange; without a name the person stays unnamed.
  { option_id: "o-named", affected_assignment_ids: ["synthetic-duty-1", "synthetic-duty-2"], proposed_assignment_ids: ["x1", "x2"], counterpart: { person_id: "synthetic-leader", display_name: "鈴木 悠斗" }, duty: when, publishable: true, finding_count: 0 },
  { option_id: "o-unnamed", affected_assignment_ids: ["synthetic-duty-1", "d9"], proposed_assignment_ids: ["x3", "x4"], counterpart: { person_id: "synthetic-admin", display_name: null }, duty: when, publishable: false, finding_count: null },
] };
const created: ScheduleChangeCase = {
  case_id: "c-new", scope_id: "synthetic/clinical-pharmacy", publication_id: "synthetic-publication-12", kind: "SWAP", status: "AWAITING_CONSENT", version: 1,
  affected_assignments: [], proposed_assignments: [], validation: null, evidence: {}, created_by: "synthetic-pharmacist", created_at: "2026-10-12T08:00:00+09:00", updated_at: "2026-10-12T08:00:00+09:00",
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

async function mount(data: ScheduleChangeCase[], answer: (call: Call) => unknown) {
  const ctx = syntheticContext("PHARMACIST");
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  const tree = (value: ScheduleChangeCase[]) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider>;
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(tree(data)); });
  return { calls, refresh, show: (value: ScheduleChangeCase[]) => view.rerender(tree(value)) };
}

function fillEvidence(scope: HTMLElement) {
  fireEvent.change(within(scope).getByLabelText(/^理由/), { target: { value: "研修と重なる" } });
  fireEvent.change(within(scope).getByLabelText(/^参照/), { target: { value: "TRAIN-22" } });
}
const newRequest = () => screen.getByRole("heading", { level: 2, name: "新しい申請" }).closest("section")!;
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");

test("the route reads the change cases the server lets the viewer see, and nothing else", async () => {
  const { calls, client } = api(() => [created]);
  const state = await readRoute(route, client, syntheticContext("LEADER"));
  expect(state).toMatchObject({ kind: "ready", partial: [], data: [created] });
  expect(calls).toEqual([{ method: "GET", path: `/change-cases?${SCOPE}`, body: undefined }]);
  expect(route.names).toBe("planning");
});

test("the showcase shows the exchange route, and its own words when there are no cases", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const shown = render(<CognitiveWorkspaceShowcase screen="requests" view="swap" role="PHARMACIST" />);
  expect(await screen.findByRole("heading", { level: 2, name: "相手の同意と責任者判断" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "申請中・同意の依頼" })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "ケース一覧" })).toBeInTheDocument();
  expect(screen.getByText("新しい勤務交換を依頼")).toBeInTheDocument();
  shown.unmount();
  render(<CognitiveWorkspaceShowcase screen="requests" view="swap" role="PHARMACIST" state="empty" />);
  expect(await screen.findByText("いま対応が必要なケースはありません。")).toBeInTheDocument();
  expect(screen.getByText("新しい勤務交換を依頼")).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the first card is the exchange's own: no pointer to leave, and a way to the new exchange", async () => {
  Element.prototype.scrollIntoView = jest.fn();
  await mount([created], () => options);
  const intro = screen.getByRole("heading", { level: 2, name: "相手の同意と責任者判断" }).closest("section")!;
  expect(intro.querySelector(".ideal-eyebrow")).toBeNull();
  expect(intro).toHaveTextContent("勤務の交換は、相手の同意のあと責任者が判断します。");
  expect(screen.queryByRole("link", { name: "休暇の画面" })).toBeNull();
  expect(document.body).not.toHaveTextContent("希望休・年休");
  const task = screen.getByText("新しい勤務交換を依頼", { selector: "summary" }).closest("details")!;
  expect(task.parentElement).toHaveClass("ideal-v3-task--primary");
  fireEvent.click(within(intro).getByRole("button", { name: "交換を依頼する" }));
  expect(task.open).toBe(true);
});

test("an exchange names a counterpart the server offered; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  const { calls, refresh, show } = await mount([], (call) => {
    if (call.method === "GET") return options;
    if (++attempts === 1) throw new PlanningError(503, "down");
    return created;
  });
  const form = newRequest();
  // An exchange only: no choice of kind, and no "nobody" option.
  expect(within(form).queryByRole("group", { name: "種類" })).toBeNull();
  fireEvent.change(within(form).getByLabelText("勤務"), { target: { value: "synthetic-duty-1" } });
  const counterpart = await within(form).findByRole("radio", { name: /鈴木 悠斗/ });
  expect(calls).toEqual([{ method: "GET", path: `/change-cases/options?${SCOPE}&publication_id=synthetic-publication-12&duty_id=synthetic-duty-1&kind=SWAP`, body: undefined }]);
  expect(within(form).getByText("選んだ相手の同意を得てから、責任者が承認します。")).toBeInTheDocument();
  // No name from the server: the pharmacist is not told who the other person is.
  expect(within(form).getByRole("radio", { name: /相手の職員/ }).closest("label")).toHaveTextContent("指摘あり");
  expect(within(form).getAllByRole("radio")).toHaveLength(2);
  fireEvent.click(counterpart);
  fillEvidence(form);
  fireEvent.click(within(form).getByRole("button", { name: "申請する" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  // The draft is kept for the retry.
  expect(counterpart).toBeChecked();
  fireEvent.click(within(form).getByRole("button", { name: "申請する" }));
  await waitFor(() => expect(within(form).getByText("申請しました。同意を求めた人の返事を待っています。")).toHaveAttribute("role", "status"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(posts(calls).map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /change-cases?${SCOPE}`));
  const [first, second] = posts(calls).map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ publication_id: "synthetic-publication-12", kind: "SWAP", affected_assignment_ids: ["synthetic-duty-1", "synthetic-duty-2"], proposed_assignment_ids: ["x1", "x2"], evidence: { reason: "研修と重なる", reference: "TRAIN-22" }, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  // The new case is listed from what the route reads next.
  expect(screen.queryByRole("list", { name: "ケース一覧" })).toBeNull();
  show([created]);
  expect(within(screen.getByRole("list", { name: "ケース一覧" })).getByRole("button")).toHaveTextContent("勤務交換 · 同意待ち");
});

test("a conflict on a new exchange is shown in the form and keeps the draft", async () => {
  const { refresh } = await mount([], (call) => {
    if (call.method === "GET") return options;
    throw new PlanningError(409, "Publication version changed");
  });
  const form = newRequest();
  fireEvent.change(within(form).getByLabelText("勤務"), { target: { value: "synthetic-duty-1" } });
  fireEvent.click(await within(form).findByRole("radio", { name: /鈴木 悠斗/ }));
  fillEvidence(form);
  fireEvent.click(within(form).getByRole("button", { name: "申請する" }));
  const alert = await within(form).findByRole("alert");
  expect(alert).toHaveTextContent("409");
  expect(alert).toHaveTextContent("新しい変更があります");
  expect(within(form).getByLabelText("勤務")).toHaveValue("synthetic-duty-1");
  expect(within(form).getByLabelText(/^理由/)).toHaveValue("研修と重なる");
  expect(refresh).not.toHaveBeenCalled();
});

test("options that cannot be read are reported in the form, and nothing can be sent", async () => {
  await mount([], () => { throw new PlanningError(503, "down"); });
  const form = newRequest();
  fireEvent.change(within(form).getByLabelText("勤務"), { target: { value: "synthetic-duty-1" } });
  expect(await within(form).findByRole("alert")).toHaveTextContent("読み込めませんでした");
  fillEvidence(form);
  expect(within(form).getByRole("button", { name: "申請する" })).toBeDisabled();
});
