import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { TextDecoder as NodeTextDecoder } from "util";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { hasUnsavedChanges } from "../../../shared/useUnsavedNavigation";
import { ROUTE_DEFINITIONS, routeKey } from "../../../shell/routes";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { ActualRow, ActualsContext } from "../../api";
import { actualsOf, rowErrorsOf, type ActualsData } from "../model";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

// jsdom has neither; the browser has both.
if (!("TextDecoder" in global)) Object.defineProperty(global, "TextDecoder", { value: NodeTextDecoder });
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(this); });
  };
}

let uuids = 0;
beforeEach(() => { uuids = 0; Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => `00000000-0000-4000-8000-00000000000${uuids++}`) }); });
afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const READ = `/compliance/workflow-context?${SCOPE}`;
const SAVE = `/compliance/actual-events?${SCOPE}`;
const NOTE = `/compliance/actual-reviews?${SCOPE}`;
const PREVIEW = `/compliance/actual-import/preview?${SCOPE}`;
const COMMIT = `/compliance/actual-import/commit?${SCOPE}`;
const DAY = { start: "2026-01-05T09:00:00+09:00", end: "2026-01-05T17:00:00+09:00" };
const duty = (over: Record<string, unknown> = {}) => ({ duty_id: "d1", person_id: "p1", relationship_id: "r1", kind: "日勤", task: "調剤", location: "薬剤部", ...DAY, work: [DAY], breaks: [], source: "actual", fixed: false, ...over });
const TERMS = { duty_id: "d1", employment_revision_id: "e1", scheduled_work: [DAY], planned_duty_id: null, planned_publication_id: null };
const PLANNED = duty({ duty_id: "planned-1", source: "published" });
const actual = (over: Partial<ActualRow> = {}): ActualRow => ({ external_id: "clock-1", revision: 1, reviewed: false, duty: duty(), ...over } as ActualRow);
/** The workflow context as the API returns it: more than the route keeps. */
const context = (over: Partial<ActualsContext> = {}): ActualsContext => ({
  role: "ADMIN", can_correct_actuals: true, input_hash: "a".repeat(64), contracts: [{ person_id: "p1" }], leave_accounts: [{ account_id: "x" }],
  people: [{ person_id: "p1", name: "薬剤師一" }, { person_id: "p2", name: "薬剤師二" }],
  employments: [
    { revision_id: "e1", relationship_id: "r1", person_id: "p1", start: "2025-04-01T00:00:00+09:00", end: "2026-04-01T00:00:00+09:00", working_time_system: "standard" },
    { revision_id: "e2", relationship_id: "r1", person_id: "p1", start: "2026-04-01T00:00:00+09:00", end: "2027-04-01T00:00:00+09:00", working_time_system: "flex" },
    { revision_id: "e3", relationship_id: "r2", person_id: "p2", start: "2025-04-01T00:00:00+09:00", end: "2027-04-01T00:00:00+09:00", working_time_system: "flex" },
  ],
  duty_options: [{ kind: "日勤", task: "調剤", location: "薬剤部" }, { kind: "遅番", task: "病棟", location: "本館" }],
  publications: [{ publication_id: "pub1", version: 3, period: "2026-01-01T00:00:00+09:00|2026-02-01T00:00:00+09:00", assignments: [PLANNED] }],
  actuals: [actual()],
  records: [{ kind: "work_terms", entity_id: "d1", revision: 2, payload: TERMS }, { kind: "contract", entity_id: "c1", revision: 1, payload: {} }],
  ...over,
} as unknown as ActualsContext);

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
  return { calls, refresh, node: (value: ActualsData) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider> };
}
/** Answers a read with the context and a change with `done`. */
const serve = (done: unknown = { event_id: "event", duplicate: false }, read: () => ActualsContext = context) => (call: Call): unknown => (call.method === "GET" ? read() : done);
async function mount(answer: (call: Call) => unknown = serve(), value: ActualsContext = context(), role: IdealRole = "ADMIN") {
  const { node, ...rest } = tree(answer, role);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node(actualsOf(value))); });
  return { ...rest, show: (next: ActualsContext) => view.rerender(node(actualsOf(next))) };
}

const IMPORT = "実績原本のファイルを取り込む";
const CORRECT = "登録済みの実績を訂正する";
const FROM_DUTY = "公開勤務から実績を記録する";
const UNPLANNED = "計画なしの実績を記録する（フレックスタイム制の雇用条件）";
const REVIEW = "照合内容を記録する";
const task = (summary: string) => screen.getByText(summary, { selector: "summary" }).closest("details")!;
const open = async (summary: string) => { const details = task(summary); details.open = true; await act(async () => { fireEvent(details, new Event("toggle")); }); return details; };
const field = (summary: string, label: string) => within(task(summary)).getByLabelText(label);
const set = (summary: string, label: string, value: string) => fireEvent.change(field(summary, label), { target: { value } });
const press = (summary: string, name: string) => fireEvent.click(within(task(summary)).getByRole("button", { name }));
const confirm = async (summary: string, name: string) => { await act(async () => { press(summary, name); }); };
const surface = (summary: string) => task(summary).querySelector(".ideal-confirm") as HTMLElement;
const line = (summary: string, term: string) => within(surface(summary)).getByText(term, { selector: "dt" }).parentElement!;
const changes = (summary: string) => within(line(summary, "変更内容")).getAllByRole("listitem").map((item) => item.textContent);
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");
const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const NOBODY = "誰にも通知されません。";

test("the route reads the workflow context once and keeps only what its first view shows", async () => {
  const { calls, client } = api(() => context());
  expect(await readRoute(route, client, syntheticContext("ADMIN"))).toEqual({ kind: "ready", partial: [], data: {
    role: "ADMIN", canCorrect: true, names: { p1: "薬剤師一", p2: "薬剤師二" }, actuals: [actual()],
  } });
  expect(calls).toEqual([{ method: "GET", path: READ, body: undefined }]);
  expect(route.names).toBe("none");
  // Without a registered input the server has nothing to stage the records over.
  const refused = api(() => { throw new PlanningError(409, "版2の確認済み入力が必要です。"); });
  expect(await readRoute(route, refused.client, syntheticContext("LEADER"))).toEqual({ kind: "problem", status: 409, detail: "版2の確認済み入力が必要です。" });
  // The first view of the screen a leader has: the screen without a view opens it.
  expect(ROUTE_DEFINITIONS["governance/actuals"]).toBe(route);
  expect(routeKey("governance", undefined, "LEADER")).toBe("governance/actuals");
});

