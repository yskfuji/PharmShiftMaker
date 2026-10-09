import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole, ScheduleChangeCase } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute, type RouteContext } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import { requestVerbs } from "../../verbs";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const duty = (id: string, person: string, day: number) => ({ duty_id: id, person_id: person, kind: "日勤", task: "調剤", location: "中央", start: `2026-10-${day}T08:30:00+09:00`, end: `2026-10-${day}T17:15:00+09:00` });
const caseRow = (over: Partial<ScheduleChangeCase>): ScheduleChangeCase => ({
  case_id: "c-mine", scope_id: "synthetic/clinical-pharmacy", publication_id: "synthetic-publication-12", kind: "ABSENCE", status: "READY", version: 1,
  affected_assignments: [duty("d1", "synthetic-pharmacist", 13)], proposed_assignments: [],
  validation: { findings: [], publishable: true, required_consent_person_ids: [], consented_person_ids: [], replacement_duty_ids: [] },
  evidence: {}, created_by: "synthetic-pharmacist", created_at: "2026-10-12T07:00:00+09:00", updated_at: "2026-10-12T07:30:00+09:00", ...over,
});
const mine = caseRow({});
// Another person's exchange that asks the pharmacist to take over a duty.
const asked = caseRow({ case_id: "c-asked", kind: "SWAP", status: "AWAITING_CONSENT", version: 2, created_by: "",
  affected_assignments: [duty("d2", "synthetic-leader", 14)], proposed_assignments: [duty("r2", "synthetic-pharmacist", 14)],
  validation: { findings: [], required_consent_person_ids: ["synthetic-pharmacist"], consented_person_ids: [], replacement_duty_ids: ["r2"] } });
const others = caseRow({ case_id: "c-others", version: 5, affected_assignments: [duty("d3", "synthetic-admin", 15)], created_by: "synthetic-admin" });

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

async function mount(data: ScheduleChangeCase[], answer: (call: Call) => unknown = () => [], role: IdealRole = "PHARMACIST", over: Partial<RouteContext> = {}) {
  const ctx = { ...syntheticContext(role), ...over };
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
  fireEvent.change(within(scope).getByLabelText(/^理由/), { target: { value: "家庭の事情" } });
  fireEvent.change(within(scope).getByLabelText(/^参照/), { target: { value: "MAIL-1012" } });
}
const EVIDENCE = { reason: "家庭の事情", reference: "MAIL-1012" };
const detail = () => screen.getByRole("article");
const newRequest = () => screen.getByRole("heading", { level: 2, name: "新しい申請" }).closest("section")!;

test("the route reads the change cases the server lets the viewer see, and nothing else", async () => {
  const { calls, client } = api(() => [mine]);
  const state = await readRoute(route, client, syntheticContext("PHARMACIST"));
  expect(state).toMatchObject({ kind: "ready", partial: [], data: [mine] });
  expect(calls).toEqual([{ method: "GET", path: `/change-cases?${SCOPE}`, body: undefined }]);
  expect(route.names).toBe("planning");
});

test("the showcase shows the viewer's cases, and the route's own words when there are none", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const shown = render(<CognitiveWorkspaceShowcase screen="requests" view="mine" role="PHARMACIST" />);
  expect(await screen.findByRole("heading", { level: 2, name: "申請の状態と新しい申請" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "休暇の画面" })).toHaveAttribute("href", "/workspace/requests/leave");
  expect(within(screen.getByRole("list", { name: "ケース一覧" })).getAllByRole("button")).toHaveLength(2);
  // A pharmacist is given no roster, so both cases are between 「あなた」 and 「相手の職員」: a
  // row is told from the other by the viewer's own duties in it, and names nobody else.
  const rows = within(screen.getByRole("list", { name: "ケース一覧" })).getAllByRole("button").map((item) => item.textContent);
  expect(rows).toEqual([
    "勤務交換 · 同意待ちあなたの勤務：外す 10月12日（月） 08:30–17:30／入る 10月12日（月） 10:30–19:30第2版",
    "欠勤 · 承認待ちあなたの勤務：外す 10月12日（月） 08:30–17:30第3版",
  ]);
  expect(new Set(rows).size).toBe(2);
  // A pharmacist is given no roster: the other person is not named.
  expect(detail()).toHaveTextContent("入る相手の職員 · 10月12日（月） 08:30–17:30");
  expect(detail()).toHaveTextContent("同意 1 / 2");
  expect(detail()).not.toHaveTextContent("鈴木 悠斗");
  expect(screen.getByText("新しい欠勤・交換を申請")).toBeInTheDocument();
  shown.unmount();
  render(<CognitiveWorkspaceShowcase screen="requests" view="mine" role="PHARMACIST" state="empty" />);
  expect(await screen.findByText("いま対応が必要なケースはありません。")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "新しい申請" })).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the first card says what the route is for, points to leave and leads to the new request", async () => {
  Element.prototype.scrollIntoView = jest.fn();
  await mount([mine]);
  const intro = screen.getByRole("heading", { level: 2, name: "申請の状態と新しい申請" }).closest("section")!;
  // The view's name is not repeated above the title.
  expect(intro.querySelector(".ideal-eyebrow")).toBeNull();
  expect(within(intro).getByRole("link", { name: "休暇の画面" })).toHaveClass("ideal-inline-link");
  const task = screen.getByText("新しい欠勤・交換を申請", { selector: "summary" }).closest("details")!;
  expect(task.parentElement).toHaveClass("ideal-v3-task--primary");
  expect(document.getElementById(task.querySelector("summary")!.getAttribute("aria-describedby") ?? "")).toHaveTextContent("公開された自分の勤務を選び、欠勤か交換かと、その理由を申請します。");
  expect(task.open).toBe(false);
  fireEvent.click(within(intro).getByRole("button", { name: "新しく申請する" }));
  expect(task.open).toBe(true);
  expect(screen.getByText("新しい欠勤・交換を申請", { selector: "summary" })).toHaveFocus();
});

