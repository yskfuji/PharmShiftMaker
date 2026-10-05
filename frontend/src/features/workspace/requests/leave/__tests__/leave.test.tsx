import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { hasUnsavedChanges } from "../../../shared/useUnsavedNavigation";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { ComplianceRow, LeaveReport, LeaveRequestRow } from "../../api";
import { sourceLink } from "../admin/GrantAssessmentForm";
import type { LeaveData } from "../LeaveView";
import { ledgerState, ownSources, unitsOf } from "../model";
import route from "../route";
import * as B from "../__fixtures__/bodies";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => { Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => B.UUID) }); });
afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const ME = "synthetic-pharmacist";
const request = (over: Partial<LeaveRequestRow> = {}): LeaveRequestRow => ({ request_id: "r1", person_id: ME, version: 1, kind: "PAID_LEAVE_V2", status: "PENDING", decision: null,
  payload: { start: "2026-01-06T09:00:00+09:00", end: "2026-01-06T17:00:00+09:00", unit: "day", quantity: 1, account_id: "g1", policy_id: "lp1", reference: "合成本人請求" }, ...over });
const wish = request({ request_id: "r2", kind: "PUBLIC_HOLIDAY_REQUEST", status: "APPROVED", version: 2, decision: { reference: "調整記録 1" }, payload: { start: "2026-01-10T09:00:00+09:00", end: "2026-01-10T17:00:00+09:00" } });
const other = request({ request_id: "r3", person_id: "synthetic-leader", status: "REQUIRES_DISCUSSION", version: 2, decision: { reference: "相談記録" }, payload: { start: "2026-01-08T13:00:00+09:00", end: "2026-01-08T15:00:00+09:00", unit: "hour", quantity: 2 } });
const days = (numerator: number, denominator = 1) => ({ numerator, denominator });
const report: LeaveReport = {
  balances: [{ account_id: "g1", person_id: ME, remaining_days: days(5), reserved_days: days(1), available_days: days(9, 2), expired: false, person_name: "高橋 葵", employer_name: "合成病院", granted_on: "2026-01-01" }],
  obligations: [{ obligation_id: "o1", person_id: ME, required_half_days: 10, taken_half_days: 3, status: "at_risk", end: "2027-01-01", start: "2026-01-01", person_name: "高橋 葵", employer_name: "合成病院" }],
  findings: [{ rule_id: "leave.v2", status: "unverified", message: "Unverified external HR grant", subjects: ["g1"] }], requires_hr_reconciliation: true,
};
// The records as a planner is given them: the viewer's and another person's.
const records: ComplianceRow[] = [...B.RECORDS.map((row) => (row.kind === "leave_account" || row.kind === "leave_policy" ? { ...row, payload: { ...row.payload, person_id: ME } } : row)),
  { kind: "leave_policy", entity_id: "lp-other", revision: 1, payload: { ...B.POLICY, policy_id: "lp-other", person_id: "synthetic-leader", half_day_enabled: true } }];
const data = (over: Partial<LeaveData> = {}): LeaveData => ({ requests: [request(), wish, other], ledger: ledgerState(report), sources: ownSources(records, ME), ...over });

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
function tree(answer: (call: Call) => unknown, role: IdealRole) {
  const ctx = syntheticContext(role);
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  let keys = 0;
  const live = liveFrom(ctx, { client, mutate: createMutator("test", () => `idempotency-key-${++keys}`), refresh });
  const View = route.View;
  return { calls, refresh, node: (value: LeaveData) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider> };
}
/** Answers a change with `done`, and the on-demand reads of the ledger tasks from the fixtures. */
const serve = (done: unknown = { status: "PENDING", version: 1 }) => (call: Call): unknown =>
  call.method !== "GET" ? done : call.path.startsWith("/compliance/workflow-context") ? B.LEDGER_CONTEXT : call.path.startsWith("/compliance/grant-assessments/context") ? B.ASSESSMENT_CONTEXT : [request()];
async function mount(value: LeaveData = data(), answer: (call: Call) => unknown = serve(), role: IdealRole = "PHARMACIST") {
  const { node, ...rest } = tree(answer, role);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node(value)); });
  return { ...rest, show: (next: LeaveData) => view.rerender(node(next)) };
}

const task = (summary: string | RegExp) => screen.getByText(summary, { selector: "summary" }).closest("details")!;
const open = async (summary: string | RegExp) => { const details = task(summary); details.open = true; await act(async () => { fireEvent(details, new Event("toggle")); }); return details; };
const starts = (label: string) => (text: string) => text.startsWith(label);
/** The field with exactly this label, or the only one whose label starts with it. */
const field = (summary: string | RegExp, label: string) => within(task(summary)).queryByLabelText(label) ?? within(task(summary)).getByLabelText(starts(label));
const set = (summary: string | RegExp, label: string, value: string) => fireEvent.change(field(summary, label), { target: { value } });
const press = (summary: string | RegExp, name: string) => fireEvent.click(within(task(summary)).getByRole("button", { name }));
const confirm = async (summary: string | RegExp, name: string) => { await act(async () => { press(summary, name); }); };
const surface = (summary: string | RegExp) => task(summary).querySelector(".ideal-confirm") as HTMLElement;
const line = (summary: string | RegExp, term: string) => within(surface(summary)).getByText(term, { selector: "dt" }).parentElement!;
const changes = (summary: string | RegExp) => within(line(summary, "変更内容")).getAllByRole("listitem").map((item) => item.textContent);
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");
const sent = (calls: Call[], index = 0) => { const { idempotency_key: key, ...body } = posts(calls)[index].body as Record<string, unknown>; expect(key).toEqual(expect.any(String)); return { path: posts(calls)[index].path, body }; };
const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const WISH = "公休の希望を出す";
const CLAIM = "年次有給休暇を請求する（日・半日・時間）";
const WITHDRAW = "自分の申請を取り下げる";
const REVIEW = /^申請を確認する/;
const ASOF = "過去時点の年休台帳と訂正履歴を照会する";