test("first the current state, the next step and the history; no form is open and nothing is read", async () => {
  const { calls } = await mount(serve(), context({ actuals: [actual(), actual({ external_id: "clock-2", revision: 3, reviewed: true, duty: duty({ duty_id: "d2", person_id: "p2", breaks: [{ start: "2026-01-05T12:00:00+09:00", end: "2026-01-05T13:00:00+09:00" }] }) as never })] }));
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["実績の状態と次の操作", "現在の状態", "次の操作", "履歴"]);
  expect(within(screen.getByRole("region", { name: "登録済みの実績" })).getAllByRole("row").map((item) => item.textContent)).toEqual([
    "職員勤務の開始（日本時間）実労働休憩版照合の記録",
    "薬剤師一2026-01-05 09:002026-01-05 09:00 〜 2026-01-05 17:00なし第1版未記録",
    "薬剤師二2026-01-05 09:002026-01-05 09:00 〜 2026-01-05 17:002026-01-05 12:00 〜 2026-01-05 13:00第3版現在の版に記録あり",
  ]);
  expect(screen.getByText("照合の記録がない実績 1件")).toBeInTheDocument();
  expect(panel("現在の状態")).toHaveTextContent("あなたは「部署管理者」として登録されています。この画面では、実績の取込・記録・訂正と、照合内容の記録ができます。");
  // What stands comes first; what the viewer may do follows it.
  expect(panel("現在の状態").lastElementChild).toHaveTextContent("あなたは「部署管理者」として登録されています。");
  expect(panel("履歴")).toHaveTextContent("いつ・どの役割が実績を変更したかは、この画面には表示されません。監査の履歴で確認できます。");
  expect(panel("履歴")).not.toHaveTextContent("API");
  expect(panel("履歴")).toHaveTextContent("2件（最も新しい版は第3版）");
  expect(within(panel("履歴")).getByRole("link", { name: "監査の履歴を開く" })).toHaveAttribute("href", "/workspace/governance/audit");
  for (const summary of [IMPORT, CORRECT, FROM_DUTY, UNPLANNED, REVIEW]) expect(task(summary).open).toBe(false);
  expect(within(task(REVIEW)).getByLabelText("照合する実績")).not.toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(calls).toEqual([]);
  expect(document.body.innerHTML).not.toMatch(/href="\/(planning|settings|dashboard)/);
  expect(document.body.innerHTML).not.toMatch(/class="[^"]*\b(ui-|workflow-|ideal-v3-purpose)/);
  // Identifiers are folded away; the table names people and times.
  expect(screen.getByRole("region", { name: "登録済みの実績" })).not.toHaveTextContent(/clock-|p1|d1/);
  expect(within(panel("現在の状態")).getByText("識別情報").closest("details")).toHaveTextContent("薬剤師一 2026-01-05 09:00 の原本の識別子：clock-1");
});

test("next is two groups, reconciling first; every task says in a line what it does, and the header's count leads to the reconciling task", async () => {
  Element.prototype.scrollIntoView = jest.fn();
  const { calls, show } = await mount(serve(), context({ actuals: [actual(), actual({ external_id: "clock-2", reviewed: true })] }));
  const next = panel("次の操作");
  expect(Array.from(next.querySelectorAll(":scope > .ideal-v3-record > section > h3")).map((heading) => heading.textContent)).toEqual(["照合する", "実績を登録・訂正する（管理者）"]);
  expect(Array.from(next.querySelectorAll(".ideal-v3-task > details > summary")).map((summary) => summary.textContent)).toEqual([REVIEW, IMPORT, CORRECT, FROM_DUTY, UNPLANNED]);
  // The look is fixed where the tasks are declared: one primary, the rest ordinary, none without its line.
  expect(Array.from(next.querySelectorAll(".ideal-v3-task")).map((frame) => frame.className)).toEqual(["ideal-v3-task ideal-v3-task--primary", ...Array(4).fill("ideal-v3-task ideal-v3-task--routine")]);
  for (const summary of [REVIEW, IMPORT, CORRECT, FROM_DUTY, UNPLANNED]) {
    const described = screen.getByText(summary, { selector: "summary" });
    expect(described.textContent).toBe(summary);
    expect(described).toHaveAccessibleDescription(/します。/);
  }
  expect(screen.getByText(REVIEW, { selector: "summary" })).toHaveAccessibleDescription("実績と公開した勤務を比べた内容と、差の理由を記録します。");
  // From the count to its task: a button of the page, which opens the task and reads nothing.
  const jump = screen.getByRole("button", { name: "照合を記録する" });
  expect(jump.closest("section")).toBe(screen.getByText("照合の記録がない実績 1件").closest("section"));
  fireEvent.click(jump);
  expect(task(REVIEW).open).toBe(true);
  expect(screen.getByText(REVIEW, { selector: "summary" })).toHaveFocus();
  for (const summary of [IMPORT, CORRECT, FROM_DUTY, UNPLANNED]) expect(task(summary).open).toBe(false);
  expect(calls).toEqual([]);
  // Nothing is waiting: the count says so and there is nothing to lead to.
  show(context({ actuals: [actual({ reviewed: true })] }));
  expect(screen.getByText("すべての実績に照合の記録あり")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "照合を記録する" })).toBeNull();
});

