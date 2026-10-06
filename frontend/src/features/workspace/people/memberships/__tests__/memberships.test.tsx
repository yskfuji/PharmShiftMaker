import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { MembershipRevision } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute, type RouteContext } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

// jsdom has no layout: a control that brings its task into view only needs the call to exist.
beforeEach(() => { Element.prototype.scrollIntoView = jest.fn(); });
afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const member = (over: Partial<MembershipRevision>): MembershipRevision => ({
  membership_id: "m-admin", issuer: "mock", subject: "admin-account", person_id: "synthetic-admin", scope_id: "synthetic/clinical-pharmacy", role: "ADMIN", active: true, revision: 1,
  evidence: {}, created_by: "", created_at: "2026-10-01T09:00:00+09:00", deactivated_at: null, ...over,
});
const pharmacist = member({ membership_id: "m-ph", subject: "ph-account", person_id: "synthetic-pharmacist", role: "PHARMACIST", revision: 4 });
const leaderAdmin = member({ membership_id: "m-lead", subject: "lead-account", person_id: "synthetic-leader", revision: 2 });

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

async function mount(data: MembershipRevision[], answer: (call: Call) => unknown = () => [], over: Partial<RouteContext> = {}) {
  const ctx = { ...syntheticContext("ADMIN"), ...over };
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  const tree = (value: MembershipRevision[]) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider>;
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(tree(data)); });
  return { calls, refresh, show: (value: MembershipRevision[]) => view.rerender(tree(value)) };
}

function fillEvidence(scope: HTMLElement) {
  fireEvent.change(within(scope).getByLabelText(/^理由/), { target: { value: "異動の連絡" } });
  fireEvent.change(within(scope).getByLabelText(/^参照/), { target: { value: "HR-1012" } });
}
const rowOf = (subject: string) => screen.getAllByRole("row").find((row) => row.textContent?.includes(subject))!;
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");

test("the route reads the active links and nothing else", async () => {
  const { calls, client } = api(() => [pharmacist]);
  const state = await readRoute(route, client, syntheticContext("ADMIN"));
  expect(state).toMatchObject({ kind: "ready", partial: [], data: [pharmacist] });
  expect(calls).toEqual([{ method: "GET", path: `/memberships?${SCOPE}&include_inactive=false`, body: undefined }]);
  expect(route.names).toBe("roster");
});

test("the showcase shows the links, and the route's own words when there are none", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="people" view="memberships" role="ADMIN" />);
  const table = await screen.findByRole("region", { name: "紐付けの一覧" });
  // The active links only, as the API answers without `include_inactive`.
  expect(within(table).getAllByRole("row")).toHaveLength(4);
  expect(table).toHaveTextContent("高橋 葵薬剤師synthetic-pharmacist有効 第1版");
  expect(table).toHaveTextContent("ヴァンデンバーグ 絵里香クリスティーナ薬剤師synthetic-newcomer-erika-christina-vandenberg@example.invalid有効 第1版");
  expect(table).not.toHaveTextContent("鈴木 悠斗");
  // The viewer's own link, and the only active administrator, cannot be deactivated here.
  expect(table).toHaveTextContent("自分自身の所属は無効にできません。別の管理者に依頼してください。");
  expect(screen.getByText("本人アカウントを紐付ける")).toBeInTheDocument();
  // Asked for, the deactivated link is listed too, with nothing to do about it.
  await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "無効も表示" })); });
  const wider = await screen.findByRole("row", { name: /鈴木 悠斗/ });
  expect(wider).toHaveTextContent("鈴木 悠斗薬剤部責任者synthetic-leader無効 第2版なし");
  expect(within(screen.getByRole("region", { name: "紐付けの一覧" })).getAllByRole("row")).toHaveLength(5);
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="people" view="memberships" role="ADMIN" state="empty" />);
  expect(await screen.findByText("紐付けはありません。")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 3, name: "アカウントを紐付ける" })).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the person the URL names narrows the table and starts the link form", async () => {
  const { show } = await mount([member({}), pharmacist], () => [], { selectedPersonId: "synthetic-leader" });
  expect(screen.getByText("選択した職員の紐付けはありません。")).toBeInTheDocument();
  expect(screen.getByLabelText("職員")).toHaveValue("synthetic-leader");
  show([member({}), pharmacist, leaderAdmin]);
  expect(within(screen.getByRole("region", { name: "紐付けの一覧" })).getAllByRole("row")).toHaveLength(2);
  expect(rowOf("lead-account")).toHaveTextContent("鈴木 悠斗システム管理者lead-account有効 第2版");
});