test("what is offered on a request follows its state and who the viewer is", () => {
  expect(requestVerbs(asked, "synthetic-pharmacist", "PHARMACIST")).toEqual(["consent", "decline"]);
  expect(requestVerbs(mine, "synthetic-pharmacist", "PHARMACIST")).toEqual(["withdraw"]);
  // The server leaves the author empty on a case that is not the pharmacist's to withdraw.
  expect(requestVerbs({ ...mine, created_by: "" }, "synthetic-pharmacist", "PHARMACIST")).toEqual([]);
  expect(requestVerbs({ ...mine, created_by: "" }, "synthetic-leader", "LEADER")).toEqual(["withdraw"]);
  expect(requestVerbs({ ...mine, status: "WITHDRAWN" }, "synthetic-pharmacist", "PHARMACIST")).toEqual([]);
});

test("a pharmacist sees every returned case; a planner only the ones about their own duties", async () => {
  await mount([mine, asked, others]);
  expect(within(screen.getByRole("list", { name: "ケース一覧" })).getAllByRole("button")).toHaveLength(3);
  document.body.innerHTML = "";
  await mount([mine, asked, others], undefined, "LEADER");
  // Only the exchange removes one of the leader's own duties.
  expect(within(screen.getByRole("list", { name: "ケース一覧" })).getAllByRole("button").map((item) => item.textContent)).toEqual(["勤務交換 · 同意待ち鈴木 悠斗、高橋 葵第2版 · 10月14日（水）08:30"]);
  expect(detail()).toHaveTextContent("同意 0 / 1（まだ：高橋 葵）");
});

test("the case the URL names is shown; one that was not returned is never replaced silently", async () => {
  await mount([mine, asked], undefined, "PHARMACIST", { selectedCaseId: "c-asked" });
  expect(detail()).toHaveTextContent("選んだケースの内容（第2版）");
  document.body.innerHTML = "";
  await mount([mine, asked], undefined, "PHARMACIST", { selectedCaseId: "c-others" });
  expect(screen.getByRole("alert")).toHaveTextContent("指定されたケースを表示できません");
  fireEvent.click(screen.getByRole("button", { name: "一覧の先頭を開く" }));
  expect(detail()).toHaveTextContent("選んだケースの内容（第1版）");
});

