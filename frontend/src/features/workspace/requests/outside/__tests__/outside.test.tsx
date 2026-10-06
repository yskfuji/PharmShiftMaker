import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
import type { DeclarationContext, DeclarationPayload, DeclarationRow } from "../../api";
import { declaredTotals, hoursText } from "../model";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => { Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => "11111111-2222-4333-8444-555555555555") }); });
afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const SAVE = `/compliance/outside-declarations?${SCOPE}`;
const READ = `/compliance/declaration-context?${SCOPE}`;
const LOCK = "照合済みの申告は本人では変更・取り下げできません。終了日などの訂正は管理者に依頼してください。";
const may = { change: { allowed: true, refusal: null } };
const declaration = (over: Partial<DeclarationPayload> = {}): DeclarationPayload => ({
  declaration_id: "d-own", person_id: "synthetic-pharmacist", employer_id: "e1", establishment_id: "s1", contract_order: 1, activity: "employment",
  start: "2026-01-01T00:00:00+09:00", end: "2027-01-01T00:00:00+09:00", reference: "原本", status: "SUBMITTED", work_report_complete: false,
  scheduled_work: [{ start: "2026-01-05T09:00:00+09:00", end: "2026-01-05T13:00:00+09:00" }], additional_work: [], review_evidence: null, ...over,
});
const row = (payload: DeclarationPayload, revision = 1, actions: DeclarationRow["actions"] = may): DeclarationRow => ({ entity_id: payload.declaration_id, revision, payload, actions });
const context = (declarations: DeclarationRow[] = [row(declaration())], personId = "synthetic-pharmacist"): DeclarationContext => ({
  person_id: personId, employers: [{ employer_id: "e1", name: "他社法人" }, { employer_id: "e2", name: "別の法人" }],
  establishments: [{ establishment_id: "s1", employer_id: "e1", name: "他社事業場" }, { establishment_id: "s2", employer_id: "e2" }], declarations,
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
function tree(answer: (call: Call) => unknown, role: IdealRole) {
  const ctx = syntheticContext(role);
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  let keys = 0;
  const live = liveFrom(ctx, { client, mutate: createMutator("test", () => `idempotency-key-${++keys}`), refresh });
  const View = route.View;
  return { calls, refresh, node: (value: DeclarationContext) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider> };
}
async function mount(data: DeclarationContext = context(), answer: (call: Call) => unknown = () => ({ key: "k", revision: 1, status: "SUBMITTED" }), role: IdealRole = "PHARMACIST") {
  const { node, ...rest } = tree(answer, role);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node(data)); });
  return { ...rest, show: (value: DeclarationContext) => view.rerender(node(value)) };
}

const task = (summary: string) => screen.getByText(summary).closest("details")!;
const EDIT = "申告を登録・訂正する";
const WITHDRAW = "申告を取り下げる";
const REVIEW = "申告を他社資料と照合する（管理者）";
const field = (summary: string, label: string) => within(task(summary)).getByLabelText(label);
const set = (summary: string, label: string, value: string) => fireEvent.change(field(summary, label), { target: { value } });
const press = (summary: string, name: string) => fireEvent.click(within(task(summary)).getByRole("button", { name }));
const surface = (summary: string) => task(summary).querySelector(".ideal-confirm") as HTMLElement;
const line = (summary: string, term: string) => within(surface(summary)).getByText(term, { selector: "dt" }).parentElement!;
const changes = (summary: string) => within(line(summary, "変更内容")).getAllByRole("listitem").map((item) => item.textContent);
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");
const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
function enterNew() {
  task(EDIT).open = true;
  set(EDIT, "編集する対象", "new");
  set(EDIT, "他の雇用主・活動先", "e1"); set(EDIT, "申告する事業場", "s1");
  set(EDIT, "適用開始（日本時間）", "2026-01-01T00:00"); set(EDIT, "適用終了（日本時間）", "2027-01-01T00:00");
  press(EDIT, "所定労働の区間を追加");
  set(EDIT, "所定労働の開始 1", "2026-01-06T09:00"); set(EDIT, "所定労働の終了 1", "2026-01-06T12:00");
  fireEvent.click(field(EDIT, "この期間の労働区間をすべて記載した"));
  set(EDIT, "契約・所定時間・所定外時間の照合資料", "合成申告原本");
}