test("the people of the roster without an active link are listed under the table, with the way to the task that links one", async () => {
  const names = () => { const list = screen.queryByRole("list", { name: "有効な紐付けのない職員" }); return list ? within(list).getAllByRole("listitem").map((item) => item.textContent) : null; };
  // The roster has four people; the listing links two of them.
  const { show, calls } = await mount([member({}), pharmacist]);
  expect(screen.getByRole("heading", { level: 3, name: "有効な紐付けのない職員（2人）" })).toBeInTheDocument();
  expect(names()).toEqual(["鈴木 悠斗", "ヴァンデンバーグ 絵里香クリスティーナ"]);
  // The control opens the link task and reads nothing; the person is chosen in the form.
  const task = screen.getByText("本人アカウントを紐付ける", { selector: "summary" }).closest("details")!;
  expect(task.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "紐付けの入力へ進む" }));
  expect(task.open).toBe(true);
  expect(calls).toEqual([]);
  // A link that is not active does not count as one: its person is still listed.
  show([member({}), pharmacist, { ...leaderAdmin, active: false }]);
  expect(names()).toEqual(["鈴木 悠斗", "ヴァンデンバーグ 絵里香クリスティーナ"]);
  show([member({}), pharmacist, leaderAdmin, member({ membership_id: "m-new", subject: "new-account", person_id: "synthetic-newcomer", role: "PHARMACIST" })]);
  expect(names()).toBeNull();
  expect(screen.queryByRole("button", { name: "紐付けの入力へ進む" })).toBeNull();
});