test("the showcase shows an administrator and a leader what the API gives each, ready and empty", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const admin = render(<CognitiveWorkspaceShowcase screen="governance" view="actuals" role="ADMIN" />);
  expect(await screen.findByRole("heading", { level: 2, name: "現在の状態" })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "登録済みの実績" })).getAllByRole("row").slice(1).map((item) => item.textContent)).toEqual([
    "高橋 葵2026-10-12 08:302026-10-12 08:30 〜 2026-10-12 17:45なし第2版現在の版に記録あり",
    "鈴木 悠斗2026-10-12 10:302026-10-12 10:30 〜 2026-10-12 19:30なし第1版未記録",
  ]);
  for (const summary of [IMPORT, CORRECT, FROM_DUTY, UNPLANNED, REVIEW]) expect(screen.getByText(summary)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "監査の履歴を開く" })).toBeInTheDocument();
  admin.unmount();
  const leader = render(<CognitiveWorkspaceShowcase screen="governance" view="actuals" role="LEADER" />);
  expect(await screen.findByRole("region", { name: "登録済みの実績" })).toBeInTheDocument();
  expect(panel("現在の状態")).toHaveTextContent("あなたは「部署責任者」として登録されています。この画面では、照合内容の記録ができます。実績の取込・記録・訂正ができるのは、管理者だけです。");
  for (const summary of [IMPORT, CORRECT, FROM_DUTY, UNPLANNED]) expect(screen.queryByText(summary)).toBeNull();
  expect(panel("次の操作")).toHaveTextContent("実績の取込・記録・訂正は、サーバーが管理者にだけ許可しています。");
  expect(screen.getByText(REVIEW)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "監査の履歴を開く" })).toBeNull();
  expect(panel("履歴")).toHaveTextContent("監査の履歴は管理者が確認できます。");
  leader.unmount();
  // The governance screen without a view is the leader's only view of it.
  const index = render(<CognitiveWorkspaceShowcase screen="governance" role="LEADER" />);
  expect(await screen.findByRole("region", { name: "登録済みの実績" })).toBeInTheDocument();
  index.unmount();
  render(<CognitiveWorkspaceShowcase screen="governance" view="actuals" role="ADMIN" state="empty" />);
  expect(await screen.findByText("登録済みの実績はありません。実績は、原本の取込か公開勤務からの記録で登録されます。")).toBeInTheDocument();
  expect(screen.getByText("登録済みの実績なし")).toBeInTheDocument();
  expect(panel("履歴")).toHaveTextContent("登録されている実績0件");
  expect(screen.getByText(IMPORT)).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe("correcting a registered actual", () => {
  const CORRECTED = { start: DAY.start, end: "2026-01-05T08:30:01.000Z" };
  const BODY = {
    expected_revision: 1,
    payload: {
      external_id: "clock-1", revision: 2,
      duty: { ...duty(), work: [CORRECTED], breaks: [], start: "2026-01-05T00:00:00.000Z", end: "2026-01-05T08:30:01.000Z" },
      work_terms: { ...TERMS, employment_revision_id: "e1", employment_revision_ids: [], scheduled_work: [DAY] },
      expected_work_terms_revision: 2,
    },
  };
  async function enter() {
    await open(CORRECT);
    set(CORRECT, "訂正する実績", "clock-1");
    set(CORRECT, "実労働1 終了", "2026-01-05T17:30:01");
  }

  test("the task reads what it needs when it is opened, starts from the stored revisions and confirms before it saves", async () => {
    const { calls, refresh } = await mount();
    await open(CORRECT);
    expect(calls).toEqual([{ method: "GET", path: READ, body: undefined }]);
    expect(within(field(CORRECT, "訂正する実績")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "薬剤師一 2026-01-05 09:00（第1版）"]);
    set(CORRECT, "訂正する実績", "clock-1");
    expect(within(task(CORRECT)).getByRole("heading", { level: 3, name: "2. 実労働・休憩・所定労働と雇用条件を入力する" })).toHaveFocus();
    expect(field(CORRECT, "実労働1 開始")).toHaveValue("2026-01-05T09:00");
    expect(field(CORRECT, "所定労働1 終了")).toHaveValue("2026-01-05T17:00");
    // The employment revisions of the duty's own relationship, as registered.
    expect(within(within(task(CORRECT)).getByRole("group", { name: /^適用する雇用条件/ })).getAllByRole("checkbox").map((box) => [(box as HTMLInputElement).labels?.[0].textContent, (box as HTMLInputElement).checked])).toEqual([
      ["2025-04-01 00:00 〜 2026-04-01 00:00", true], ["2026-04-01 00:00 〜 2027-04-01 00:00（フレックスタイム制）", false],
    ]);
    expect(field(CORRECT, "訂正する実績")).toBeDisabled();
    expect(hasUnsavedChanges()).toBe(false);
    set(CORRECT, "実労働1 終了", "2026-01-05T17:30:01");
    expect(hasUnsavedChanges()).toBe(true);
    press(CORRECT, "保存内容を確認する");
    expect(posts(calls)).toEqual([]);
    expect(within(surface(CORRECT)).getByRole("heading", { level: 3, name: "3. 保存前の確認" })).toHaveFocus();
    expect(within(surface(CORRECT)).getAllByRole("term").map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
    expect(changes(CORRECT)).toEqual(["実労働（日本時間）：2026-01-05 09:00 〜 2026-01-05 17:00 → 2026-01-05 09:00 〜 2026-01-05 17:30:01"]);
    expect(line(CORRECT, "作成される版")).toHaveTextContent("第1版 → 第2版");
    expect(line(CORRECT, "通知")).toHaveTextContent(`${NOBODY}保存の記録（操作した役割・時刻）は監査の履歴に残ります。この実績を含む計画は、再検証の対象になります。`);
    expect(line(CORRECT, "競合・部分失敗")).toHaveTextContent("この実績が第1版のままであることと、所定区分の記録が第2版のままであることを照合します。");
    expect(line(CORRECT, "競合・部分失敗")).toHaveTextContent("実績と所定区分は一度に保存し、片方だけが保存されることはありません。");
    await confirm(CORRECT, "この内容で保存する");
    // The body the established screen sent for the same entries (checked against it when
    // this screen replaced it).
    expect(posts(calls)).toEqual([{ method: "POST", path: SAVE, body: { ...BODY, idempotency_key: "idempotency-key-1" } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The task's own records are read again as well.
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(2);
    expect(within(task(CORRECT)).getByRole("status")).toHaveTextContent("実績を第2版として保存し、所定区分も保存しました。この実績を含む計画は、再検証の対象になります。");
    expect(within(task(CORRECT)).getByRole("link", { name: "計画の入力に反映する" })).toHaveAttribute("href", "/workspace/plan/input");
    expect(surface(CORRECT)).toBeNull();
    expect(within(task(CORRECT)).getByRole("heading", { level: 3, name: "1. 訂正する実績を選ぶ" })).toHaveFocus();
    expect(hasUnsavedChanges()).toBe(false);
  });

  test("an unknown outcome sends the identical body again with the same key", async () => {
    let saves = 0;
    const { calls, refresh } = await mount((call) => {
      if (call.method === "GET") return context();
      if (++saves === 1) throw new TypeError("Failed to fetch");
      return { event_id: "event", duplicate: false };
    });
    await enter();
    press(CORRECT, "保存内容を確認する");
    await confirm(CORRECT, "この内容で保存する");
    expect(line(CORRECT, "競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。");
    expect(refresh).not.toHaveBeenCalled();
    await confirm(CORRECT, "同じ内容を再送する");
    expect(posts(calls)).toHaveLength(2);
    expect(JSON.stringify(posts(calls)[1].body)).toBe(JSON.stringify(posts(calls)[0].body));
    expect(posts(calls)[1].body).toEqual({ ...BODY, idempotency_key: "idempotency-key-1" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(CORRECT)).getByRole("status")).toHaveTextContent("実績を第2版として保存し");
  });

  test("a conflict shows the three contents; saving again needs the review and goes against the current revisions", async () => {
    const theirs = actual({ revision: 2, duty: duty({ work: [{ start: DAY.start, end: "2026-01-05T18:00:00+09:00" }], end: "2026-01-05T18:00:00+09:00" }) as never });
    let saves = 0;
    let stored = context();
    const { calls } = await mount((call) => {
      if (call.method === "GET") return stored;
      if (++saves === 1) { stored = context({ actuals: [theirs], records: [{ kind: "work_terms", entity_id: "d1", revision: 3, payload: { ...TERMS, scheduled_work: [] } }] }); throw new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" })); }
      return { event_id: "event", duplicate: false };
    });
    await enter();
    press(CORRECT, "保存内容を確認する");
    await confirm(CORRECT, "この内容で保存する");
    expect(line(CORRECT, "競合・部分失敗")).toHaveTextContent("競合があります。保存していません。");
    expect(surface(CORRECT)).toHaveTextContent("現在の版は第2版です。編集中の内容は保持しています。自動では統合しません。");
    expect(within(within(surface(CORRECT)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").slice(1, 3).map((item) => item.textContent)).toEqual([
      "実労働（日本時間）2026-01-05 09:00 〜 2026-01-05 17:002026-01-05 09:00 〜 2026-01-05 18:002026-01-05 09:00 〜 2026-01-05 17:30:01あり",
      "所定労働（日本時間）2026-01-05 09:00 〜 2026-01-05 17:00なし2026-01-05 09:00 〜 2026-01-05 17:00あり",
    ]);
    expect(within(surface(CORRECT)).getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
    press(CORRECT, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(CORRECT)).toHaveTextContent("現在の第2版との差分に更新しました。内容を確認して、もう一度保存してください。");
    expect(line(CORRECT, "作成される版")).toHaveTextContent("第2版 → 第3版");
    expect(changes(CORRECT)).toEqual([
      "実労働（日本時間）：2026-01-05 09:00 〜 2026-01-05 18:00 → 2026-01-05 09:00 〜 2026-01-05 17:30:01",
      "所定労働（日本時間）：なし → 2026-01-05 09:00 〜 2026-01-05 17:00",
    ]);
    await confirm(CORRECT, "この内容で保存する");
    // The edited content is kept; the revisions are the ones the server holds now.
    expect(posts(calls)[1].body).toEqual({
      expected_revision: 2,
      payload: { ...BODY.payload, revision: 3, duty: { ...theirs.duty, work: BODY.payload.duty.work, breaks: [], start: BODY.payload.duty.start, end: BODY.payload.duty.end }, expected_work_terms_revision: 3 },
      idempotency_key: "idempotency-key-2",
    });
  });

  test("a refusal returns to the fields with the server's own message under a heading that takes focus", async () => {
    let refusal: unknown = { detail: "フレックスタイム制の実績には所定労働区間を付けません。" };
    const { calls, refresh } = await mount((call) => { if (call.method === "GET") return context(); throw new PlanningError(422, JSON.stringify(refusal)); });
    await enter();
    press(CORRECT, "保存内容を確認する");
    await confirm(CORRECT, "この内容で保存する");
    expect(surface(CORRECT)).toBeNull();
    const summary = within(task(CORRECT)).getByRole("region", { name: "サーバーが保存を受け付けませんでした（1件）" });
    expect(within(summary).getByRole("heading", { level: 4 })).toHaveFocus();
    expect(within(summary).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["フレックスタイム制の実績には所定労働区間を付けません。"]);
    // (jsdom writes the seconds of a datetime-local value with their fraction.)
    expect((field(CORRECT, "実労働1 終了") as HTMLInputElement).value).toMatch(/^2026-01-05T17:30:01/);
    expect(refresh).not.toHaveBeenCalled();
    // A refusal that names fields lists each message; a changed entry is a new attempt.
    refusal = { detail: [{ loc: ["body", "payload"], msg: "Field required" }, { loc: ["body", "idempotency_key"], msg: "String should have at least 8 characters" }] };
    press(CORRECT, "保存内容を確認する");
    expect(within(surface(CORRECT)).getByRole("heading", { name: "3. 保存前の確認" })).toHaveFocus();
    await confirm(CORRECT, "この内容で保存する");
    expect(within(within(task(CORRECT)).getByRole("region", { name: "サーバーが保存を受け付けませんでした（2件）" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Field required", "String should have at least 8 characters"]);
    expect(posts(calls).map((call) => (call.body as { idempotency_key: string }).idempotency_key)).toEqual(["idempotency-key-1", "idempotency-key-2"]);
  });

  test("only presence and the order of an interval's ends are checked here, in a summary that takes focus", async () => {
    const { calls } = await mount();
    await open(CORRECT);
    set(CORRECT, "訂正する実績", "clock-1");
    set(CORRECT, "実労働1 終了", "2026-01-05T08:00");
    fireEvent.click(field(CORRECT, "2025-04-01 00:00 〜 2026-04-01 00:00"));
    press(CORRECT, "保存内容を確認する");
    const summary = within(task(CORRECT)).getByRole("region", { name: "入力内容を確認してください（2件）" });
    expect(within(summary).getByRole("heading", { level: 4 })).toHaveFocus();
    expect(within(summary).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["実労働の区間は、終了を開始より後にしてください。", "適用する雇用条件を選んでください。"]);
    fireEvent.click(within(summary).getByRole("button", { name: "適用する雇用条件を選んでください。" }));
    expect(within(task(CORRECT)).getByRole("group", { name: /^適用する雇用条件/ })).toHaveFocus();
    expect(surface(CORRECT)).toBeNull();
    // The same slips again: the summary is read first again.
    press(CORRECT, "保存内容を確認する");
    expect(within(summary).getByRole("heading", { level: 4 })).toHaveFocus();
    press(CORRECT, "実労働1を削除");
    press(CORRECT, "保存内容を確認する");
    expect(within(task(CORRECT)).getByRole("region", { name: "入力内容を確認してください（2件）" })).toHaveTextContent("実労働の区間を1つ以上入力してください。");
    expect(posts(calls)).toEqual([]);
    // Leaving the entry returns to the choice and keeps nothing.
    press(CORRECT, "入力を破棄する");
    expect(field(CORRECT, "訂正する実績")).toHaveValue("");
    expect(within(task(CORRECT)).getByRole("heading", { level: 3, name: "1. 訂正する実績を選ぶ" })).toHaveFocus();
    expect(hasUnsavedChanges()).toBe(false);
  });

  test("an employment revision the server returned as flextime takes no scheduled hours", async () => {
    const { calls } = await mount();
    await open(CORRECT);
    set(CORRECT, "訂正する実績", "clock-1");
    expect(within(task(CORRECT)).getByRole("group", { name: "所定労働（日本時間）" })).toBeInTheDocument();
    fireEvent.click(field(CORRECT, "2026-04-01 00:00 〜 2027-04-01 00:00（フレックスタイム制）"));
    expect(within(task(CORRECT)).queryByRole("group", { name: "所定労働（日本時間）" })).toBeNull();
    expect(task(CORRECT)).toHaveTextContent("選んだ雇用条件はフレックスタイム制として登録されているため、所定労働の区間は記録しません。サーバーは、この雇用条件の実績に所定労働の区間を受け付けません。");
    press(CORRECT, "保存内容を確認する");
    expect(changes(CORRECT)).toEqual([
      "所定労働（日本時間）：2026-01-05 09:00 〜 2026-01-05 17:00 → 記録しません（フレックスタイム制の雇用条件）",
      "適用する雇用条件：2025-04-01 00:00 〜 2026-04-01 00:00 → 2025-04-01 00:00 〜 2026-04-01 00:00 → 2026-04-01 00:00 〜 2027-04-01 00:00（フレックスタイム制）",
    ]);
    await confirm(CORRECT, "この内容で保存する");
    expect((posts(calls)[0].body as typeof BODY).payload.work_terms).toEqual({ ...TERMS, employment_revision_id: "e1", employment_revision_ids: ["e1", "e2"], scheduled_work: [] });
  });
});

test("an actual of a published duty starts from the duty, and its identity is made once", async () => {
  let saves = 0;
  const { calls } = await mount((call) => {
    if (call.method === "GET") return context();
    if (++saves === 1) throw new PlanningError(503, "unavailable");
    return { event_id: "event", duplicate: false };
  });
  await open(FROM_DUTY);
  expect(within(field(FROM_DUTY, "実績を記録する公開勤務")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "2026-01-01 からの計画・公開第3版 薬剤師一 2026-01-05 09:00"]);
  set(FROM_DUTY, "実績を記録する公開勤務", "0:0");
  expect(task(FROM_DUTY)).toHaveTextContent("薬剤師一：新しい実績として記録します。");
  expect(field(FROM_DUTY, "実労働1 終了")).toHaveValue("2026-01-05T17:00");
  expect(field(FROM_DUTY, "所定労働1 開始")).toHaveValue("2026-01-05T09:00");
  fireEvent.click(field(FROM_DUTY, "2025-04-01 00:00 〜 2026-04-01 00:00"));
  press(FROM_DUTY, "休憩を追加");
  // A new interval starts where the last one of its kind ends; here there is none yet.
  set(FROM_DUTY, "休憩1 開始", "2026-01-05T17:00");
  set(FROM_DUTY, "休憩1 終了", "2026-01-05T17:30");
  press(FROM_DUTY, "保存内容を確認する");
  expect(line(FROM_DUTY, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  expect(line(FROM_DUTY, "競合・部分失敗")).toHaveTextContent("この実績がまだ登録されていないことと、所定区分の記録がまだ登録されていないことを照合します。");
  expect(changes(FROM_DUTY)).toEqual([
    "職員：（なし） → 薬剤師一", "業務・場所：（なし） → 日勤・調剤・薬剤部", "実労働（日本時間）：（なし） → 2026-01-05 09:00 〜 2026-01-05 17:00", "休憩（日本時間）：（なし） → 2026-01-05 17:00 〜 2026-01-05 17:30",
    "所定労働（日本時間）：（なし） → 2026-01-05 09:00 〜 2026-01-05 17:00", "適用する雇用条件：（なし） → 2025-04-01 00:00 〜 2026-04-01 00:00",
  ]);
  await confirm(FROM_DUTY, "この内容で保存する");
  await confirm(FROM_DUTY, "同じ内容を再送する");
  const UUID = "00000000-0000-4000-8000-000000000000";
  const body = {
    expected_revision: 0,
    payload: {
      external_id: "manual:pub1:planned-1", revision: 1,
      duty: { ...PLANNED, duty_id: UUID, source: "actual", work: [DAY], breaks: [{ start: "2026-01-05T08:00:00.000Z", end: "2026-01-05T08:30:00.000Z" }], start: "2026-01-05T00:00:00.000Z", end: "2026-01-05T08:30:00.000Z" },
      work_terms: { duty_id: UUID, employment_revision_id: "e1", employment_revision_ids: [], scheduled_work: [DAY], planned_publication_id: "pub1", planned_duty_id: "planned-1" },
      expected_work_terms_revision: 0,
    },
    idempotency_key: "idempotency-key-1",
  };
  expect(posts(calls)).toEqual([{ method: "POST", path: SAVE, body }, { method: "POST", path: SAVE, body }]);
  expect(JSON.stringify(posts(calls)[1].body)).toBe(JSON.stringify(posts(calls)[0].body));
  expect(global.crypto.randomUUID).toHaveBeenCalledTimes(1);
  expect(within(task(FROM_DUTY)).getByRole("status")).toHaveTextContent("実績を第1版として保存し");
  expect(field(FROM_DUTY, "実績を記録する公開勤務")).toHaveValue("");
});

test("a published duty that already has an actual is corrected, not recorded twice", async () => {
  const recorded = actual({ external_id: "manual:pub1:planned-1", revision: 2 });
  const stored = () => context({ actuals: [recorded] });
  const { calls } = await mount(serve(undefined, stored), stored());
  await open(FROM_DUTY);
  set(FROM_DUTY, "実績を記録する公開勤務", "0:0");
  expect(task(FROM_DUTY)).toHaveTextContent("薬剤師一：実績 第2版を訂正します。");
  set(FROM_DUTY, "実労働1 終了", "2026-01-05T16:00");
  press(FROM_DUTY, "保存内容を確認する");
  expect(line(FROM_DUTY, "作成される版")).toHaveTextContent("第2版 → 第3版");
  await confirm(FROM_DUTY, "この内容で保存する");
  // The stored actual keeps its own duty and scheduled hours; no new identity is used.
  expect(posts(calls)[0].body).toEqual({
    expected_revision: 2,
    payload: {
      external_id: "manual:pub1:planned-1", revision: 3,
      duty: { ...duty(), work: [{ start: DAY.start, end: "2026-01-05T07:00:00.000Z" }], start: "2026-01-05T00:00:00.000Z", end: "2026-01-05T07:00:00.000Z" },
      work_terms: { ...TERMS, employment_revision_ids: [] }, expected_work_terms_revision: 2,
    },
    idempotency_key: "idempotency-key-1",
  });
});

test("a plan-less actual is offered for the employment revisions the server returned as flextime, and no hours are proposed", async () => {
  const { calls } = await mount();
  await open(UNPLANNED);
  expect(within(field(UNPLANNED, "実績を記録する雇用条件")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "薬剤師一（2026-04-01 〜 2027-04-01）", "薬剤師二（2025-04-01 〜 2027-04-01）"]);
  expect(within(field(UNPLANNED, "業務・場所")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "日勤・調剤・薬剤部", "遅番・病棟・本館"]);
  set(UNPLANNED, "実績を記録する雇用条件", "e3");
  set(UNPLANNED, "業務・場所", "0");
  press(UNPLANNED, "実績の入力へ進む");
  expect(within(task(UNPLANNED)).getByRole("heading", { level: 3, name: "2. 実労働・休憩・所定労働と雇用条件を入力する" })).toHaveFocus();
  expect(within(task(UNPLANNED)).getByRole("group", { name: "実労働（日本時間）" })).toHaveTextContent("実労働の区間はありません。");
  expect(within(task(UNPLANNED)).queryByRole("group", { name: "所定労働（日本時間）" })).toBeNull();
  expect(field(UNPLANNED, "2025-04-01 00:00 〜 2027-04-01 00:00（フレックスタイム制）")).toBeChecked();
  press(UNPLANNED, "実労働を追加");
  expect(field(UNPLANNED, "実労働1 開始")).toHaveValue("");
  set(UNPLANNED, "実労働1 開始", "2026-01-06T09:00");
  set(UNPLANNED, "実労働1 終了", "2026-01-06T17:00");
  press(UNPLANNED, "保存内容を確認する");
  expect(changes(UNPLANNED)).toEqual([
    "職員：（なし） → 薬剤師二", "業務・場所：（なし） → 日勤・調剤・薬剤部", "実労働（日本時間）：（なし） → 2026-01-06 09:00 〜 2026-01-06 17:00", "休憩（日本時間）：（なし） → なし",
    "所定労働（日本時間）：（なし） → 記録しません（フレックスタイム制の雇用条件）", "適用する雇用条件：（なし） → 2025-04-01 00:00 〜 2027-04-01 00:00（フレックスタイム制）",
  ]);
  await confirm(UNPLANNED, "この内容で保存する");
  const work = [{ start: "2026-01-06T00:00:00.000Z", end: "2026-01-06T08:00:00.000Z" }];
  expect(posts(calls)).toEqual([{ method: "POST", path: SAVE, body: {
    expected_revision: 0,
    payload: {
      external_id: "flex:00000000-0000-4000-8000-000000000000", revision: 1,
      duty: { duty_id: "00000000-0000-4000-8000-000000000001", person_id: "p2", relationship_id: "r2", kind: "日勤", task: "調剤", location: "薬剤部", start: work[0].start, end: work[0].end, work, breaks: [], source: "actual" },
      work_terms: { duty_id: "00000000-0000-4000-8000-000000000001", employment_revision_id: "e3", employment_revision_ids: [], scheduled_work: [] },
      expected_work_terms_revision: 0,
    },
    idempotency_key: "idempotency-key-1",
  } }]);
  expect(field(UNPLANNED, "実績を記録する雇用条件")).toHaveValue("");
});

test("without a flextime employment revision or a duty option nothing is offered for a plan-less actual", async () => {
  const none = await mount(serve(undefined, () => context({ employments: context().employments.slice(0, 1) })));
  await open(UNPLANNED);
  expect(task(UNPLANNED)).toHaveTextContent("フレックスタイム制として登録された雇用条件はありません。");
  expect(within(task(UNPLANNED)).queryByRole("button")).toBeNull();
  expect(posts(none.calls)).toEqual([]);
});

describe("a reconciliation note", () => {
  const BODY = { expected_revision: 1, payload: { external_id: "clock-1", reason: "独立した勤怠原本と照合。差異なし。" } };
  function enter() {
    task(REVIEW).open = true;
    set(REVIEW, "照合する実績", "clock-1");
    set(REVIEW, "照合内容・差異の理由", BODY.payload.reason);
    press(REVIEW, "記録内容を確認する");
  }

  test("a leader reads the actual, writes the note and confirms it against the current revision", async () => {
    const { calls, refresh } = await mount(() => ({ event_id: "event", revision: 1, reviewed: true }), context({ role: "LEADER", can_correct_actuals: false }), "LEADER");
    expect(screen.queryByText(CORRECT)).toBeNull();
    task(REVIEW).open = true;
    expect(within(field(REVIEW, "照合する実績")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "薬剤師一 2026-01-05 09:00（第1版）・照合の記録：未記録"]);
    set(REVIEW, "照合する実績", "clock-1");
    expect(within(task(REVIEW)).getAllByRole("definition").map((item) => item.textContent)).toEqual(["第1版", "2026-01-05 09:00 〜 2026-01-05 17:00", "なし"]);
    set(REVIEW, "照合内容・差異の理由", BODY.payload.reason);
    expect(hasUnsavedChanges()).toBe(true);
    press(REVIEW, "記録内容を確認する");
    expect(calls).toEqual([]);
    expect(within(surface(REVIEW)).getByRole("heading", { level: 3, name: "3. 記録前の確認" })).toHaveFocus();
    expect(changes(REVIEW)).toEqual(["照合の記録：未記録 → 第1版に対する記録を1件追加", `照合内容・差異の理由：（なし） → ${BODY.payload.reason}`]);
    expect(line(REVIEW, "作成される版")).toHaveTextContent("実績は第1版のままです。照合の記録を1件追加します。");
    expect(line(REVIEW, "通知")).toHaveTextContent(`${NOBODY}照合の記録（対象の版・操作した役割・時刻）は監査の履歴に残ります。理由の本文はサーバーに保存されますが、この画面と監査の履歴の一覧には表示されません。`);
    expect(line(REVIEW, "競合・部分失敗")).toHaveTextContent("記録時にサーバーが、この実績が第1版のままであることを照合します。");
    await confirm(REVIEW, "この照合内容を記録する");
    expect(calls).toEqual([{ method: "POST", path: NOTE, body: { ...BODY, idempotency_key: "idempotency-key-1" } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(REVIEW)).getByRole("status")).toHaveTextContent("照合内容を、実績の第1版に対して記録しました。");
    expect(within(task(REVIEW)).getByRole("heading", { level: 3, name: "1. 照合する実績を選ぶ" })).toHaveFocus();
    expect(hasUnsavedChanges()).toBe(false);
  });

  test("an unknown outcome resends the identical note; the next read shows it as recorded", async () => {
    let sends = 0;
    const { calls, show } = await mount(() => { if (++sends === 1) throw new PlanningError(502, "bad gateway"); return { event_id: "event", revision: 1, reviewed: true }; });
    enter();
    await confirm(REVIEW, "この照合内容を記録する");
    expect(line(REVIEW, "競合・部分失敗")).toHaveTextContent("結果を確認できません。");
    await confirm(REVIEW, "同じ内容を再送する");
    expect(posts(calls)).toEqual([1, 2].map(() => ({ method: "POST", path: NOTE, body: { ...BODY, idempotency_key: "idempotency-key-1" } })));
    show(context({ actuals: [actual({ reviewed: true })] }));
    expect(screen.getByRole("region", { name: "登録済みの実績" })).toHaveTextContent("第1版現在の版に記録あり");
    expect(screen.getByText("すべての実績に照合の記録あり")).toBeInTheDocument();
  });

  test("an actual that changed is compared before the note is recorded against its current revision", async () => {
    const theirs = actual({ revision: 2, duty: duty({ work: [{ start: DAY.start, end: "2026-01-05T18:00:00+09:00" }] }) as never });
    let sends = 0;
    const { calls } = await mount((call) => {
      if (call.method === "GET") return context({ actuals: [theirs] });
      if (++sends === 1) throw new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" }));
      return { event_id: "event", revision: 2, reviewed: true };
    });
    enter();
    await confirm(REVIEW, "この照合内容を記録する");
    expect(within(within(surface(REVIEW)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").slice(1, 3).map((item) => item.textContent)).toEqual([
      "実績の版第1版第2版第1版あり", "実労働（日本時間）2026-01-05 09:00 〜 2026-01-05 17:002026-01-05 09:00 〜 2026-01-05 18:002026-01-05 09:00 〜 2026-01-05 17:00あり",
    ]);
    press(REVIEW, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(REVIEW)).toHaveTextContent("現在の第2版に対する記録として確認し直します。");
    await confirm(REVIEW, "この照合内容を記録する");
    expect(posts(calls)[1].body).toEqual({ expected_revision: 2, payload: BODY.payload, idempotency_key: "idempotency-key-2" });
    expect(within(task(REVIEW)).getByRole("status")).toHaveTextContent("照合内容を、実績の第2版に対して記録しました。");
  });

  test("the server's refusal is shown in its own words and nothing is recorded", async () => {
    const { refresh } = await mount(() => { throw new PlanningError(422, JSON.stringify({ detail: "照合内容を記録してください。" })); });
    enter();
    await confirm(REVIEW, "この照合内容を記録する");
    expect(line(REVIEW, "競合・部分失敗")).toHaveTextContent("保存していません。サーバーが下の理由で受け付けませんでした。");
    expect(surface(REVIEW)).toHaveTextContent("照合内容を記録してください。");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("importing a source file", () => {
  const SOURCE = JSON.stringify({ format: "pharmshift-actuals-v1", events: [{ external_id: "clock-1", revision: 2, duty: duty(), work_terms: TERMS }] });
  const PREVIEWED = { source_hash: "s".repeat(64), preview_hash: "h".repeat(64), rows: [{ row: 1, external_id: "clock-1", expected_revision: 1, expected_work_terms_revision: 2, person_id: "p1", start: "2026-01-05T09:00:00+09:00", end: "2026-01-05T17:00:00+09:00" }] };
  const file = (text: string, name = "actuals.json") => new File([text], name, { type: "application/json" });
  /** Chooses the file and waits until the browser has read it. */
  const choose = async (value: File) => { await act(async () => { fireEvent.change(field(IMPORT, "実績原本ファイル"), { target: { files: [value] } }); await new Promise((resolve) => setTimeout(resolve, 20)); }); };
  const BODY = { expected_revision: 0, payload: { source_text: SOURCE, preview_hash: PREVIEWED.preview_hash } };

  test("the server finds the row errors; a clean file is confirmed and saved as a whole", async () => {
    const logged = (["log", "info", "warn", "error", "debug"] as const).map((level) => jest.spyOn(console, level).mockImplementation(() => undefined));
    let previews = 0;
    const { calls, refresh } = await mount((call) => {
      if (call.path === PREVIEW && ++previews === 1) throw new PlanningError(422, JSON.stringify({ detail: { message: "実績原本にエラーがあります。保存せず、全行を確認してください。", row_errors: [{ row: 1, code: "shape", message: "実績と所定内外区分の対応が必要です。" }, { row: 2, code: "validation", message: "形式・日時・所定区分を確認してください。" }] } }));
      return call.path === PREVIEW ? PREVIEWED : { source_hash: PREVIEWED.source_hash, count: 1, results: [] };
    });
    task(IMPORT).open = true;
    expect(within(task(IMPORT)).getByRole("button", { name: "原本と保存済み実績を照合する" })).toBeDisabled();
    expect(within(task(IMPORT)).getByRole("button", { name: "原本と保存済み実績を照合する" })).toHaveAccessibleDescription("実績原本ファイルを選ぶと押せます。");
    const invalid = JSON.stringify({ format: "pharmshift-actuals-v1", events: [{}, {}] });
    await choose(file(invalid, "invalid.json"));
    expect(within(task(IMPORT)).getByRole("button", { name: "原本と保存済み実績を照合する" })).not.toHaveAttribute("aria-describedby");
    expect(task(IMPORT)).toHaveTextContent("選んだ原本：invalid.json");
    expect(hasUnsavedChanges()).toBe(true);
    await confirm(IMPORT, "原本と保存済み実績を照合する");
    expect(calls).toEqual([{ method: "POST", path: PREVIEW, body: { source_text: invalid } }]);
    expect(task(IMPORT)).toHaveTextContent("実績原本にエラーがあります。保存せず、全行を確認してください。");
    expect(within(within(task(IMPORT)).getByRole("list", { name: "実績原本の行別エラー" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1行目：実績と所定内外区分の対応が必要です。", "2行目：形式・日時・所定区分を確認してください。"]);
    expect(surface(IMPORT)).toBeNull();
    // Another file replaces the first without a dialog.
    await choose(file(SOURCE));
    expect(within(task(IMPORT)).queryByRole("list", { name: "実績原本の行別エラー" })).toBeNull();
    await confirm(IMPORT, "原本と保存済み実績を照合する");
    expect(calls[1]).toEqual({ method: "POST", path: PREVIEW, body: { source_text: SOURCE } });
    expect(within(surface(IMPORT)).getByRole("heading", { level: 3, name: "2. 取込前の確認" })).toHaveFocus();
    expect(within(surface(IMPORT)).getAllByRole("term").filter((term) => !term.closest(".ideal-v3-identifiers")).map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
    expect(changes(IMPORT)).toEqual(["1行目 薬剤師一 2026-01-05 09:00 〜 2026-01-05 17:00：第1版 → 第2版"]);
    expect(line(IMPORT, "作成される版")).toHaveTextContent("実績 1件のそれぞれに、上の「変更内容」の版を作成します。行ごとの所定区分の記録も保存します。");
    expect(line(IMPORT, "通知")).toHaveTextContent(`${NOBODY}取込の記録（件数・原本の照合値・操作した役割・時刻）は監査の履歴に残ります。`);
    expect(line(IMPORT, "競合・部分失敗")).toHaveTextContent("全件を保存するか、1件も保存しないかのどちらかで、一部だけが保存されることはありません。");
    expect(field(IMPORT, "実績原本ファイル")).toBeDisabled();
    expect(calls).toHaveLength(2);
    await confirm(IMPORT, "この内容で取り込む");
    // The body the established screen sent for the same file and preview.
    expect(calls[2]).toEqual({ method: "POST", path: COMMIT, body: { ...BODY, idempotency_key: "idempotency-key-1" } });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(IMPORT)).getByRole("status")).toHaveTextContent("1件を保存しました。取り込んだ実績を含む計画は、再検証の対象になります。");
    expect(surface(IMPORT)).toBeNull();
    expect(task(IMPORT)).not.toHaveTextContent("選んだ原本");
    expect(hasUnsavedChanges()).toBe(false);
    // The file's content is never written to a log.
    for (const spy of logged) expect(JSON.stringify(spy.mock.calls)).not.toContain("pharmshift-actuals-v1");
  });

  test("after a lost response the identical body is sent again, with the same key", async () => {
    let commits = 0;
    const { calls, refresh } = await mount((call) => {
      if (call.path === PREVIEW) return PREVIEWED;
      if (++commits === 1) throw new TypeError("Failed to fetch");
      return { source_hash: PREVIEWED.source_hash, count: 1, results: [] };
    });
    task(IMPORT).open = true;
    await choose(file(SOURCE));
    await confirm(IMPORT, "原本と保存済み実績を照合する");
    await confirm(IMPORT, "この内容で取り込む");
    expect(line(IMPORT, "競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます");
    expect(refresh).not.toHaveBeenCalled();
    await confirm(IMPORT, "同じ内容を再送する");
    const commitsSent = calls.filter((call) => call.path === COMMIT);
    expect(commitsSent).toHaveLength(2);
    expect(JSON.stringify(commitsSent[1].body)).toBe(JSON.stringify(commitsSent[0].body));
    expect(commitsSent[1].body).toEqual({ ...BODY, idempotency_key: "idempotency-key-1" });
    expect(within(task(IMPORT)).getByRole("status")).toHaveTextContent("1件を保存しました。");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("when the stored actuals changed, the same file is checked again and confirmed against what is stored now", async () => {
    const now = { ...PREVIEWED, preview_hash: "n".repeat(64), rows: [{ ...PREVIEWED.rows[0], expected_revision: 2 }] };
    let previews = 0;
    let commits = 0;
    const { calls } = await mount((call) => {
      if (call.path === PREVIEW) return ++previews === 1 ? PREVIEWED : now;
      if (++commits === 1) throw new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" }));
      return { source_hash: PREVIEWED.source_hash, count: 1, results: [] };
    });
    task(IMPORT).open = true;
    await choose(file(SOURCE));
    await confirm(IMPORT, "原本と保存済み実績を照合する");
    await confirm(IMPORT, "この内容で取り込む");
    expect(calls.map((call) => call.path)).toEqual([PREVIEW, COMMIT, PREVIEW]);
    expect(surface(IMPORT)).toHaveTextContent("保存済みの実績が、照合した後に変わりました。同じ原本を現在の保存内容と照合し直した結果を「現在」に示します。編集中の内容は保持しています。");
    expect(within(within(surface(IMPORT)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("保存済み 第1版 → 取込後 第2版保存済み 第2版 → 取込後 第3版保存済み 第1版 → 取込後 第2版あり");
    expect(within(surface(IMPORT)).getByRole("button", { name: "この内容で取り込む" })).toBeDisabled();
    press(IMPORT, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(changes(IMPORT)).toEqual(["1行目 薬剤師一 2026-01-05 09:00 〜 2026-01-05 17:00：第2版 → 第3版"]);
    await confirm(IMPORT, "この内容で取り込む");
    expect(calls[3]).toEqual({ method: "POST", path: COMMIT, body: { expected_revision: 0, payload: { source_text: SOURCE, preview_hash: now.preview_hash }, idempotency_key: "idempotency-key-2" } });
  });

  test("the browser only checks the size and the encoding of the file", async () => {
    const { calls } = await mount();
    task(IMPORT).open = true;
    const large = file("{}");
    Object.defineProperty(large, "size", { value: 2_000_001 });
    await choose(large);
    expect(within(task(IMPORT)).getByRole("alert")).toHaveTextContent("原本は2MB以内にしてください。");
    await choose(new File([new Uint8Array([0xff, 0xfe, 0xfd])], "latin.json"));
    expect(within(task(IMPORT)).getByRole("alert")).toHaveTextContent("UTF-8の原本を読み込めませんでした。");
    expect(within(task(IMPORT)).getByRole("button", { name: "原本と保存済み実績を照合する" })).toBeDisabled();
    await choose(file("not json"));
    press(IMPORT, "取込をやめる");
    expect(task(IMPORT)).not.toHaveTextContent("選んだ原本");
    expect(hasUnsavedChanges()).toBe(false);
    expect(calls).toEqual([]);
  });

  test("a check that got no answer changed nothing and says so", async () => {
    await mount(() => { throw new TypeError("Failed to fetch"); });
    task(IMPORT).open = true;
    await choose(file(SOURCE));
    await confirm(IMPORT, "原本と保存済み実績を照合する");
    expect(task(IMPORT)).toHaveTextContent("読み込めませんでした");
    expect(task(IMPORT)).toHaveTextContent("何も変更されていません。");
    expect(surface(IMPORT)).toBeNull();
  });
});

test("row errors are read from the server's answer only", () => {
  expect(rowErrorsOf(new PlanningError(422, JSON.stringify({ detail: { message: "x", row_errors: [{ row: 3, code: "domain", message: "確認してください。" }, { row: "4" }] } })))).toEqual([{ row: 3, code: "domain", message: "確認してください。" }]);
  expect(rowErrorsOf(new PlanningError(422, JSON.stringify({ detail: "文字列の理由" })))).toEqual([]);
  expect(rowErrorsOf(new TypeError("Failed to fetch"))).toEqual([]);
});

// The route arrives as server HTML. Its tasks have no field until React attaches, so
// nothing can be typed or chosen in a form that could not keep it.
describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("the server HTML holds the state and the closed tasks without fields; tasks opened there stay open, get their form and read what they need", async () => {
    const { node, calls } = tree(serve(), "ADMIN");
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node(actualsOf(context())));
    expect(container.innerHTML).toContain("登録済みの実績");
    expect(container.innerHTML).toContain(IMPORT);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    const review = within(container).getByText(REVIEW).closest("details")!;
    const correct = within(container).getByText(CORRECT).closest("details")!;
    review.open = true; correct.open = true;
    await act(async () => { root = hydrateRoot(container, node(actualsOf(context()))); });
    expect(review.open).toBe(true);
    expect(within(review).getByLabelText("照合する実績")).toBeVisible();
    expect(await within(correct).findByLabelText("訂正する実績")).toBeVisible();
    expect(within(container).getByText(IMPORT).closest("details")!.querySelector("input[type=file]")).not.toBeNull();
    expect(calls.map((call) => call.path)).toEqual([READ]);
  });
});