test("the route reads the declaration context once, and nothing else", async () => {
  const { calls, client } = api(() => context());
  expect(await readRoute(route, client, syntheticContext("PHARMACIST"))).toEqual({ kind: "ready", partial: [], data: context() });
  expect(calls).toEqual([{ method: "GET", path: READ, body: undefined }]);
  expect(route.names).toBe("planning");
  const refused = api(() => { throw new PlanningError(423, "restricted"); });
  expect(await readRoute(route, refused.client, syntheticContext("PHARMACIST"))).toEqual({ kind: "problem", status: 423, detail: "restricted" });
});

test("first the current state, the next step and the history; no form is open", async () => {
  const withdrawn = declaration({ declaration_id: "d-old", status: "WITHDRAWN", start: "2025-01-01T00:00:00+09:00", end: "2026-01-01T00:00:00+09:00" });
  const { calls } = await mount(context([row(declaration()), row(withdrawn, 2)]));
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["申告の状態と次の操作", "現在の状態", "次の操作", "履歴"]);
  const current = within(screen.getByRole("region", { name: "現在の申告" })).getAllByRole("row").map((item) => item.textContent);
  expect(current).toEqual(["本人状態雇用主・事業場区分適用期間（日本時間）版", "あなた照合待ち他社法人・他社事業場雇用2026-01-01 00:00 〜 2027-01-01 00:00第1版"]);
  // The withdrawn declaration is the history; the current one is not repeated there.
  expect(within(screen.getByRole("region", { name: "取り下げた申告（現在の版）" })).getAllByRole("row").slice(1).map((item) => item.textContent)).toEqual(["あなた取下げ済み他社法人・他社事業場雇用2025-01-01 00:00 〜 2026-01-01 00:00第2版"]);
  expect(panel("履歴")).toHaveTextContent("この画面に表示できるのは現在の版の内容だけで、以前の版の内容は表示できません。");
  expect(screen.getByText("照合が済んでいない申告 1件")).toBeInTheDocument();
  for (const summary of [EDIT, WITHDRAW]) expect(task(summary).open).toBe(false);
  expect(field(EDIT, "編集する対象")).not.toBeVisible();
  expect(within(task(EDIT)).queryByLabelText("他の雇用主・活動先")).toBeNull();
  // The comparison and the audit history are the administrator's.
  expect(screen.queryByText(REVIEW)).toBeNull();
  expect(screen.queryByRole("link", { name: /監査の履歴を開く/ })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(calls).toEqual([]);
  expect(document.body.innerHTML).not.toMatch(/href="\/(planning|settings|dashboard)/);
  expect(document.body.innerHTML).not.toMatch(/class="[^"]*\b(ui-|workflow-|ideal-v3-purpose)/);
  // Identifiers and status codes are not the text a person reads.
  expect(document.body).not.toHaveTextContent(/SUBMITTED|WITHDRAWN|d-own|synthetic-pharmacist/);
});