test("a withdrawal is sent against the case version; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  const { calls, refresh, show } = await mount([mine], (call) => {
    if (call.method === "POST" && ++attempts === 1) throw new PlanningError(503, "down");
    return { ...mine, status: "WITHDRAWN", version: 2 };
  });
  fireEvent.click(within(detail()).getByRole("button", { name: "取り下げる" }));
  fillEvidence(detail());
  fireEvent.click(within(detail()).getByRole("button", { name: "取り下げる" }));
  expect(await within(detail()).findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(detail()).getByRole("button", { name: "取り下げる" }));
  expect(await screen.findByText("取り下げました。")).toHaveAttribute("role", "status");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /change-cases/c-mine/withdraw?${SCOPE}`));
  const [first, second] = calls.map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ expected_version: 1, evidence: EVIDENCE, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  // The case stays in the history as the server returns it next, with nothing left to do.
  show([{ ...mine, status: "WITHDRAWN", version: 2 }]);
  expect(detail()).toHaveTextContent("取下げ");
  expect(within(detail()).queryByRole("button")).toBeNull();
  expect(screen.getByText("取り下げました。")).toBeInTheDocument();
});

test("a consent asked of the viewer is answered here; a conflict is shown on the case", async () => {
  const { calls, refresh } = await mount([asked, mine], () => { throw new PlanningError(409, "Change case revision or status changed"); });
  fireEvent.click(within(detail()).getByRole("button", { name: "同意する" }));
  fillEvidence(detail());
  fireEvent.click(within(detail()).getByRole("button", { name: "同意する" }));
  const alert = await within(detail()).findByRole("alert");
  expect(alert).toHaveTextContent("409");
  expect(alert).toHaveTextContent("新しい変更があります");
  expect(within(detail()).getByLabelText(/^参照/)).toHaveValue("MAIL-1012");
  expect(calls).toEqual([{ method: "POST", path: `/change-cases/c-asked/consent?${SCOPE}`, body: { expected_version: 2, evidence: EVIDENCE, idempotency_key: expect.any(String) } }]);
  expect(refresh).not.toHaveBeenCalled();
});

test("a pharmacist who may not name a replacement applies for an absence without one", async () => {
  const { calls, refresh } = await mount([], (call) => {
    if (call.method === "GET") throw new PlanningError(403, "A pharmacist may not name a replacement for an absence");
    return { ...mine, case_id: "c-new" };
  });
  const form = newRequest();
  expect(within(form).getByText("公開版 v12 の自分の勤務")).toBeInTheDocument();
  // Only the viewer's own duty is offered, and either kind of case.
  expect(Array.from(within(form).getByLabelText("勤務").querySelectorAll("option")).map((item) => item.textContent)).toEqual(["選んでください", "あなた · 10月12日（月） 08:30–17:30 · 日勤"]);
  expect(within(within(form).getByRole("group", { name: "種類" })).getAllByRole("radio")).toHaveLength(2);
  fireEvent.change(within(form).getByLabelText("勤務"), { target: { value: "synthetic-duty-1" } });
  expect(await within(form).findByText("この施設・部署では、薬剤師は代わりの人を指名できません。代わりは責任者が決めます。")).toBeInTheDocument();
  expect(calls).toEqual([{ method: "GET", path: `/change-cases/options?${SCOPE}&publication_id=synthetic-publication-12&duty_id=synthetic-duty-1&kind=ABSENCE`, body: undefined }]);
  fireEvent.click(within(form).getByRole("radio", { name: /代わりを指定しない/ }));
  fillEvidence(form);
  fireEvent.click(within(form).getByRole("button", { name: "申請する" }));
  await waitFor(() => expect(within(form).getByText("申請しました。責任者の承認を待っています。")).toHaveAttribute("role", "status"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls[1]).toEqual({ method: "POST", path: `/change-cases?${SCOPE}`,
    body: { publication_id: "synthetic-publication-12", kind: "ABSENCE", affected_assignment_ids: ["synthetic-duty-1"], proposed_assignment_ids: [], evidence: EVIDENCE, idempotency_key: expect.any(String) } });
});

test("choosing an exchange asks the server for counterparts of that kind", async () => {
  const { calls } = await mount([], () => ({ publication_id: "synthetic-publication-12", publication_version: 12, duty_id: "synthetic-duty-1", kind: "SWAP", consent_required: true, options: [] }));
  const form = newRequest();
  fireEvent.change(within(form).getByLabelText("勤務"), { target: { value: "synthetic-duty-1" } });
  fireEvent.click(within(form).getByRole("radio", { name: "交換（相手と入れ替え）" }));
  expect(await within(form).findByRole("group", { name: "交換の相手" })).toHaveTextContent("条件に合う候補はありません。");
  expect(calls.map((call) => call.path)).toEqual(["ABSENCE", "SWAP"].map((kind) => `/change-cases/options?${SCOPE}&publication_id=synthetic-publication-12&duty_id=synthetic-duty-1&kind=${kind}`));
  // An exchange cannot be sent without a counterpart.
  expect(within(form).queryByRole("radio", { name: /代わりを指定しない/ })).toBeNull();
});

test("a viewer without a published duty is told so instead of being shown an empty form", async () => {
  await mount([], undefined, "ADMIN");
  expect(within(newRequest()).getByText("公開版 v12 に、申請できる勤務はありません。")).toBeInTheDocument();
});
