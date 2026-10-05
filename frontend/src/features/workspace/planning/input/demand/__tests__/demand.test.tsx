import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { hasUnsavedChanges } from "../../../../shared/useUnsavedNavigation";
import { LiveProvider, liveFrom } from "../../../../shell/WorkspaceRuntime";
import { syntheticContext } from "../../../../showcase/synthetic/context";
import type { DemandContext, DemandPayload } from "../../../api";
import DemandSection from "../DemandSection";
import { demandFacts, demandRecords, demandState } from "../model";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => { Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => "11111111-2222-4333-8444-555555555555") }); });
afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const HASH = "a".repeat(64);
const evidence = { reference: "配置表 2026-10", status: "unverified" as const, verified_by: null, valid_until: null };
const stored: DemandPayload = { demand_id: "d-ward", task: "病棟", location: "本館", minimum: 1, target: 2, start: "2026-10-05T00:00:00Z", end: "2026-10-05T08:00:00Z", evidence, note_from_another_tool: "kept" };
const fromInput: DemandPayload = { demand_id: "d-input", task: "調剤", location: "薬剤部", minimum: 2, target: 2, start: "2026-10-06T00:00:00Z", end: "2026-10-06T08:00:00Z", evidence };
const context = (over: Partial<DemandContext> = {}): DemandContext => ({
  role: "ADMIN", input_hash: HASH, staging_valid: true, validation_issues: [],
  duty_options: [{ kind: "日勤", task: "調剤", location: "薬剤部" }, { kind: "日勤", task: "調剤", location: "注射室" }, { kind: "遅番", task: "調剤", location: "薬剤部" }, { kind: "日勤", task: "病棟", location: "本館" }],
  demands: [stored, fromInput],
  records: [{ kind: "demand", entity_id: "d-ward", revision: 3, payload: stored }, { kind: "person", entity_id: "p1", revision: 9, payload: { name: "合成 一" } }],
  ...over,
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

function tree(source: DemandContext, answer: (call: Call) => unknown, role: IdealRole) {
  const ctx = syntheticContext(role);
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  let keys = 0;
  const live = liveFrom(ctx, { client, mutate: createMutator("test", () => `idempotency-key-${++keys}`), refresh });
  const node = (value: DemandContext) => <LiveProvider live={live}><DemandSection state={demandState(value, HASH)} inputRevision={12} admin={role === "ADMIN"} /></LiveProvider>;
  return { calls, refresh, node };
}
async function mount(source: DemandContext = context(), answer: (call: Call) => unknown = () => ({ key: "k", revision: 1, kind: "demand" }), role: IdealRole = "ADMIN") {
  const { node, ...rest } = tree(source, answer, role);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node(source)); });
  return { ...rest, show: (value: DemandContext) => view.rerender(node(value)) };
}

const next = () => screen.getByText("必要配置を登録・変更する").closest("details")!;
const field = (label: string) => within(next()).getByLabelText(label);
const set = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const choose = (value: string) => { next().open = true; set("編集する対象", value); };
const press = (name: string) => fireEvent.click(within(next()).getByRole("button", { name }));
const surface = () => next().querySelector(".ideal-confirm") as HTMLElement;
const row = (term: string) => within(surface()).getByText(term, { selector: "dt" }).parentElement!;
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");
function enterNew() {
  choose("new");
  set("配置する業務", "調剤"); set("配置する場所", "注射室");
  set("必須の配置人数", "2"); set("希望する配置人数", "3");
  set("適用開始（日本時間）", "2026-10-07T09:00"); set("適用終了（日本時間）", "2026-10-07T17:00");
  set("原本確認の資料名・参照先", "承認済み配置計画");
}