test("with a person chosen in the URL only that person is looked at", async () => {
  await mount([member({}), pharmacist], () => [], { selectedPersonId: "synthetic-leader" });
  expect(within(screen.getByRole("list", { name: "有効な紐付けのない職員" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["鈴木 悠斗"]);
});

test("the two values of the sign-in service are named in plain words on screen; their own terms are in the fields' names and in a reveal", async () => {
  await mount([member({})]);
  const form = screen.getByRole("form", { name: "アカウントを紐付ける" });
  // The names the journeys and assistive technology use are unchanged.
  for (const [name, term] of [["発行者（issuer）", "（issuer）"], ["アカウント（subject）", "（subject）"]]) {
    const label = form.querySelector(`label[for="${within(form).getByLabelText(name).id}"]`)!;
    expect(label.textContent).toBe(name);
    // On screen the label is the plain word: the term is for assistive technology only.
    expect(Array.from(label.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("")).toBe(name.replace(term, ""));
    expect(label.querySelector(".sr-only")).toHaveTextContent(term);
  }
  const terms = within(form).getByText("担当者に伝える項目の名前").closest("details")!;
  expect(terms.open).toBe(false);
  expect(terms).toHaveTextContent("認証サービスの用語では、「発行者」は issuer、「アカウント」は subject と呼ばれます。");
});

test("the last active administrator is told why there is no button", async () => {
  await mount([member({ person_id: "synthetic-leader" }), pharmacist]);
  expect(rowOf("admin-account")).toHaveTextContent("最後の有効な管理者は無効にできません。");
  expect(within(rowOf("ph-account")).getByRole("button", { name: "無効にする" })).toBeInTheDocument();
});

test("linking sends the form against version 0; an unknown outcome keeps its key", async () => {
  let attempts = 0;
  const { calls, refresh, show } = await mount([member({})], (call) => {
    if (call.method === "POST" && ++attempts === 1) throw new PlanningError(503, "down");
    return pharmacist;
  });
  const form = screen.getByRole("heading", { level: 3, name: "アカウントを紐付ける" }).parentElement!;
  fireEvent.change(within(form).getByLabelText("発行者（issuer）"), { target: { value: "mock" } });
  fireEvent.change(within(form).getByLabelText("アカウント（subject）"), { target: { value: "ph-account" } });
  fireEvent.change(within(form).getByLabelText("職員"), { target: { value: "synthetic-pharmacist" } });
  fireEvent.change(within(form).getByLabelText("役割"), { target: { value: "LEADER" } });
  fillEvidence(form);
  fireEvent.click(within(form).getByRole("button", { name: "紐付ける" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(form).getByRole("button", { name: "紐付ける" }));
  await waitFor(() => expect(within(form).getByRole("status")).toHaveTextContent("紐付けました。"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /memberships?${SCOPE}`));
  const [first, second] = calls.map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ issuer: "mock", subject: "ph-account", person_id: "synthetic-pharmacist", role: "LEADER", expected_version: 0, evidence: { reason: "異動の連絡", reference: "HR-1012" }, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  // The table is drawn from what the route reads next, not from the form.
  expect(screen.queryByText("ph-account")).toBeNull();
  show([member({}), pharmacist]);
  expect(screen.getByRole("region", { name: "紐付けの一覧" })).toHaveTextContent("ph-account");
});

test("a conflict on linking is shown in the form and keeps what was entered", async () => {
  const { refresh } = await mount([member({})], () => { throw new PlanningError(409, "stale"); }, { selectedPersonId: "synthetic-pharmacist" });
  const form = screen.getByRole("heading", { level: 3, name: "アカウントを紐付ける" }).parentElement!;
  fireEvent.change(within(form).getByLabelText("発行者（issuer）"), { target: { value: "mock" } });
  fireEvent.change(within(form).getByLabelText("アカウント（subject）"), { target: { value: "ph-account" } });
  fillEvidence(form);
  fireEvent.click(within(form).getByRole("button", { name: "紐付ける" }));
  expect(await within(form).findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(within(form).getByLabelText("アカウント（subject）")).toHaveValue("ph-account");
  expect(refresh).not.toHaveBeenCalled();
});

test("deactivating asks for evidence and is sent against the revision on screen", async () => {
  let attempts = 0;
  const { calls, refresh, show } = await mount([member({}), pharmacist], (call) => {
    if (call.method === "POST" && ++attempts === 1) throw new PlanningError(503, "down");
    return { ...pharmacist, active: false, revision: 5 };
  });
  const row = rowOf("ph-account");
  fireEvent.click(within(row).getByRole("button", { name: "無効にする" }));
  expect(within(row).getByRole("button", { name: "無効にする" })).toBeDisabled();
  expect(within(row).getByRole("button", { name: "無効にする" })).toHaveAccessibleDescription("理由と参照を3文字以上入力すると押せます。");
  fillEvidence(row);
  expect(within(row).getByRole("button", { name: "無効にする" })).not.toHaveAttribute("aria-describedby");
  fireEvent.click(within(row).getByRole("button", { name: "無効にする" }));
  expect(await within(row).findByRole("alert")).toHaveTextContent("結果を確認できません");
  fireEvent.click(within(row).getByRole("button", { name: "無効にする" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /memberships/m-ph/deactivate?${SCOPE}`));
  const [first, second] = calls.map((call) => call.body as Record<string, unknown>);
  expect(first).toEqual({ expected_version: 4, evidence: { reason: "異動の連絡", reference: "HR-1012" }, idempotency_key: expect.any(String) });
  expect(second).toEqual(first);
  show([member({})]);
  expect(screen.queryByText("ph-account")).toBeNull();
});

test("a conflict on deactivating is shown in the row; cancelling closes the form", async () => {
  const { refresh } = await mount([member({}), pharmacist], () => { throw new PlanningError(409, "stale"); });
  const row = rowOf("ph-account");
  fireEvent.click(within(row).getByRole("button", { name: "無効にする" }));
  fillEvidence(row);
  fireEvent.click(within(row).getByRole("button", { name: "無効にする" }));
  expect(await within(row).findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByRole("button", { name: "やめる" }));
  expect(within(row).queryByRole("group")).toBeNull();
});

test("inactive links are read on demand, and again when the route's read changes", async () => {
  const inactive = { ...pharmacist, active: false, revision: 5 };
  const { calls, show } = await mount([member({}), pharmacist], (call) => call.method === "GET" ? [member({}), inactive] : inactive);
  expect(calls).toEqual([]);
  fireEvent.click(screen.getByRole("checkbox", { name: "無効も表示" }));
  await waitFor(() => expect(rowOf("ph-account")).toHaveTextContent("無効 第5版"));
  expect(within(rowOf("ph-account")).queryByRole("button")).toBeNull();
  show([member({})]);
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`GET /memberships?${SCOPE}&include_inactive=true`));
  expect(posts(calls)).toEqual([]);
  await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: "無効も表示" })); });
  expect(screen.queryByText("ph-account")).toBeNull();
});