test("the route reads the requests, the ledger and the viewer's own grants and rules; nothing an administrator's task needs", async () => {
  const { calls, client } = api((call) => (call.path.startsWith("/requests") ? [request()] : call.path.startsWith("/compliance/leave-report") ? { ...report, live_intervals: [{ person_id: "synthetic-leader" }] } : records));
  const state = await readRoute(route, client, syntheticContext("PHARMACIST"));
  expect(state).toEqual({ kind: "ready", partial: [], data: { requests: [request()], ledger: ledgerState(report), sources: ownSources(records, ME) } });
  expect(calls).toEqual([
    { method: "GET", path: `/requests?${SCOPE}`, body: undefined },
    { method: "GET", path: `/compliance/leave-report?${SCOPE}`, body: undefined },
    { method: "GET", path: `/compliance/records?${SCOPE}`, body: undefined },
  ]);
  expect(route.names).toBe("planning");
  // Only the viewer's own grants and rules are kept of the records, and of the report only what is shown.
  const kept = JSON.stringify((state as { data: LeaveData }).data);
  expect(kept).not.toContain("lp-other");
  expect(kept).not.toContain("live_intervals");
  expect((state as { data: LeaveData }).data.sources).toEqual({ grants: [{ account_id: "g1", granted_on: "2026-01-01", expires_on: "2028-01-01", granted_days: 5 }],
    policies: [{ policy_id: "lp1", start: "2026-01-01T00:00:00+09:00", end: "2028-01-01T00:00:00+09:00", hours_per_day: 4, hourly_quantum: 1, hourly_enabled: true, half_day_enabled: false }] });
});

test("a ledger or records read that fails is reported beside the rest; without the requests the route is a problem", async () => {
  const partial = api((call) => { if (call.path.startsWith("/requests")) return [request()]; throw new PlanningError(409, "版2の確認済み入力が必要です。"); });
  expect(await readRoute(route, partial.client, syntheticContext("LEADER"))).toEqual({ kind: "ready", data: { requests: [request()], ledger: null, sources: null },
    partial: [{ resource: "年休台帳", status: 409, detail: "版2の確認済み入力が必要です。" }, { resource: "年休の付与・規則", status: 409, detail: "版2の確認済み入力が必要です。" }] });
  const refused = api(() => { throw new PlanningError(423, "restricted"); });
  expect(await readRoute(route, refused.client, syntheticContext("LEADER"))).toEqual({ kind: "problem", status: 423, detail: "restricted" });
  // An unread ledger is "not confirmed", never a zero balance; the claim says why it cannot be made.
  await mount(data({ ledger: null, sources: null }));
  expect(panel("現在の状態")).toHaveTextContent("年休残高と取得義務は未確認です。サーバーが台帳を計算できなかったため、残高ゼロや問題なしを意味しません。");
  expect(screen.queryByRole("region", { name: "年休残高" })).toBeNull();
  expect(within(task(CLAIM)).getByText(/年休の付与と取得規則を読み取れなかったため、いまは請求できません。/)).toBeInTheDocument();
  expect(within(task(WISH)).getByLabelText("希望する休みの開始（日本時間）")).toBeInTheDocument();
});

test("first the current state, the next step and the history; no form is open and nothing is read", async () => {
  const { calls } = await mount();
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["残高・申請の状態と次の操作", "現在の状態", "次の操作", "履歴"]);
  expect(within(screen.getByRole("region", { name: "年休残高" })).getAllByRole("row").map((item) => item.textContent)).toEqual(["付与（本人／雇用主／付与日）利用可能付与の状態", "高橋 葵／合成病院／付与日 2026-01-019/2 日有効"]);
  expect(within(screen.getByRole("region", { name: "年5日の取得管理" })).getAllByRole("row")[1]).toHaveTextContent("高橋 葵／合成病院2026-01-01 〜 2027-01-011.5／5 日期限前・取得不足の見込み");
  // What the server reports, in its words; the status is given a label.
  expect(panel("現在の状態")).toHaveTextContent("サーバーの指摘（1件）未確認：Unverified external HR grant");
  expect(panel("現在の状態")).toHaveTextContent("サーバーは、残高または記録に人事との照合が必要と答えています。");
  expect(within(screen.getByRole("region", { name: "あなたの申請（取下げ済みを除く）" })).getAllByRole("row").slice(1).map((item) => item.textContent)).toEqual([
    "あなた年次有給休暇2026-01-06 09:00 〜 2026-01-06 17:001日確認待ち—第1版", "あなた公休希望2026-01-10 09:00 〜 2026-01-10 17:00—確認済み調整記録 1第2版",
  ]);
  expect(within(screen.getByRole("region", { name: "申請の一覧（現在の版）" })).getAllByRole("row")).toHaveLength(4);
  expect(screen.getByText("確認が済んでいない申請 2件")).toBeInTheDocument();
  for (const summary of [WISH, CLAIM, WITHDRAW, ASOF]) expect(task(summary).open).toBe(false);
  expect(within(task(CLAIM)).getByLabelText("年休付与台帳")).not.toBeVisible();
  // The confirmation of requests and the ledger tasks are not a pharmacist's.
  expect(screen.queryByText(REVIEW)).toBeNull();
  expect(screen.queryByText("付与日数を訂正する")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(calls).toEqual([]);
  expect(document.body.innerHTML).not.toMatch(/href="\/(planning|settings|dashboard)/);
  expect(document.body.innerHTML).not.toMatch(/class="[^"]*\b(ui-|workflow-|ideal-v3-purpose)/);
  expect(document.body).not.toHaveTextContent(/PENDING|APPROVED|REQUIRES_DISCUSSION|PAID_LEAVE|synthetic-pharmacist|at_risk/);
});