test("the header leads to the registration and, for an administrator, from its count to the comparison; no declaration is listed twice", async () => {
  Element.prototype.scrollIntoView = jest.fn();
  const withdrawn = declaration({ declaration_id: "d-old", status: "WITHDRAWN", start: "2025-01-01T00:00:00+09:00", end: "2026-01-01T00:00:00+09:00" });
  const frame = (summary: string) => task(summary).parentElement!;
  const { show } = await mount(context([row(declaration()), row(withdrawn, 2)]));
  // Registering is what the route points a person at; a withdrawal changes a status and is not marked as one that cannot be undone.
  expect(frame(EDIT)).toHaveClass("ideal-v3-task--primary");
  expect(frame(WITHDRAW)).toHaveClass("ideal-v3-task--routine");
  expect(document.querySelector(".ideal-v3-task--danger")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  expect(task(EDIT).open).toBe(true);
  expect(screen.queryByRole("button", { name: "照合する" })).toBeNull();
  // Each declaration is in one of the two tables.
  expect(within(screen.getByRole("region", { name: "現在の申告" })).getAllByRole("row")).toHaveLength(2);
  expect(within(screen.getByRole("region", { name: "取り下げた申告（現在の版）" })).getAllByRole("row")).toHaveLength(2);
  // Nothing withdrawn: the history says so and points to where the declarations are.
  show(context([row(declaration())]));
  expect(screen.queryByRole("region", { name: "取り下げた申告（現在の版）" })).toBeNull();
  expect(panel("履歴")).toHaveTextContent("取り下げた申告はありません。取り下げていない申告は、上の「現在の状態」に表示しています。");
  document.body.innerHTML = "";
  await mount(context([row(declaration())], "synthetic-admin"), undefined, "ADMIN");
  // The comparison is what the route points an administrator at.
  expect(frame(EDIT)).toHaveClass("ideal-v3-task--routine");
  expect(frame(REVIEW)).toHaveClass("ideal-v3-task--primary");
  fireEvent.click(screen.getByRole("button", { name: "照合する" }));
  expect(task(REVIEW).open).toBe(true);
  expect(screen.getByText(REVIEW, { selector: "summary" })).toHaveFocus();
});

test("the showcase shows each role what the API gives it, ready and empty", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const admin = render(<CognitiveWorkspaceShowcase screen="requests" view="outside" role="ADMIN" />);
  expect(await screen.findByRole("heading", { level: 2, name: "現在の状態" })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "現在の申告" })).getAllByRole("row").slice(1).map((item) => item.textContent)).toEqual([
    "高橋 葵照合待ち合成薬局 みなと店（架空）・みなと店雇用2026-10-01 00:00 〜 2027-04-01 00:00第1版",
    "鈴木 悠斗確認済み合成薬局 みなと店（架空）・みなと店雇用2026-10-01 00:00 〜 2027-04-01 00:00第2版",
  ]);
  expect(within(screen.getByRole("region", { name: "取り下げた申告（現在の版）" })).getAllByRole("row")).toHaveLength(2);
  expect(screen.getByText(REVIEW)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /監査の履歴を開く/ })).toHaveAttribute("href", "/workspace/governance/audit");
  admin.unmount();
  const leader = render(<CognitiveWorkspaceShowcase screen="requests" view="outside" role="LEADER" />);
  expect(await screen.findByRole("region", { name: "現在の申告" })).toHaveTextContent("鈴木 悠斗確認済み合成薬局 みなと店（架空）・みなと店雇用2026-10-01 00:00 〜 2027-04-01 00:00第2版");
  expect(within(screen.getByRole("region", { name: "現在の申告" })).getAllByRole("row")).toHaveLength(2);
  // The server's refusal for the person's own reviewed declaration is shown as it gives it.
  expect(panel("現在の状態")).toHaveTextContent(LOCK);
  expect(screen.queryByText(REVIEW)).toBeNull();
  leader.unmount();
  const pharmacist = render(<CognitiveWorkspaceShowcase screen="requests" view="outside" role="PHARMACIST" />);
  expect(await screen.findByRole("region", { name: "現在の申告" })).toHaveTextContent("あなた照合待ち合成薬局 みなと店（架空）・みなと店雇用2026-10-01 00:00 〜 2027-04-01 00:00第1版");
  expect(within(screen.getByRole("region", { name: "取り下げた申告（現在の版）" })).getAllByRole("row")).toHaveLength(2);
  pharmacist.unmount();
  render(<CognitiveWorkspaceShowcase screen="requests" view="outside" role="PHARMACIST" state="empty" />);
  expect(await screen.findByText("現在の申告はありません。")).toBeInTheDocument();
  expect(screen.getByText("申告の記録はありません。")).toBeInTheDocument();
  expect(screen.getByText("照合待ちの申告なし")).toBeInTheDocument();
  expect(screen.getByText(EDIT)).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a new declaration: entered, confirmed with the four statements, then saved with the body the server takes", async () => {
  const { calls, refresh } = await mount(context([]), () => ({ key: "k", revision: 1, status: "SUBMITTED" }));
  task(EDIT).open = true;
  set(EDIT, "編集する対象", "new");
  expect(within(task(EDIT)).getByRole("heading", { level: 3, name: "2. 申告の内容を入力する" })).toBeInTheDocument();
  set(EDIT, "他の雇用主・活動先", "e1");
  // The sites are those of the chosen employer.
  expect(within(field(EDIT, "申告する事業場")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "他社事業場"]);
  enterNew();
  expect(field(EDIT, "編集する対象")).toBeDisabled();
  expect(hasUnsavedChanges()).toBe(true);
  press(EDIT, "保存内容を確認する");
  expect(calls).toEqual([]);
  expect(within(surface(EDIT)).getByRole("heading", { level: 3, name: "3. 保存前の確認" })).toHaveFocus();
  expect(within(surface(EDIT)).getAllByRole("term").map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
  expect(changes(EDIT)).toEqual([
    "本人：（なし） → あなた", "他の雇用主・活動先：（なし） → 他社法人", "事業場：（なし） → 他社事業場", "活動の区分：（なし） → 雇用", "契約締結順：（なし） → 未記載",
    "適用開始（日本時間）：（なし） → 2026-01-01 00:00", "適用終了（日本時間）：（なし） → 2027-01-01 00:00",
    "所定労働区間：（なし） → 2026-01-06 09:00 〜 2026-01-06 12:00", "労働区間の記載：（なし） → この期間の区間をすべて記載した", "照合資料：（なし） → 合成申告原本", "状態：（なし） → 照合待ち",
  ]);
  expect(line(EDIT, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  expect(line(EDIT, "通知")).toHaveTextContent("誰にも通知されません。保存後は、本人と管理者のこの画面の一覧に表示されます。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。");
  expect(line(EDIT, "競合・部分失敗")).toHaveTextContent("保存前の時点では検出されていません。保存時にサーバーが、この申告がまだ登録されていないことを照合します。");
  await act(async () => { press(EDIT, "この内容で保存する"); });
  // The body the established form sent for the same entries (checked against it when this
  // screen replaced it).
  expect(calls).toEqual([{ method: "POST", path: SAVE, body: {
    expected_revision: 0,
    payload: { declaration_id: "11111111-2222-4333-8444-555555555555", person_id: "synthetic-pharmacist", employer_id: "e1", establishment_id: "s1", contract_order: null, activity: "employment",
      start: "2025-12-31T15:00:00.000Z", end: "2026-12-31T15:00:00.000Z", reference: "合成申告原本", status: "SUBMITTED", review_evidence: null, work_report_complete: true,
      scheduled_work: [{ start: "2026-01-06T00:00:00.000Z", end: "2026-01-06T03:00:00.000Z" }], additional_work: [], other_holiday_work: [] },
    idempotency_key: expect.any(String),
  } }]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(within(task(EDIT)).getByText("申告を第1版として記録しました（照合待ち）。")).toBeInTheDocument();
  expect(surface(EDIT)).toBeNull();
  expect(within(task(EDIT)).getByRole("heading", { level: 3, name: "1. 対象を選ぶ" })).toHaveFocus();
  expect(hasUnsavedChanges()).toBe(false);
});

test("a correction is a new submission: the status returns to awaiting comparison and the review is dropped", async () => {
  const returned = declaration({ status: "RETURNED", review_evidence: { reference: "差異あり", status: "verified", verified_by: "admin", valid_until: null } });
  const { calls } = await mount(context([row(returned, 2)]), () => ({ key: "k", revision: 3, status: "SUBMITTED" }));
  task(EDIT).open = true;
  set(EDIT, "編集する対象", "d-own");
  expect(field(EDIT, "他の雇用主・活動先")).toHaveValue("e1");
  expect(field(EDIT, "所定労働の開始 1")).toHaveValue("2026-01-05T09:00");
  set(EDIT, "契約・所定時間・所定外時間の照合資料", "原本（再提出）");
  press(EDIT, "所定労働の区間 1 を削除");
  press(EDIT, "保存内容を確認する");
  expect(changes(EDIT)).toEqual(["所定労働区間：2026-01-05 09:00 〜 2026-01-05 13:00 → （なし）", "照合資料：原本 → 原本（再提出）", "状態：再確認 → 照合待ち", "照合根拠：差異あり → （なし）", "照合担当者：admin → （なし）", "照合の有効期限：期限なし → （なし）"]);
  expect(line(EDIT, "作成される版")).toHaveTextContent("第2版 → 第3版");
  await act(async () => { press(EDIT, "この内容で保存する"); });
  expect(calls[0].body).toEqual({ expected_revision: 2, payload: { ...returned, start: "2025-12-31T15:00:00.000Z", end: "2026-12-31T15:00:00.000Z", reference: "原本（再提出）", scheduled_work: [], status: "SUBMITTED", review_evidence: null, other_holiday_work: [] }, idempotency_key: expect.any(String) });
  expect(within(task(EDIT)).getByText("申告を第3版として記録しました（照合待ち）。")).toBeInTheDocument();
});

test("a conflict shows the three contents; saving again needs the review and goes against the current version", async () => {
  const theirs = declaration({ reference: "管理者が直した原本" });
  let saves = 0;
  const { calls, refresh } = await mount(context(), (call) => {
    if (call.method === "GET") return context([row(theirs, 2)]);
    if (++saves === 1) throw new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" }));
    return { key: "k", revision: 3, status: "SUBMITTED" };
  });
  task(EDIT).open = true;
  set(EDIT, "編集する対象", "d-own");
  set(EDIT, "契約締結順（不明の場合は空欄）", "2");
  press(EDIT, "保存内容を確認する");
  await act(async () => { press(EDIT, "この内容で保存する"); });
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST ${SAVE}`, `GET ${READ}`]);
  expect(within(surface(EDIT)).getByRole("alert")).toHaveTextContent("現在の版は第2版です。編集中の内容は保持しています。自動では統合しません。");
  const rows = within(within(surface(EDIT)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").map((item) => item.textContent);
  expect(rows.slice(0, 3)).toEqual(["項目編集開始時現在編集中差分", "契約締結順112あり", "照合資料原本管理者が直した原本原本あり"]);
  expect(within(surface(EDIT)).getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
  expect(refresh).toHaveBeenCalledTimes(1);
  press(EDIT, "三つの内容を確認し、現在の版に対して確認し直す");
  expect(within(surface(EDIT)).getByRole("status")).toHaveTextContent("現在の第2版との差分に更新しました。");
  expect(changes(EDIT)).toEqual(["契約締結順：1 → 2", "照合資料：管理者が直した原本 → 原本"]);
  expect(line(EDIT, "作成される版")).toHaveTextContent("第2版 → 第3版");
  await act(async () => { press(EDIT, "この内容で保存する"); });
  expect(posts(calls)).toHaveLength(2);
  expect(posts(calls)[1].body).toMatchObject({ expected_revision: 2, payload: { contract_order: 2, reference: "原本" } });
  expect((posts(calls)[1].body as { idempotency_key: string }).idempotency_key).not.toBe((posts(calls)[0].body as { idempotency_key: string }).idempotency_key);
});

test("after an unknown outcome the identical body is sent again with the same key; a refusal is shown in the server's words", async () => {
  let saves = 0;
  const { calls, refresh } = await mount(context([]), () => {
    saves += 1;
    if (saves === 1) throw new PlanningError(503, "down");
    if (saves === 3) throw new PlanningError(422, JSON.stringify({ detail: "Declared work intervals must not overlap or escape the declaration period" }));
    return { key: "k", revision: 1, status: "SUBMITTED" };
  });
  enterNew();
  press(EDIT, "保存内容を確認する");
  await act(async () => { press(EDIT, "この内容で保存する"); });
  expect(line(EDIT, "競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます");
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => { press(EDIT, "同じ内容を再送する"); });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
  expect(refresh).toHaveBeenCalledTimes(1);
  // Whether an interval may leave the declared period is not judged here.
  enterNew();
  set(EDIT, "所定労働の終了 1", "2027-06-01T12:00");
  press(EDIT, "保存内容を確認する");
  await act(async () => { press(EDIT, "この内容で保存する"); });
  expect(line(EDIT, "競合・部分失敗")).toHaveTextContent("保存していません。サーバーが下の理由で受け付けませんでした。");
  expect(within(surface(EDIT)).getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりましたDeclared work intervals must not overlap or escape the declaration period");
  press(EDIT, "入力に戻る");
  expect(field(EDIT, "契約・所定時間・所定外時間の照合資料")).toHaveValue("合成申告原本");
});

test("only presence, number format and a period that runs forward are checked in the form", async () => {
  const { calls } = await mount(context([]));
  enterNew();
  for (const label of ["他の雇用主・活動先", "申告する事業場", "適用開始（日本時間）", "適用終了（日本時間）", "所定労働の開始 1", "所定労働の終了 1", "契約・所定時間・所定外時間の照合資料"]) expect(field(EDIT, label)).toBeRequired();
  expect(field(EDIT, "契約締結順（不明の場合は空欄）")).not.toBeRequired();
  set(EDIT, "適用終了（日本時間）", "2026-01-01T00:00");
  press(EDIT, "保存内容を確認する");
  expect(within(task(EDIT)).getByRole("alert")).toHaveTextContent("適用終了は、適用開始より後にしてください。");
  expect(surface(EDIT)).toBeNull();
  press(EDIT, "入力を破棄する");
  expect(within(task(EDIT)).queryByLabelText("他の雇用主・活動先")).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
  press(EDIT, "勤務先の候補と申告を読み直す");
  expect(calls).toEqual([]);
});

test("a withdrawal sends the stored declaration with the withdrawn status, after its confirmation", async () => {
  const { calls, refresh } = await mount(context(), () => ({ key: "k", revision: 2, status: "WITHDRAWN" }));
  task(WITHDRAW).open = true;
  set(WITHDRAW, "取り下げる申告", "d-own");
  press(WITHDRAW, "取下げの内容を確認する");
  expect(calls).toEqual([]);
  expect(within(surface(WITHDRAW)).getByRole("heading", { level: 3, name: "2. 取下げ前の確認" })).toHaveFocus();
  expect(changes(WITHDRAW)).toEqual(["状態：照合待ち → 取下げ済み"]);
  expect(line(WITHDRAW, "作成される版")).toHaveTextContent("第1版 → 第2版");
  expect(line(WITHDRAW, "通知")).toHaveTextContent("誰にも通知されません。");
  await act(async () => { press(WITHDRAW, "この申告を取り下げる"); });
  expect(calls).toEqual([{ method: "POST", path: SAVE, body: { expected_revision: 1, payload: { ...declaration(), status: "WITHDRAWN", review_evidence: null }, idempotency_key: expect.any(String) } }]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(within(task(WITHDRAW)).getByText("申告を取り下げました（第2版、取下げ済み）。以前の版は残ります。")).toBeInTheDocument();
  expect(within(task(WITHDRAW)).getByRole("heading", { level: 3, name: "1. 取り下げる申告を選ぶ" })).toHaveFocus();
});

test("a declaration the server closes to the person is not offered; its refusal is the server's text", async () => {
  const locked = row(declaration({ status: "REVIEWED", work_report_complete: true, review_evidence: { reference: "r", status: "verified", verified_by: "admin", valid_until: null } }), 2, { change: { allowed: false, refusal: LOCK } });
  await mount(context([locked]));
  expect(panel("現在の状態")).toHaveTextContent(`他社法人（2026-01-01 00:00 〜 2027-01-01 00:00）：${LOCK}`);
  expect(within(field(EDIT, "編集する対象")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "新しい申告を登録する"]);
  expect(within(task(EDIT)).getByRole("list", { name: "変更できない申告" })).toHaveTextContent(LOCK);
  expect(within(task(WITHDRAW)).getByText("取り下げられる申告はありません。")).toBeInTheDocument();
  expect(within(task(WITHDRAW)).getByRole("list", { name: "取り下げられない申告" })).toHaveTextContent(LOCK);
});

test("a withdrawal that conflicts is confirmed again against the current version; the server's refusal is shown", async () => {
  const theirs = declaration({ reference: "直した原本" });
  let saves = 0;
  const { calls } = await mount(context(), (call) => {
    if (call.method === "GET") return context([row(theirs, 2)]);
    saves += 1;
    if (saves === 1) throw new PlanningError(409, "conflict");
    if (saves === 2) throw new PlanningError(422, JSON.stringify({ detail: LOCK }));
    return { key: "k", revision: 3, status: "WITHDRAWN" };
  });
  task(WITHDRAW).open = true;
  set(WITHDRAW, "取り下げる申告", "d-own");
  press(WITHDRAW, "取下げの内容を確認する");
  await act(async () => { press(WITHDRAW, "この申告を取り下げる"); });
  expect(within(surface(WITHDRAW)).getByRole("alert")).toHaveTextContent("現在の版は第2版です。");
  expect(within(surface(WITHDRAW)).getByRole("region", { name: "三つの内容の比較" })).toHaveTextContent("照合資料原本直した原本原本あり");
  press(WITHDRAW, "三つの内容を確認し、現在の版に対して確認し直す");
  expect(within(surface(WITHDRAW)).getByRole("status")).toHaveTextContent("現在の第2版に対する取下げとして確認し直します。");
  await act(async () => { press(WITHDRAW, "この申告を取り下げる"); });
  expect(posts(calls)[1].body).toMatchObject({ expected_revision: 2, payload: { reference: "直した原本", status: "WITHDRAWN" } });
  expect(within(surface(WITHDRAW)).getByRole("alert")).toHaveTextContent(`422サーバーの検証で止まりました${LOCK}`);
  press(WITHDRAW, "取り下げずに戻る");
  expect(surface(WITHDRAW)).toBeNull();
});

test("the administrator's comparison: the declared totals as a plain sum, then the decision with its evidence", async () => {
  const own = declaration({ person_id: "synthetic-leader", additional_work: [{ start: "2026-01-12T18:00:00+09:00", end: "2026-01-12T19:30:00+09:00" }], other_holiday_work: [{ start: "2026-02-01T09:00:00+09:00", end: "2026-02-01T11:00:00+09:00" }] });
  const { calls, refresh } = await mount(context([row(own)], "synthetic-admin"), () => ({ key: "k", revision: 2, status: "REVIEWED" }), "ADMIN");
  task(REVIEW).open = true;
  set(REVIEW, "照合する申告", "d-own");
  expect(within(task(REVIEW)).getByRole("heading", { level: 3, name: "2. 申告内容を確かめ、判断と根拠を入力する" })).toBeInTheDocument();
  const totals = within(task(REVIEW)).getByRole("region", { name: "照合用の集計" });
  expect(totals).toHaveTextContent("申告された区間の長さを、区間の開始日で週・月に分けて単純に合計した値です。労働時間の通算や法令上の判定ではありません。");
  expect(within(within(totals).getByRole("region", { name: "週別の単純合計（月曜始まり・日本時間）" })).getAllByRole("row").map((item) => item.textContent)).toEqual([
    "期間所定所定外うち他社の法定休日", "2026-01-054時間0分0時間0分0時間0分", "2026-01-120時間0分1時間30分0時間0分", "2026-01-260時間0分2時間0分2時間0分",
  ]);
  expect(within(within(totals).getByRole("region", { name: "月別の単純合計（日本時間）" })).getAllByRole("row").slice(1).map((item) => item.textContent)).toEqual(["2026-014時間0分1時間30分0時間0分", "2026-020時間0分2時間0分2時間0分"]);
  expect(field(REVIEW, "照合根拠")).toBeRequired();
  set(REVIEW, "照合根拠", "他社の就業証明と照合");
  expect(hasUnsavedChanges()).toBe(true);
  press(REVIEW, "判断の内容を確認する");
  expect(calls).toEqual([]);
  expect(within(surface(REVIEW)).getByRole("heading", { level: 3, name: "3. 記録前の確認" })).toHaveFocus();
  expect(changes(REVIEW)).toEqual(["状態：照合待ち → 確認済み", "照合根拠：（なし） → 他社の就業証明と照合", "照合担当者：（なし） → サインイン中の管理者（サーバーが記録）", "照合の有効期限：（なし） → 期限なし"]);
  expect(line(REVIEW, "作成される版")).toHaveTextContent("第1版 → 第2版");
  expect(line(REVIEW, "通知")).toHaveTextContent("誰にも通知されません。判断後の状態は、本人と管理者のこの画面の一覧に表示されます。");
  await act(async () => { press(REVIEW, "この判断を記録する"); });
  expect(calls).toEqual([{ method: "POST", path: SAVE, body: { expected_revision: 1, payload: { ...own, status: "REVIEWED", review_evidence: { reference: "他社の就業証明と照合", verified_by: null, status: "verified", valid_until: null } }, idempotency_key: expect.any(String) } }]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(within(task(REVIEW)).getByText("照合判断を第2版として記録しました（確認済み）。")).toBeInTheDocument();
  expect(hasUnsavedChanges()).toBe(false);
  // "Ask again" with an expiry.
  set(REVIEW, "照合する申告", "d-own");
  set(REVIEW, "判断", "RETURNED"); set(REVIEW, "照合根拠", "時間数が一致しない"); set(REVIEW, "照合の有効期限（空欄なら期限なし）", "2026-06-30T23:59");
  press(REVIEW, "判断の内容を確認する");
  expect(changes(REVIEW)).toContain("状態：照合待ち → 再確認");
  await act(async () => { press(REVIEW, "この判断を記録する"); });
  expect((posts(calls)[1].body as { payload: DeclarationPayload }).payload).toMatchObject({ status: "RETURNED", review_evidence: { reference: "時間数が一致しない", verified_by: null, status: "verified", valid_until: "2026-06-30T14:59:00.000Z" } });
});

test("the declared totals are a plain sum by the Japan-time week and month in which an interval starts", () => {
  // Sunday 2026-03-01 23:00 JST is still the week of Monday 2026-02-23.
  const totals = declaredTotals({ scheduled_work: [{ start: "2026-03-01T14:00:00Z", end: "2026-03-01T15:00:00Z" }, { start: "2026-03-02T00:00:00Z", end: "2026-03-02T02:30:00Z" }], additional_work: [], other_holiday_work: undefined });
  expect(totals.weeks).toEqual([{ period: "2026-02-23", scheduled: 3600, extra: 0, holiday: 0 }, { period: "2026-03-02", scheduled: 9000, extra: 0, holiday: 0 }]);
  expect(totals.months).toEqual([{ period: "2026-03", scheduled: 12600, extra: 0, holiday: 0 }]);
  expect(hoursText(12600)).toBe("3時間30分");
});

// The route arrives as server HTML. Its tasks have no field until React attaches, so
// nothing can be typed into a form that could not keep it.
describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("the server HTML holds the state and the closed tasks without fields; a task opened there stays open and gets its form", async () => {
    const { node } = tree(() => ({}), "ADMIN");
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node(context([row(declaration())], "synthetic-admin")));
    expect(container.innerHTML).toContain("現在の状態");
    expect(container.innerHTML).toContain(EDIT);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    const details = within(container).getByText(WITHDRAW).closest("details")!;
    details.open = true;
    await act(async () => { root = hydrateRoot(container, node(context([row(declaration())], "synthetic-admin"))); });
    expect(details.open).toBe(true);
    expect(within(details).getByLabelText("取り下げる申告")).toBeVisible();
    expect(within(container).getByText(EDIT).closest("details")!.querySelector("select")).not.toBeNull();
  });
});