test("the demands of an input carry the version of their saved record; one never saved has none", () => {
  expect(demandRecords(context())).toEqual([{ key: "d-ward", revision: 3, payload: stored }, { key: "d-input", revision: 0, payload: fromInput }]);
  // A record the staged list does not hold yet is still listed; the saved payload wins over the staged one.
  const newer = { ...stored, minimum: 4 };
  const orphan = { ...fromInput, demand_id: "d-orphan" };
  expect(demandRecords(context({ demands: [stored], records: [{ kind: "demand", entity_id: "d-ward", revision: 4, payload: newer }, { kind: "demand", entity_id: "d-orphan", revision: 1, payload: orphan }] })))
    .toEqual([{ key: "d-ward", revision: 4, payload: newer }, { key: "d-orphan", revision: 1, payload: orphan }]);
  expect(demandState(context(), HASH)).toMatchObject({ inputHash: HASH, matchesInput: true, canEdit: true, stagingValid: true, issues: [],
    dutyOptions: [{ task: "調剤", location: "薬剤部" }, { task: "調剤", location: "注射室" }, { task: "病棟", location: "本館" }] });
  expect(demandState(context({ role: "PHARMACIST", input_hash: "other" }), HASH)).toMatchObject({ matchesInput: false, canEdit: false });
  expect(demandFacts(stored).map((fact) => `${fact.label}=${fact.text}`)).toEqual([
    "業務=病棟", "場所=本館", "必須の配置人数=1名", "希望する配置人数=2名", "適用開始（日本時間）=2026-10-05 09:00", "適用終了（日本時間）=2026-10-05 17:00",
    "原本確認の資料=配置表 2026-10", "原本確認の状態=未確認", "原本確認の確認責任者=（なし）", "原本確認の有効期限=期限なし",
  ]);
});

test("first the current state, the next step and the versions; the form is not open", async () => {
  const { calls } = await mount();
  expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["現在の必要配置", "次の操作", "版と履歴"]);
  const rows = within(screen.getByRole("region", { name: "登録されている必要配置" })).getAllByRole("row");
  expect(rows.slice(1).map((item) => item.textContent)).toEqual([
    "病棟・本館2026-10-05 09:00 〜 2026-10-05 17:001名2名未確認第3版",
    "調剤・薬剤部2026-10-06 09:00 〜 2026-10-06 17:002名2名未確認未登録（入力版の値）",
  ]);
  expect(next().open).toBe(false);
  expect(field("編集する対象")).not.toBeVisible();
  expect(within(next()).queryByLabelText("配置する業務")).toBeNull();
  const history = screen.getByRole("heading", { level: 3, name: "版と履歴" }).closest("section")!;
  expect(history).toHaveTextContent("対象の入力版入力版 12登録されている記録2件（最も新しい版は第3版）");
  expect(within(history).getByRole("link", { name: /監査の履歴を開く/ })).toHaveAttribute("href", "/workspace/governance/audit");
  expect(screen.queryByRole("alert")).toBeNull();
  // Reading is the route's; the section itself asks for nothing.
  expect(calls).toEqual([]);
  expect(document.body.innerHTML).not.toMatch(/href="\/(planning|settings|dashboard)/);
  expect(document.body.innerHTML).not.toMatch(/class="[^"]*\b(ui-|workflow-)/);
});

test("the server's staging issues are shown as it reports them", async () => {
  await mount(context({ staging_valid: false, validation_issues: [{ location: ["demands", 0, "end"], message: "Use a positive half-open interval" }, { location: "capabilities", message: "Unknown person" }] }));
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("不整合編集中の記録に不整合があります");
  expect(within(alert).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["demands / 0 / end：Use a positive half-open interval", "capabilities：Unknown person"]);
});

test("a leader may register; the audit history is linked for administrators only; other roles are not offered the step", async () => {
  await mount(context({ role: "LEADER" }), undefined, "LEADER");
  expect(screen.getByText("必要配置を登録・変更する")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /監査の履歴を開く/ })).toBeNull();
  await mount(context({ role: "PHARMACIST" }), undefined, "LEADER");
  expect(screen.getByText("必要配置の登録は、管理者と責任者が行います。")).toBeInTheDocument();
});

test("an answer for another input version cannot be saved against", async () => {
  await mount(context({ input_hash: "b".repeat(64) }));
  expect(screen.getByRole("alert")).toHaveTextContent("対象期間の入力版を確認できません。この画面を読み直してから登録してください。");
  expect(screen.queryByText("必要配置を登録・変更する")).toBeNull();
});