test("the showcase shows each role what the API gives it, ready and empty", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const admin = render(<CognitiveWorkspaceShowcase screen="requests" view="leave" role="ADMIN" />);
  expect(await screen.findByRole("heading", { level: 2, name: "現在の状態" })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "年休残高" })).getAllByRole("row")).toHaveLength(3);
  expect(panel("現在の状態")).toHaveTextContent("サーバーの指摘（1件）");
  expect(within(screen.getByRole("region", { name: "申請の一覧（現在の版）" })).getAllByRole("row")).toHaveLength(5);
  expect(panel("現在の状態")).toHaveTextContent("進行中のあなたの申請はありません。");
  expect(screen.getByText("申請を確認する（確認待ち 2件）")).toBeInTheDocument();
  expect(screen.getByText("付与日数を訂正する")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "計画の「前提・取込」" })).toHaveAttribute("href", "/workspace/plan/input");
  admin.unmount();
  const leader = render(<CognitiveWorkspaceShowcase screen="requests" view="leave" role="LEADER" />);
  expect(await screen.findByText("申請を確認する（確認待ち 2件）")).toBeInTheDocument();
  expect(screen.queryByText("付与日数を訂正する")).toBeNull();
  leader.unmount();
  const pharmacist = render(<CognitiveWorkspaceShowcase screen="requests" view="leave" role="PHARMACIST" />);
  expect(await screen.findByRole("region", { name: "年休残高" })).toHaveTextContent("高橋 葵／東都医療センター（架空）／付与日 2026-04-019 日有効");
  expect(within(screen.getByRole("region", { name: "年休残高" })).getAllByRole("row")).toHaveLength(2);
  expect(within(screen.getByRole("region", { name: "申請の一覧（現在の版）" })).getAllByRole("row")).toHaveLength(4);
  expect(screen.queryByText(/サーバーの指摘/)).toBeNull();
  expect(screen.queryByText(REVIEW)).toBeNull();
  // The pharmacist's synthetic rule allows hourly leave and no half days.
  fireEvent.change(within(task(CLAIM)).getByLabelText("適用する年休規則"), { target: { value: "synthetic-policy-1" } });
  expect(within(within(task(CLAIM)).getByLabelText("請求する単位")).getAllByRole("option").map((option) => option.textContent)).toEqual(["日", "時間"]);
  pharmacist.unmount();
  render(<CognitiveWorkspaceShowcase screen="requests" view="leave" role="PHARMACIST" state="empty" />);
  expect(await screen.findByText("あなたに登録された年休の付与はありません。")).toBeInTheDocument();
  expect(screen.getByText("進行中のあなたの申請はありません。")).toBeInTheDocument();
  expect(screen.getByText("確認待ちの申請なし")).toBeInTheDocument();
  expect(within(task(CLAIM)).getByText(/請求に使える年休の付与または取得規則が、あなたには登録されていません。/)).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a wish for a day off: confirmed with the four statements, sent as the established form sent it, resent with its key after an unknown outcome", async () => {
  let attempts = 0;
  const { calls, refresh } = await mount(data(), () => { if (++attempts === 1) throw new PlanningError(503, "down"); return { request_id: "new", status: "PENDING" }; });
  task(WISH).open = true;
  set(WISH, "希望する休みの開始（日本時間）", "2026-01-06T09:00"); set(WISH, "希望する休みの終了（日本時間）", "2026-01-06T17:00");
  expect(hasUnsavedChanges()).toBe(true);
  press(WISH, "希望の内容を確認する");
  expect(calls).toEqual([]);
  expect(within(surface(WISH)).getByRole("heading", { level: 4, name: "2. 記録前の確認" })).toHaveFocus();
  expect(within(surface(WISH)).getAllByRole("term").map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
  expect(changes(WISH)).toEqual(["種類：（なし） → 公休希望", "希望する期間（日本時間）：（なし） → 2026-01-06 09:00 〜 2026-01-06 17:00", "状態：（なし） → 確認待ち"]);
  expect(line(WISH, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  expect(line(WISH, "通知")).toHaveTextContent("誰にも通知されません。管理者・責任者には、この画面の「申請を確認する」に確認待ちとして表示されます。申請の記録は監査の履歴に残ります。");
  await confirm(WISH, "この希望を記録する");
  expect(line(WISH, "競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます");
  expect(refresh).not.toHaveBeenCalled();
  await confirm(WISH, "同じ内容を再送する");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(sent(calls)).toEqual({ path: `/requests?${SCOPE}`, body: B.WISH });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(within(task(WISH)).getByText("公休の希望を第1版として記録しました（確認待ち）。")).toBeInTheDocument();
  expect(within(task(WISH)).getByRole("heading", { level: 4, name: "1. 希望する期間を入力する" })).toHaveFocus();
  expect(hasUnsavedChanges()).toBe(false);
});

test("a claim of paid leave by the day is sent as the established form sent it", async () => {
  const { calls, refresh } = await mount();
  task(CLAIM).open = true;
  expect(within(field(CLAIM, "年休付与台帳")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "付与日 2026-01-01（5日、失効 2028-01-01）"]);
  expect(within(field(CLAIM, "適用する年休規則")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "2026-01-01から適用／1日相当 4時間"]);
  // Before a rule is chosen only the day is offered.
  expect(within(field(CLAIM, "請求する単位")).getAllByRole("option").map((option) => option.textContent)).toEqual(["日"]);
  set(CLAIM, "年休付与台帳", "g1"); set(CLAIM, "適用する年休規則", "lp1");
  set(CLAIM, "休暇開始（日本時間）", "2026-01-06T09:00"); set(CLAIM, "休暇終了（日本時間）", "2026-01-06T17:00"); set(CLAIM, "請求内容・根拠の参照", " 合成本人請求 ");
  press(CLAIM, "請求の内容を確認する");
  expect(calls).toEqual([]);
  expect(within(surface(CLAIM)).getByRole("heading", { level: 4, name: "2. 請求前の確認" })).toHaveFocus();
  expect(changes(CLAIM)).toEqual(["種類：（なし） → 年次有給休暇", "年休の付与：（なし） → 付与日 2026-01-01（5日、失効 2028-01-01）", "適用する取得規則：（なし） → 2026-01-01から適用／1日相当 4時間", "請求する単位：（なし） → 日", "数量：（なし） → 1",
    "休暇の期間（日本時間）：（なし） → 2026-01-06 09:00 〜 2026-01-06 17:00", "請求内容・根拠の参照：（なし） → 合成本人請求", "状態：（なし） → 確認待ち"]);
  await confirm(CLAIM, "この内容で請求する");
  expect(sent(calls)).toEqual({ path: `/compliance/leave-requests?${SCOPE}`, body: B.DAY_CLAIM });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(within(task(CLAIM)).getByText(/年休の請求を第1版として記録しました（確認待ち）。/)).toBeInTheDocument();
});

test("the claim form says what is checked when: the units come from the chosen rule, the form and the ownership at the claim, the ledger at the review", async () => {
  await mount(data({ sources: ownSources(records, ME) }));
  task(CLAIM).open = true;
  const notes = Array.from(task(CLAIM).querySelectorAll("form .ideal-note")).map((note) => note.textContent);
  expect(notes).toEqual([
    "選べる単位は、選んだ取得規則に登録されている設定（半日単位・時間単位を認めるか）によります。",
    "請求の時点でサーバーが確かめるのは、入力の形式と、年休の付与があなた本人のものであることだけです。単位と数量が取得規則に合うか、残高と時間単位の年間上限に収まるかは、請求を確認して計画へ反映するときに、年休台帳と照合されます。請求の受付は、予約や取得の確定ではありません。",
  ]);
  // Nothing on the form claims that the server accepts or refuses the claim against the rule when it is sent.
  expect(task(CLAIM)).not.toHaveTextContent("サーバーが判定します");
});

test("a claim by the hour: the units offered are those the chosen rule is registered to allow; everything else is the server's to refuse", async () => {
  expect(unitsOf(undefined)).toEqual(["day"]);
  expect(unitsOf({ policy_id: "p", start: "", end: "", hours_per_day: 8, hourly_quantum: 1, hourly_enabled: true, half_day_enabled: true })).toEqual(["day", "half_day", "hour"]);
  const both = [...records, { kind: "leave_policy", entity_id: "lp-half", revision: 1, payload: { ...B.POLICY, policy_id: "lp-half", person_id: ME, hourly_enabled: false, half_day_enabled: true } }];
  let attempts = 0;
  const { calls, refresh } = await mount(data({ sources: ownSources(both, ME) }), () => { if (++attempts === 1) throw new PlanningError(422, JSON.stringify({ detail: "1 validation error for LeaveRequest\ninterval\n  Value error, Use a positive half-open interval with whole-second precision" })); return { request_id: "new", status: "PENDING", version: 1 }; });
  task(CLAIM).open = true;
  set(CLAIM, "年休付与台帳", "g1"); set(CLAIM, "適用する年休規則", "lp1");
  expect(within(field(CLAIM, "請求する単位")).getAllByRole("option").map((option) => option.textContent)).toEqual(["日", "時間"]);
  set(CLAIM, "請求する単位", "hour");
  // A unit the newly chosen rule does not list is not kept.
  set(CLAIM, "適用する年休規則", "lp-half");
  expect(within(field(CLAIM, "請求する単位")).getAllByRole("option").map((option) => option.textContent)).toEqual(["日", "半日"]);
  expect(field(CLAIM, "請求する単位")).toHaveValue("day");
  set(CLAIM, "適用する年休規則", "lp1"); set(CLAIM, "請求する単位", "hour"); set(CLAIM, "数量", "2");
  // The quantity and the span are not judged here: a span that runs backwards is sent.
  expect(field(CLAIM, "数量")).not.toHaveAttribute("max");
  set(CLAIM, "休暇開始（日本時間）", "2026-01-06T15:00"); set(CLAIM, "休暇終了（日本時間）", "2026-01-06T13:00"); set(CLAIM, "請求内容・根拠の参照", "合成本人請求");
  press(CLAIM, "請求の内容を確認する");
  expect(changes(CLAIM)).toEqual(expect.arrayContaining(["請求する単位：（なし） → 時間", "数量：（なし） → 2"]));
  await confirm(CLAIM, "この内容で請求する");
  expect(line(CLAIM, "競合・部分失敗")).toHaveTextContent("保存していません。サーバーが下の理由で受け付けませんでした。");
  expect(within(surface(CLAIM)).getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりました1 validation error for LeaveRequest interval Value error, Use a positive half-open interval with whole-second precision");
  expect(refresh).not.toHaveBeenCalled();
  press(CLAIM, "入力に戻る");
  expect(field(CLAIM, "請求内容・根拠の参照")).toHaveValue("合成本人請求");
  set(CLAIM, "休暇開始（日本時間）", "2026-01-06T13:00"); set(CLAIM, "休暇終了（日本時間）", "2026-01-06T15:00");
  press(CLAIM, "請求の内容を確認する");
  await confirm(CLAIM, "この内容で請求する");
  expect(sent(calls, 1)).toEqual({ path: `/compliance/leave-requests?${SCOPE}`, body: B.HOUR_CLAIM });
  expect((posts(calls)[1].body as { idempotency_key: string }).idempotency_key).not.toBe((posts(calls)[0].body as { idempotency_key: string }).idempotency_key);
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("withdrawing one's own request: a conflict shows the three contents and is confirmed again against the current version", async () => {
  const decided = request({ status: "APPROVED", version: 2, decision: { reference: "確認済み" } });
  let attempts = 0;
  const { calls, refresh } = await mount(data(), (call) => { if (call.method === "GET") return [decided]; if (++attempts === 1) throw new PlanningError(409, "conflict"); return { status: "CANCELLED", version: 3 }; });
  task(WITHDRAW).open = true;
  // Only the viewer's own requests that are not withdrawn.
  expect(within(field(WITHDRAW, "取り下げる申請")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください",
    "あなた・年次有給休暇 2026-01-06 09:00 〜 2026-01-06 17:00（確認待ち）", "あなた・公休希望 2026-01-10 09:00 〜 2026-01-10 17:00（確認済み）"]);
  set(WITHDRAW, "取り下げる申請", "r1");
  press(WITHDRAW, "取下げの内容を確認する");
  expect(calls).toEqual([]);
  expect(changes(WITHDRAW)).toEqual(["状態：確認待ち → 取下げ済み"]);
  expect(line(WITHDRAW, "作成される版")).toHaveTextContent("第1版 → 第2版");
  expect(line(WITHDRAW, "通知")).toHaveTextContent("誰にも通知されません。");
  await confirm(WITHDRAW, "この申請を取り下げる");
  expect(sent(calls)).toEqual({ path: `/requests/r1/withdraw?${SCOPE}`, body: B.WITHDRAWAL });
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /requests/r1/withdraw?${SCOPE}`, `GET /requests?${SCOPE}`]);
  expect(within(surface(WITHDRAW)).getByRole("alert")).toHaveTextContent("現在の版は第2版です。編集中の内容は保持しています。");
  expect(within(within(surface(WITHDRAW)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").slice(0, 3).map((item) => item.textContent)).toEqual(["項目編集開始時現在編集中差分", "状態確認待ち確認済み取下げ済みあり", "判断の記録（なし）確認済み（なし）あり"]);
  expect(within(surface(WITHDRAW)).getByRole("button", { name: "この申請を取り下げる" })).toBeDisabled();
  press(WITHDRAW, "三つの内容を確認し、現在の版に対して確認し直す");
  expect(within(surface(WITHDRAW)).getByRole("status")).toHaveTextContent("現在の第2版に対する取下げとして確認し直します。");
  expect(line(WITHDRAW, "作成される版")).toHaveTextContent("第2版 → 第3版");
  await confirm(WITHDRAW, "この申請を取り下げる");
  expect(sent(calls, 1).body).toEqual({ version: 2 });
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(within(task(WITHDRAW)).getByText("申請を取り下げました（第3版、取下げ済み）。")).toBeInTheDocument();
});

test("a planner confirms a request or keeps consulting, with the reference the decision rests on", async () => {
  const { calls, refresh } = await mount(data(), serve({ status: "APPROVED", version: 2 }), "LEADER");
  task(REVIEW).open = true;
  expect(within(field(REVIEW, "確認する申請")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください",
    "高橋 葵・年次有給休暇 2026-01-06 09:00 〜 2026-01-06 17:00（確認待ち）", "鈴木 悠斗・年次有給休暇 2026-01-08 13:00 〜 2026-01-08 15:00（相談・判断を継続中）"]);
  set(REVIEW, "確認する申請", "r1");
  expect(within(field(REVIEW, "判断")).getAllByRole("option").map((option) => option.textContent)).toEqual(["取得予定として確認", "相談・判断を継続"]);
  expect(field(REVIEW, "判断の根拠・相談記録")).toBeRequired();
  set(REVIEW, "判断の根拠・相談記録", "台帳と勤務影響を確認");
  expect(hasUnsavedChanges()).toBe(true);
  press(REVIEW, "判断の内容を確認する");
  expect(calls).toEqual([]);
  expect(within(surface(REVIEW)).getByRole("heading", { level: 4, name: "3. 記録前の確認" })).toHaveFocus();
  expect(changes(REVIEW)).toEqual(["状態：確認待ち → 確認済み", "判断の記録：（なし） → 台帳と勤務影響を確認"]);
  expect(line(REVIEW, "作成される版")).toHaveTextContent("第1版 → 第2版");
  expect(line(REVIEW, "通知")).toHaveTextContent("誰にも通知されません。判断後の状態と判断の記録は、本人のこの画面の一覧に表示されます。判断の記録は監査の履歴に残ります。");
  await confirm(REVIEW, "この判断を記録する");
  expect(sent(calls)).toEqual({ path: `/requests/r1/decision?${SCOPE}`, body: B.APPROVAL });
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(within(task(REVIEW)).getByText(/申請を確認済みとして記録しました。/)).toBeInTheDocument();
  expect(hasUnsavedChanges()).toBe(false);
  set(REVIEW, "確認する申請", "r1"); set(REVIEW, "判断", "continue"); set(REVIEW, "判断の根拠・相談記録", "台帳と勤務影響を確認");
  press(REVIEW, "判断の内容を確認する");
  expect(changes(REVIEW)).toContain("状態：確認待ち → 相談・判断を継続中");
  await confirm(REVIEW, "この判断を記録する");
  expect(sent(calls, 1).body).toEqual(B.CONTINUE);
  expect(within(task(REVIEW)).getByText("相談・判断を継続する申請として記録しました。")).toBeInTheDocument();
});

test("the ledger at a past day and recording cut-off is the server's answer, with the corrections it traced", async () => {
  const answer: LeaveReport = { ...report, findings: [], requires_hr_reconciliation: false, amendment_trace: [{ amendment_id: "a1", previous_days: 5, corrected_days: 4, reason: "原本の訂正" }, { amendment_id: "a2", event_id: "e1", previous_event: { unit: "day", quantity: 1 }, corrected_event: null, reason: "誤登録" }] };
  let fail = true;
  const { calls } = await mount(data(), () => { if (fail) { fail = false; throw new PlanningError(422, "Historical ledger queries require V3 recording evidence"); } return answer; });
  task(ASOF).open = true;
  set(ASOF, "対象日", "2026-01-07"); set(ASOF, "記録の締切（日本時間）", "2026-01-07T13:00");
  await confirm(ASOF, "指定時点の台帳を照会");
  expect(calls).toEqual([{ method: "GET", path: `/compliance/leave-report?${SCOPE}&effective_at=2026-01-07&known_at=2026-01-07T13%3A00%3A00%2B09%3A00`, body: undefined }]);
  expect(within(task(ASOF)).getByRole("alert")).toBeInTheDocument();
  await confirm(ASOF, "指定時点の台帳を照会");
  expect(within(task(ASOF)).queryByRole("alert")).toBeNull();
  expect(within(task(ASOF)).getByRole("list", { name: "指定時点の年休残高" })).toHaveTextContent("高橋 葵／合成病院／付与日 2026-01-01：残高 5 日、予約 1 日");
  expect(within(within(task(ASOF)).getByRole("list", { name: "年休訂正の履歴" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["付与日数：5日 → 4日（理由：原本の訂正）", "取得・予約の記録：1日 → 取消（理由：誤登録）"]);
});

describe("the administrator's ledger tasks", () => {
  const GRANT = "付与日数を訂正する";
  const admin = (answer: (call: Call) => unknown = serve({ key: "k", revision: 1, kind: "x", requires_hr_reconciliation: false })) => mount(data(), answer, "ADMIN");
  const gets = (calls: Call[]) => calls.filter((call) => call.method === "GET").map((call) => call.path);
  const basis = (summary: string) => { set(summary, "訂正を把握した日時（日本時間）", "2026-01-07T12:00"); set(summary, "訂正理由", "原本の訂正"); set(summary, "照合した人事資料の参照", "HR-REF"); set(summary, "根拠の確認者", "確認者"); };
  const evidence = (summary: string) => { set(summary, "原本確認の資料名・参照先", "人事原本"); set(summary, "原本確認の状態", "verified"); set(summary, "原本確認の確認責任者", "確認者"); };

  test("their records are read when the first task is opened, once for the tasks that share them", async () => {
    const { calls } = await admin();
    expect(calls).toEqual([]);
    expect(within(task(GRANT)).getByText("開くと、この操作に必要な記録を読み込みます。")).toBeInTheDocument();
    await open(GRANT);
    await open("取得・予約の記録を取り消す");
    await open("年休の取得規則を登録・変更する");
    expect(gets(calls)).toEqual([`/compliance/workflow-context?${SCOPE}`]);
    expect(within(field(GRANT, "訂正する原本")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "合成 一 2026-01-01付与 5日"]);
    await open("人事原本から通常・比例付与を照合する");
    expect(gets(calls)).toEqual([`/compliance/workflow-context?${SCOPE}`, `/compliance/grant-assessments/context?${SCOPE}`]);
  });

  test("a grant correction names the source revision it follows and is sent as the established form sent it", async () => {
    const { calls, refresh } = await admin();
    await open(GRANT);
    set(GRANT, "訂正する原本", "g1");
    expect(task(GRANT)).toHaveTextContent("外部人事の原本：hr:g1／現在の改定 1 → この訂正で 2。改定が連続しているかどうかは、サーバーが照合します。");
    expect(field(GRANT, "訂正後の付与日数")).toHaveValue(5);
    expect(field(GRANT, "訂正の効力日")).toHaveValue("2026-01-01");
    set(GRANT, "訂正後の付与日数", "4"); set(GRANT, "そのうち法定付与日数", "4"); basis(GRANT);
    press(GRANT, "訂正の内容を確認する");
    expect(posts(calls)).toEqual([]);
    expect(within(surface(GRANT)).getByRole("heading", { level: 4, name: "3. 記録前の確認" })).toHaveFocus();
    expect(changes(GRANT)).toEqual(["付与日数：5日 → 4日", "うち法定付与日数：5日 → 4日", "訂正の効力日：（なし） → 2026-01-01", "外部人事の原本改定：第1改定 → 第2改定", "訂正を把握した日時（日本時間）：（なし） → 2026-01-07 12:00", "訂正理由：（なし） → 原本の訂正", "照合した人事資料の参照：（なし） → HR-REF", "根拠の確認者：（なし） → 確認者"]);
    expect(line(GRANT, "作成される版")).toHaveTextContent("訂正の記録を1件追加します（第1版）。元の原本は上書きされず、そのまま残ります。");
    expect(line(GRANT, "通知")).toHaveTextContent("誰にも通知されません。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。");
    await confirm(GRANT, "この訂正を記録する");
    expect(sent(calls)).toEqual({ path: `/compliance/grant-amendments?${SCOPE}`, body: B.GRANT_CORRECTION });
    expect(refresh).toHaveBeenCalledTimes(1);
    // The task's own records are read again after the save.
    await waitFor(() => expect(gets(calls)).toHaveLength(2));
    expect(within(task(GRANT)).getByText(/訂正を記録しました。「過去時点の年休台帳と訂正履歴を照会する」で、訂正の前後を確認できます。/)).toBeInTheDocument();
  });

  test("a leave event is corrected or cancelled from the HR source; the server's refusal and its reconciliation flag are shown", async () => {
    let attempts = 0;
    const { calls } = await admin((call) => { if (call.method === "GET") return B.LEDGER_CONTEXT; if (++attempts === 1) throw new PlanningError(422, JSON.stringify({ detail: "訂正の改定順・元記録・確認根拠を照合できません。" })); return { key: "k", revision: 1, requires_hr_reconciliation: true }; });
    const FIX = "取得・予約の記録を訂正する";
    await open(FIX);
    set(FIX, "訂正する取得・予約の記録", "e1");
    expect(task(FIX)).toHaveTextContent("元の記録：2026-01-06 実際に取得した 1日。");
    set(FIX, "訂正後の対象日", "2026-01-07"); set(FIX, "訂正後の取得単位", "half_day"); set(FIX, "訂正後の数量", "1"); set(FIX, "訂正後の開始（日本時間）", "2026-01-07T09:00"); set(FIX, "訂正後の終了（日本時間）", "2026-01-07T13:00"); basis(FIX);
    press(FIX, "訂正の内容を確認する");
    expect(changes(FIX).slice(0, 3)).toEqual(["対象日：2026-01-06 → 2026-01-07", "単位・数量：1日 → 1半日", "対象区間（日本時間）：2026-01-06 09:00 〜 2026-01-06 17:00 → 2026-01-07 09:00 〜 2026-01-07 13:00"]);
    await confirm(FIX, "この訂正を記録する");
    expect(within(surface(FIX)).getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりました訂正の改定順・元記録・確認根拠を照合できません。");
    await confirm(FIX, "この訂正を記録する");
    expect(sent(calls, 1)).toEqual({ path: `/compliance/leave-amendments?${SCOPE}`, body: B.EVENT_CORRECTION });
    expect(within(task(FIX)).getByText("訂正を記録しました。サーバーは、残高または関連する記録に人事との照合が必要な差異が残っていると答えています。")).toBeInTheDocument();
    const CANCEL = "取得・予約の記録を取り消す";
    await open(CANCEL);
    set(CANCEL, "取り消す取得・予約の記録", "e1"); basis(CANCEL);
    press(CANCEL, "訂正の内容を確認する");
    expect(changes(CANCEL)[0]).toBe("取得・予約の記録：2026-01-06 実際に取得した 1日 → 取消");
    await confirm(CANCEL, "この記録を取り消す");
    expect(sent(calls, 2).body).toEqual(B.EVENT_CANCEL);
  });

  test("a leave event is added against the revision of its grant; when that has moved it is reviewed and sent against the current one", async () => {
    const moved = { ...B.LEDGER_CONTEXT, records: B.LEDGER_CONTEXT.records.map((row) => (row.entity_id === "g1" ? { ...row, revision: 4 } : row)) };
    let attempts = 0; let reads = 0;
    const { calls } = await admin((call) => { if (call.method === "GET") return ++reads === 1 ? B.LEDGER_CONTEXT : moved; if (++attempts === 1) throw new PlanningError(409, "conflict"); return { event_id: B.UUID, duplicate: false, account_revision: 5, requires_hr_reconciliation: false }; });
    const EVENT = "年休の予約・取得・取消を記録する";
    await open(EVENT);
    set(EVENT, "対象の付与原本", "g1");
    expect(task(EVENT)).toHaveTextContent("この付与台帳は第3版です。");
    set(EVENT, "対象者・雇用主の取得規則", "lp1"); set(EVENT, "年休イベント", "take"); set(EVENT, "イベントの効力日", "2026-01-06");
    set(EVENT, "対象区間の開始（日本時間）", "2026-01-06T09:00"); set(EVENT, "対象区間の終了（日本時間）", "2026-01-06T17:00"); evidence(EVENT);
    // Whether a span is needed, and which quantities a unit takes, is not decided here.
    expect(field(EVENT, "対象区間の開始（日本時間）")).not.toBeRequired();
    expect(field(EVENT, "記録する数量")).not.toHaveAttribute("max");
    press(EVENT, "保存内容を確認する");
    expect(changes(EVENT)).toEqual(expect.arrayContaining(["年休イベント：（なし） → 実際に取得した", "対象区間（日本時間）：（なし） → 2026-01-06 09:00 〜 2026-01-06 17:00", "付与台帳の版：第3版 → 第4版"]));
    expect(line(EVENT, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
    await confirm(EVENT, "このイベントを記録する");
    expect(sent(calls)).toEqual({ path: `/compliance/leave-events?${SCOPE}`, body: B.NEW_EVENT });
    expect(within(surface(EVENT)).getByRole("alert")).toHaveTextContent("現在の版は第4版です。");
    expect(within(within(surface(EVENT)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("付与台帳の版第3版第4版第3版に追加あり");
    press(EVENT, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(within(surface(EVENT)).getByRole("status")).toHaveTextContent("現在の付与台帳（第4版）に追加するイベントとして確認し直します。");
    await confirm(EVENT, "このイベントを記録する");
    expect(sent(calls, 1).body).toEqual({ ...B.NEW_EVENT, expected_revision: 4 });
    expect(within(task(EVENT)).getByText("年休イベントを記録し、付与台帳は第5版になりました。")).toBeInTheDocument();
    // An event without a span is sent without one, not with an empty one.
    set(EVENT, "対象の付与原本", "g1"); set(EVENT, "対象者・雇用主の取得規則", "lp1"); set(EVENT, "年休イベント", "expire"); set(EVENT, "イベントの効力日", "2028-01-01"); evidence(EVENT);
    press(EVENT, "保存内容を確認する");
    await confirm(EVENT, "このイベントを記録する");
    expect((sent(calls, 2).body as { payload: { interval: unknown } }).payload.interval).toBeNull();
  });

  test("a grant, a leave rule, a management period and a recording time are each registered with their own form", async () => {
    const { calls } = await admin();
    const ACCOUNT = "年休の付与原本を登録する";
    await open(ACCOUNT);
    expect(within(task(ACCOUNT)).queryByLabelText("編集する対象")).toBeNull();
    set(ACCOUNT, "対象職員", "p1");
    expect(within(field(ACCOUNT, "年休を管理する雇用主")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "合成病院"]);
    set(ACCOUNT, "年休を管理する雇用主", "hospital"); set(ACCOUNT, "原本の付与日", "2026-04-01"); set(ACCOUNT, "失効日（この日を含まない）", "2028-04-01"); set(ACCOUNT, "原本の付与日数", "11"); set(ACCOUNT, "うち法定付与日数", "10"); evidence(ACCOUNT);
    press(ACCOUNT, "保存内容を確認する");
    expect(line(ACCOUNT, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
    await confirm(ACCOUNT, "この内容で保存する");
    expect(sent(calls)).toEqual({ path: `/compliance/records/leave_account?${SCOPE}`, body: B.NEW_ACCOUNT });

    const POLICY = "年休の取得規則を登録・変更する";
    await open(POLICY);
    expect(within(field(POLICY, "編集する対象")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "新しい年休の取得規則を登録する", "合成 一 2026-01-01〜2028-01-01 1日4時間（第1版）"]);
    set(POLICY, "編集する対象", "new");
    set(POLICY, "対象職員", "p1"); set(POLICY, "年休を管理する雇用主", "hospital"); set(POLICY, "適用開始（日本時間）", "2026-04-01T00:00"); set(POLICY, "適用終了（日本時間）", "2028-04-01T00:00");
    fireEvent.click(field(POLICY, "時間単位年休を認める協定がある")); set(POLICY, "時間年休上限の年起算日", "2026-04-01"); evidence(POLICY);
    // The legal limits of the rule are the server's: no upper bound is set on the fields.
    for (const label of ["1日に相当する時間数", "時間年休の取得単位（時間）", "年間の時間年休上限（日相当）"]) expect(field(POLICY, label)).not.toHaveAttribute("max");
    press(POLICY, "保存内容を確認する");
    await confirm(POLICY, "この内容で保存する");
    expect(sent(calls, 1)).toEqual({ path: `/compliance/records/leave_policy?${SCOPE}`, body: B.NEW_POLICY });

    const PERIOD = "年5日の管理期間を登録・変更する";
    await open(PERIOD);
    set(PERIOD, "編集する対象", "new");
    set(PERIOD, "対象職員", "p1"); set(PERIOD, "年休を管理する雇用主", "hospital"); set(PERIOD, "管理期間の開始日", "2026-04-01"); set(PERIOD, "管理期間の終了日（この日を含まない）", "2027-04-01");
    fireEvent.click(field(PERIOD, "2026-01-01付与 法定5日")); evidence(PERIOD);
    press(PERIOD, "保存内容を確認する");
    await confirm(PERIOD, "この内容で保存する");
    expect(sent(calls, 2)).toEqual({ path: `/compliance/records/leave_obligation?${SCOPE}`, body: B.NEW_OBLIGATION });

    const RECORDING = "人事原本の記録日時を登録する";
    await open(RECORDING);
    set(RECORDING, "記録日時を付す原本", "g1"); set(RECORDING, "外部人事の原本イベント番号", "hr:g1:b"); set(RECORDING, "原本を把握した日時（日本時間）", "2026-01-02T09:00"); evidence(RECORDING);
    press(RECORDING, "保存内容を確認する");
    await confirm(RECORDING, "この内容で保存する");
    expect(sent(calls, 3)).toEqual({ path: `/compliance/records/ledger_recording?${SCOPE}`, body: B.NEW_RECORDING });
  });

  test("a change of a registered rule the server does not take is said as such", async () => {
    const { calls } = await admin((call) => { if (call.method === "GET") return B.LEDGER_CONTEXT; throw new PlanningError(409, "conflict"); });
    const POLICY = "年休の取得規則を登録・変更する";
    await open(POLICY);
    set(POLICY, "編集する対象", "lp1");
    set(POLICY, "1日に相当する時間数", "8");
    press(POLICY, "保存内容を確認する");
    expect(changes(POLICY)).toEqual(["1日に相当する時間数：4時間 → 8時間"]);
    expect(line(POLICY, "作成される版")).toHaveTextContent("第1版 → 第2版");
    await confirm(POLICY, "この内容で保存する");
    expect((posts(calls)[0].body as { expected_revision: number }).expected_revision).toBe(1);
    expect(surface(POLICY)).toHaveTextContent("サーバーにある版は、編集を始めたときと同じ第1版です。それでも競合と答えたため、サーバーはこの記録のこの変更を受け付けていません。登録済みの規則で変えられる項目は、サーバーが決めています。");
  });

  test("a grant assessment sends what HR confirmed; the judgement shown is the server's", async () => {
    const result = { status: "mismatch", computed_status: "pass", expected_statutory_days: 7, imported_statutory_days: 5, findings: [], source: "https://www.mhlw.go.jp/table", guidance: { version: "2026-06-19", basis_before_revision: true, confirmed: false } };
    let attempts = 0;
    const { calls, refresh } = await admin((call) => { if (call.method === "GET") return B.ASSESSMENT_CONTEXT; if (++attempts === 2) throw new PlanningError(422, JSON.stringify({ detail: "Six months cannot contain more actual working days than calendar days" })); return result; });
    const ASSESS = "人事原本から通常・比例付与を照合する";
    await open(ASSESS);
    const common = () => { set(ASSESS, "照合する付与ロット", "g1"); set(ASSESS, "確認済み勤続月数", "6"); set(ASSESS, "週の所定労働時間", "30"); set(ASSESS, "出勤率の分子（人事確認済み日数）", "100"); set(ASSESS, "出勤率の分母（人事確認済み日数）", "120"); set(ASSESS, "付与照合の原本参照", "HR-A"); set(ASSESS, "付与照合の確認者", "確認者"); };
    expect(within(field(ASSESS, "照合する付与ロット")).getAllByRole("option")[1]).toHaveTextContent("付与日 2026-01-01／取込済みの法定付与 5日");
    common(); set(ASSESS, "週の所定労働日数", "4");
    press(ASSESS, "照合の内容を確認する");
    expect(posts(calls)).toEqual([]);
    expect(line(ASSESS, "作成される版")).toHaveTextContent("記録の版は作られません。照合結果は送信の受付記録として残り、付与や請求は変わりません。");
    expect(line(ASSESS, "通知")).toHaveTextContent("誰にも通知されません。照合結果は受付記録として残りますが、監査の履歴には表示されません");
    await confirm(ASSESS, "この内容で照合して記録する");
    expect(sent(calls)).toEqual({ path: `/compliance/grant-assessments?${SCOPE}`, body: B.ASSESSMENT });
    expect(refresh).toHaveBeenCalledTimes(1);
    const shown = within(task(ASSESS)).getByText(/サーバーの照合結果/).closest("div")!;
    expect(shown).toHaveTextContent("サーバーの照合結果：付与原本との不一致：人事確認が必要です表による法定付与：7日／原本：5日");
    expect(shown).toHaveTextContent("サーバーは、基準日が留意事項の改正（2026-06-19）より前で、人事の確認記録がないと答えています。計算上の判定：一致");
    expect(within(shown).getByRole("link")).toHaveAttribute("href", "https://www.mhlw.go.jp/table");
    // The limits of the actual-days method and of its confirmation are the server's.
    common(); set(ASSESS, "所定日数の基準", "shift_actual"); set(ASSESS, "労働日数の実績（人事確認済み）", "300"); set(ASSESS, "改正前の基準日にこの方法を使ったことの人事の確認記録", "HR-G");
    expect(field(ASSESS, "労働日数の実績（人事確認済み）")).not.toHaveAttribute("max");
    press(ASSESS, "照合の内容を確認する");
    await confirm(ASSESS, "この内容で照合して記録する");
    expect(within(surface(ASSESS)).getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりましたSix months cannot contain more actual working days than calendar days");
    press(ASSESS, "入力に戻る");
    set(ASSESS, "労働日数の実績（人事確認済み）", "90");
    press(ASSESS, "照合の内容を確認する");
    await confirm(ASSESS, "この内容で照合して記録する");
    expect(sent(calls, 2).body).toEqual(B.SHIFT_ASSESSMENT);
  });

  test.each([
    ["javascript:alert(document.cookie)"],
    ["http://www.mhlw.go.jp/table"],
    ["//www.mhlw.go.jp/table"],
    ["/workspace/home"],
    ["data:text/html,<script>alert(1)</script>"],
    ["MHLW-2009-1005-1"],
  ])("a source of the response that is not an absolute https URL (%s) is shown as text, never as a link", async (source) => {
    await admin((call) => (call.method === "GET" ? B.ASSESSMENT_CONTEXT : { status: "pass", expected_statutory_days: 5, imported_statutory_days: 5, findings: [], source }));
    const ASSESS = "人事原本から通常・比例付与を照合する";
    await open(ASSESS);
    set(ASSESS, "照合する付与ロット", "g1"); set(ASSESS, "確認済み勤続月数", "6"); set(ASSESS, "週の所定労働時間", "30"); set(ASSESS, "出勤率の分子（人事確認済み日数）", "100"); set(ASSESS, "出勤率の分母（人事確認済み日数）", "120"); set(ASSESS, "付与照合の原本参照", "HR-A"); set(ASSESS, "付与照合の確認者", "確認者"); set(ASSESS, "週の所定労働日数", "4");
    press(ASSESS, "照合の内容を確認する");
    await confirm(ASSESS, "この内容で照合して記録する");
    const shown = within(task(ASSESS)).getByText(/サーバーの照合結果/).closest("div")!;
    expect(within(shown).queryByRole("link")).toBeNull();
    expect(shown.querySelector("a")).toBeNull();
    expect(shown).toHaveTextContent(`サーバーが照合に使った付与表：${source}`);
  });

  test("only an absolute https address of the response becomes a link", () => {
    expect(sourceLink("https://www.mhlw.go.jp/table?a=1#b")).toBe("https://www.mhlw.go.jp/table?a=1#b");
    for (const value of ["HTTP://x.example/", "ftp://x.example/", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "https", "www.mhlw.go.jp", "", null, undefined, 7, { href: "https://x.example/" }]) expect(sourceLink(value)).toBeNull();
  });

  test("an assessment against a source that has moved is reviewed and sent against the one read again", async () => {
    const newer = { ...B.ASSESSMENT_CONTEXT, source_revision: 8, findings: [{ message: "x" }] };
    let attempts = 0; let reads = 0;
    const { calls } = await admin((call) => { if (call.method === "GET") return ++reads === 1 ? B.ASSESSMENT_CONTEXT : newer; if (++attempts === 1) throw new PlanningError(409, "conflict"); return { status: "pass", expected_statutory_days: 5, imported_statutory_days: 5, findings: [], source: "https://example.invalid" }; });
    const ASSESS = "人事原本から通常・比例付与を照合する";
    await open(ASSESS);
    set(ASSESS, "照合する付与ロット", "g1"); set(ASSESS, "確認済み勤続月数", "6"); set(ASSESS, "週の所定労働時間", "30"); set(ASSESS, "週の所定労働日数", "4"); set(ASSESS, "出勤率の分子（人事確認済み日数）", "100"); set(ASSESS, "出勤率の分母（人事確認済み日数）", "120"); set(ASSESS, "付与照合の原本参照", "HR-A"); set(ASSESS, "付与照合の確認者", "確認者");
    press(ASSESS, "照合の内容を確認する");
    await confirm(ASSESS, "この内容で照合して記録する");
    expect(within(surface(ASSESS)).getByRole("alert")).toHaveTextContent("現在の版は第8版です。");
    expect(within(within(surface(ASSESS)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("照合に使う付与原本原本の第7版・未解消の差異 0件原本の第8版・未解消の差異 1件");
    press(ASSESS, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(within(surface(ASSESS)).getByRole("status")).toHaveTextContent("読み直した付与原本（第8版）に対する照合として確認し直します。");
    await confirm(ASSESS, "この内容で照合して記録する");
    expect(sent(calls, 1).body).toMatchObject({ expected_revision: 8, payload: { account_id: "g1" } });
    expect(within(task(ASSESS)).getByText(/サーバーの照合結果：照合一致/)).toBeInTheDocument();
  });
});

// The route arrives as server HTML. Its tasks have no field until React attaches.
describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("the server HTML holds the state and the closed tasks without fields; tasks opened there stay open, get their form and read what they need", async () => {
    const { node, calls } = tree(serve(), "ADMIN");
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node(data()));
    expect(container.innerHTML).toContain("年休残高");
    expect(container.innerHTML).toContain(CLAIM);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    const claim = within(container).getByText(CLAIM).closest("details")!;
    const grant = within(container).getByText("付与日数を訂正する").closest("details")!;
    claim.open = true; grant.open = true;
    await act(async () => { root = hydrateRoot(container, node(data())); });
    expect(claim.open).toBe(true);
    expect(within(claim).getByLabelText("年休付与台帳")).toBeVisible();
    expect(await within(grant).findByLabelText("訂正する原本")).toBeVisible();
    expect(calls.map((call) => call.path)).toEqual([`/compliance/workflow-context?${SCOPE}`]);
  });
});