test("a new demand: entered, confirmed with the four statements, then saved with the body the server takes", async () => {
  const { calls, refresh, show } = await mount(context(), () => ({ key: "k", revision: 1, kind: "demand" }));
  choose("new");
  expect(screen.getByRole("heading", { level: 4, name: "2. 配置の内容と原本確認を入力する" })).toBeInTheDocument();
  set("配置する業務", "調剤");
  // The places are those of the chosen task.
  expect(within(field("配置する場所")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "薬剤部", "注射室"]);
  set("配置する場所", "注射室");
  set("必須の配置人数", "2"); set("希望する配置人数", "3");
  set("適用開始（日本時間）", "2026-10-07T09:00"); set("適用終了（日本時間）", "2026-10-07T17:00");
  set("原本確認の資料名・参照先", "承認済み配置計画");
  set("原本確認の状態", "verified"); set("原本確認の確認責任者", "合成の確認責任者");
  expect(field("編集する対象")).toBeDisabled();
  expect(hasUnsavedChanges()).toBe(true);
  press("保存内容を確認する");
  // Nothing is sent before the confirmation; focus is on its heading.
  expect(calls).toEqual([]);
  expect(within(surface()).getByRole("heading", { level: 4, name: "3. 保存前の確認" })).toHaveFocus();
  expect(within(surface()).getAllByRole("term").map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
  expect(within(row("変更内容")).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "業務：（なし） → 調剤", "場所：（なし） → 注射室", "必須の配置人数：（なし） → 2名", "希望する配置人数：（なし） → 3名",
    "適用開始（日本時間）：（なし） → 2026-10-07 09:00", "適用終了（日本時間）：（なし） → 2026-10-07 17:00",
    "原本確認の資料：（なし） → 承認済み配置計画", "原本確認の状態：（なし） → 確認済み", "原本確認の確認責任者：（なし） → 合成の確認責任者", "原本確認の有効期限：（なし） → 期限なし",
  ]);
  expect(row("作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  expect(row("通知")).toHaveTextContent("誰にも通知されません。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。");
  expect(row("競合・部分失敗")).toHaveTextContent("保存前の時点では検出されていません。保存時にサーバーが、この記録がまだ登録されていないことと、入力版 12 が最新であることを照合します。");
  expect(within(next()).queryByLabelText("配置する業務")).toBeNull();
  await act(async () => { press("この内容で保存する"); });
  // The body the established form sent for the same entries (checked against it when this
  // screen replaced it): the revision the edit started from, the payload, and the input version.
  expect(calls).toEqual([{ method: "POST", path: `/compliance/records/demand?${SCOPE}`, body: {
    expected_revision: 0,
    payload: { demand_id: "11111111-2222-4333-8444-555555555555", task: "調剤", location: "注射室", minimum: 2, target: 3, start: "2026-10-07T00:00:00.000Z", end: "2026-10-07T08:00:00.000Z",
      evidence: { reference: "承認済み配置計画", status: "verified", verified_by: "合成の確認責任者", valid_until: null } },
    input_hash: HASH,
    idempotency_key: expect.any(String),
  } }]);
  expect(refresh).toHaveBeenCalledTimes(1);
  // Said from the server's answer, before the route's next read arrives.
  expect(within(next()).getByRole("status")).toHaveTextContent("必要配置を第1版として保存しました。入力版が古くなるため、計画に使う前に新しい入力版を作ってください。");
  expect(surface()).toBeNull();
  expect(screen.getByRole("heading", { level: 4, name: "1. 対象を選ぶ" })).toHaveFocus();
  expect(field("編集する対象")).toHaveValue("");
  expect(hasUnsavedChanges()).toBe(false);
  // The list is drawn from what the route reads next, not from the form.
  expect(screen.getAllByRole("row")).toHaveLength(3);
  const saved = (calls[0].body as { payload: DemandPayload }).payload;
  show(context({ demands: [stored, fromInput, saved], records: [...context().records, { kind: "demand", entity_id: saved.demand_id, revision: 1, payload: saved }] }));
  expect(screen.getAllByRole("row")[3]).toHaveTextContent("調剤・注射室2026-10-07 09:00 〜 2026-10-07 17:002名3名確認済み第1版");
});

test("changing a saved demand keeps the fields this screen does not edit, and says only what differs", async () => {
  const { calls } = await mount(context(), () => ({ key: "k", revision: 4, kind: "demand" }));
  choose("d-ward");
  expect(field("配置する業務")).toHaveValue("病棟");
  expect(field("適用開始（日本時間）")).toHaveValue("2026-10-05T09:00");
  press("保存内容を確認する");
  expect(row("変更内容")).toHaveTextContent("現在の版との差分はありません。");
  expect(row("作成される版")).toHaveTextContent("第3版のまま（内容が同じため、新しい版は作られません）");
  press("入力に戻る");
  expect(screen.getByRole("heading", { level: 4, name: "2. 配置の内容と原本確認を入力する" })).toHaveFocus();
  set("希望する配置人数", "4");
  press("保存内容を確認する");
  expect(within(row("変更内容")).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["希望する配置人数：2名 → 4名"]);
  expect(row("作成される版")).toHaveTextContent("第3版 → 第4版");
  expect(row("競合・部分失敗")).toHaveTextContent("この記録が第3版のままであること");
  await act(async () => { press("この内容で保存する"); });
  expect(calls[0].body).toEqual({ expected_revision: 3, payload: { ...stored, target: 4 }, input_hash: HASH, idempotency_key: expect.any(String) });
  expect(within(next()).getByRole("status")).toHaveTextContent("必要配置を第4版として保存しました。");
});

test("a demand that only the input holds is saved as its first version", async () => {
  const { calls } = await mount();
  choose("d-input");
  set("必須の配置人数", "1");
  press("保存内容を確認する");
  expect(within(row("変更内容")).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["必須の配置人数：2名 → 1名"]);
  expect(row("作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  await act(async () => { press("この内容で保存する"); });
  expect(calls[0].body).toMatchObject({ expected_revision: 0, payload: { ...fromInput, minimum: 1 } });
});

test("a conflict keeps the surface open with the three contents; saving again needs the review and goes against the current version", async () => {
  const theirs = { ...stored, minimum: 3 };
  let saves = 0;
  const { calls, refresh } = await mount(context(), (call) => {
    if (call.method === "GET") return context({ records: [{ kind: "demand", entity_id: "d-ward", revision: 4, payload: theirs }] });
    if (++saves === 1) throw new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" }));
    return { key: "k", revision: 5, kind: "demand" };
  });
  choose("d-ward");
  set("希望する配置人数", "4");
  press("保存内容を確認する");
  await act(async () => { press("この内容で保存する"); });
  // The current version is read on demand, for the same input version.
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /compliance/records/demand?${SCOPE}`, `GET /compliance/workflow-context?${SCOPE}&input_hash=${HASH}`]);
  expect(row("競合・部分失敗")).toHaveTextContent("競合があります。保存していません。");
  expect(within(surface()).getByRole("alert")).toHaveTextContent("現在の版は第4版です。編集中の内容は保持しています。自動では統合しません。");
  const rows = within(within(surface()).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").map((item) => item.textContent);
  expect(rows.slice(0, 3)).toEqual(["項目編集開始時現在編集中差分", "必須の配置人数1名3名1名あり", "希望する配置人数2名2名4名あり"]);
  expect(rows).toHaveLength(11);
  expect(within(surface()).getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
  // The list behind the review is read again; nothing was saved.
  expect(refresh).toHaveBeenCalledTimes(1);
  press("三つの内容を確認し、現在の版に対して確認し直す");
  expect(within(surface()).queryByRole("alert")).toBeNull();
  expect(within(surface()).getByRole("status")).toHaveTextContent("現在の第4版との差分に更新しました。内容を確認して、もう一度保存してください。");
  // The difference and the version are now those against the current version.
  expect(within(row("変更内容")).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["必須の配置人数：3名 → 1名", "希望する配置人数：2名 → 4名"]);
  expect(row("作成される版")).toHaveTextContent("第4版 → 第5版");
  await act(async () => { press("この内容で保存する"); });
  expect(posts(calls)).toHaveLength(2);
  expect(posts(calls)[1].body).toEqual({ expected_revision: 4, payload: { ...stored, target: 4 }, input_hash: HASH, idempotency_key: expect.any(String) });
  expect((posts(calls)[1].body as { idempotency_key: string }).idempotency_key).not.toBe((posts(calls)[0].body as { idempotency_key: string }).idempotency_key);
  expect(within(next()).getByRole("status")).toHaveTextContent("必要配置を第5版として保存しました。");
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("a conflict on a record the server does not have is reviewed as a new registration", async () => {
  let saves = 0;
  const { calls } = await mount(context(), (call) => {
    if (call.method === "GET") return context();
    if (++saves === 1) throw new PlanningError(409, "conflict");
    return { key: "k", revision: 1, kind: "demand" };
  });
  enterNew();
  press("保存内容を確認する");
  await act(async () => { press("この内容で保存する"); });
  expect(within(surface()).getByRole("alert")).toHaveTextContent("現在、この記録はサーバーにありません。");
  press("三つの内容を確認し、現在の版に対して確認し直す");
  expect(within(surface()).getByRole("status")).toHaveTextContent("現在は登録がないため、新規登録として確認し直します。");
  expect(row("作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  await act(async () => { press("この内容で保存する"); });
  expect(posts(calls)).toHaveLength(2);
});

test("after an unknown outcome the identical body is sent again with the same key", async () => {
  let saves = 0;
  const { calls, refresh } = await mount(context(), () => { if (++saves === 1) throw new PlanningError(503, "down"); return { key: "k", revision: 1, kind: "demand" }; });
  enterNew();
  press("保存内容を確認する");
  await act(async () => { press("この内容で保存する"); });
  expect(row("競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます");
  expect(within(surface()).getByRole("alert")).toHaveTextContent("503結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  expect(within(surface()).queryByRole("button", { name: "この内容で保存する" })).toBeNull();
  await act(async () => { press("同じ内容を再送する"); });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect((calls[0].body as { idempotency_key: string }).idempotency_key).toEqual(expect.any(String));
  expect(within(next()).getByRole("status")).toHaveTextContent("必要配置を第1版として保存しました。");
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("the server's refusal is shown in its own words and the entries are kept", async () => {
  const { refresh } = await mount(context(), () => { throw new PlanningError(422, JSON.stringify({ detail: "Target cannot be lower than required minimum" })); });
  enterNew();
  set("希望する配置人数", "1");
  press("保存内容を確認する");
  // Whether the wished number may be below the required one is not judged here.
  expect(surface()).not.toBeNull();
  await act(async () => { press("この内容で保存する"); });
  expect(row("競合・部分失敗")).toHaveTextContent("保存していません。サーバーが下の理由で受け付けませんでした。");
  expect(within(surface()).getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりましたTarget cannot be lower than required minimum");
  expect(refresh).not.toHaveBeenCalled();
  press("入力に戻る");
  expect(field("希望する配置人数")).toHaveValue(1);
  expect(field("原本確認の資料名・参照先")).toHaveValue("承認済み配置計画");
});

test("an interval that does not run forward is an entry slip and is not sent; discarding returns to the choice", async () => {
  const { calls } = await mount();
  enterNew();
  set("適用終了（日本時間）", "2026-10-07T09:00");
  press("保存内容を確認する");
  expect(within(next()).getByRole("alert")).toHaveTextContent("適用終了は、適用開始より後にしてください。");
  expect(surface()).toBeNull();
  expect(calls).toEqual([]);
  press("入力を破棄して対象を選び直す");
  expect(within(next()).queryByLabelText("配置する業務")).toBeNull();
  expect(field("編集する対象")).toBeEnabled();
  expect(screen.getByRole("heading", { level: 4, name: "1. 対象を選ぶ" })).toHaveFocus();
  expect(hasUnsavedChanges()).toBe(false);
});

test("presence and number format are the only checks of the form", async () => {
  await mount();
  choose("new");
  for (const label of ["配置する業務", "配置する場所", "必須の配置人数", "希望する配置人数", "適用開始（日本時間）", "適用終了（日本時間）", "原本確認の資料名・参照先"]) expect(field(label)).toBeRequired();
  expect(field("必須の配置人数")).toHaveAttribute("min", "0");
  expect(field("必須の配置人数")).toHaveAttribute("step", "1");
  expect(field("希望する配置人数")).not.toHaveAttribute("max");
  set("必須の配置人数", "");
  expect(field("必須の配置人数")).toHaveValue(null);
});

// The route arrives as server HTML. This case uses that HTML before React attaches to it.
describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("a record chosen in the server HTML is the one edited", async () => {
    const { node } = tree(context(), () => ({}), "ADMIN");
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node(context()));
    expect(container.innerHTML).toContain("必要配置を登録・変更する");
    expect(container.innerHTML).not.toContain("配置する業務");
    (within(container).getByLabelText("編集する対象") as HTMLSelectElement).value = "d-ward";
    await act(async () => { root = hydrateRoot(container, node(context())); });
    expect(within(container).getByLabelText("編集する対象")).toHaveValue("d-ward");
    expect(within(container).getByLabelText("配置する業務")).toHaveValue("病棟");
    expect(within(container).getByLabelText("必須の配置人数")).toHaveValue(1);
  });
});
