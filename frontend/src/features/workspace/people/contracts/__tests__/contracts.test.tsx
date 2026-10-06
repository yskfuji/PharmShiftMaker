import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { hasUnsavedChanges } from "../../../shared/useUnsavedNavigation";
import { readRoute, type RouteContext } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { RosterContext } from "../../api";
import ImpactList from "../editors/ImpactList";
import { rosterOf, type Roster } from "../model";
import route from "../route";
import * as B from "../__fixtures__/bodies";
import * as F from "../__fixtures__/context";
import { TYPED, shownTimes, unmarked } from "../../../shared/__fixtures__/typed";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

// The forms of this route are the largest of the workspace: one test fills up to forty
// fields, each found by its label or role in the whole document, and takes one to two
// seconds on an idle machine (the longest are "a new contract" and "a new flextime
// employment"). On a machine busy with other runs that came close to Jest's five seconds
// for one test, and three runs failed there. Nothing in these tests waits or retries: the
// budget is the only thing that is widened.
jest.setTimeout(30_000);

beforeEach(() => { Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => F.UUID) }); });
afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const READ = `/compliance/workflow-context?${SCOPE}`;
const NOTICE = "誰にも通知されません。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。";
const roster = (over: Partial<typeof F.CONTEXT> = {}): Roster => rosterOf({ ...F.CONTEXT, ...over } as unknown as RosterContext);

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
function tree(answer: (call: Call) => unknown, over: Partial<RouteContext> = {}) {
  const ctx = { ...syntheticContext("ADMIN"), ...over };
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  let keys = 0;
  const live = liveFrom(ctx, { client, mutate: createMutator("test", () => `idempotency-key-${++keys}`), refresh });
  const View = route.View;
  return { calls, refresh, node: (value: Roster) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider> };
}
/** Answers a save with `done`, a rule's impact and the context from the fixtures. */
const serve = (done: unknown = { key: "k", revision: 1, kind: "x" }) => (call: Call): unknown =>
  (call.method !== "GET" ? done : call.path.startsWith("/compliance/rule-impact/") ? F.IMPACT : F.CONTEXT);
async function mount(value: Roster = roster(), answer: (call: Call) => unknown = serve(), over: Partial<RouteContext> = {}) {
  const { node, ...rest } = tree(answer, over);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node(value)); });
  return { ...rest, view, show: (next: Roster) => view.rerender(node(next)) };
}

const task = (summary: string) => screen.getByText(summary, { selector: "summary" }).closest("details")!;
const open = (summary: string) => { task(summary).open = true; return task(summary); };
const field = (summary: string, label: string) => within(task(summary)).getByLabelText(label);
const set = (summary: string, label: string, value: string) => fireEvent.change(field(summary, label), { target: { value } });
const tick = (summary: string, label: string) => fireEvent.click(field(summary, label));
const group = (summary: string, name: string) => within(within(task(summary)).getByRole("group", { name }));
const press = (summary: string, name: string) => fireEvent.click(within(task(summary)).getByRole("button", { name }));
const review = async (summary: string) => { await act(async () => { press(summary, "保存内容を確認する"); }); };
const confirm = async (summary: string, name = "この内容で保存する") => { await act(async () => { press(summary, name); }); };
const surface = (summary: string) => task(summary).querySelector(".ideal-confirm") as HTMLElement;
const line = (summary: string, term: string) => within(surface(summary)).getByText(term, { selector: "dt" }).parentElement!;
const changes = (summary: string) => within(line(summary, "変更内容")).getAllByRole("listitem").map((item) => item.textContent);
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");
const gets = (calls: Call[]) => calls.filter((call) => call.method === "GET").map((call) => call.path);
const sent = (calls: Call[], index = 0) => { const { idempotency_key: key, ...body } = posts(calls)[index].body as Record<string, unknown>; expect(key).toEqual(expect.any(String)); return { path: posts(calls)[index].path.split("?")[0], body }; };
const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const rows = (name: string) => within(screen.getByRole("region", { name })).getAllByRole("row").slice(1).map((row) => row.textContent);
const counts = (name: string) => Array.from(screen.getByLabelText(name).querySelectorAll(":scope > div")).map((line) => line.textContent);
const stepItems = () => within(screen.getByRole("list", { name: "新しい職員を追加する手順" })).getAllByRole("listitem");
/** Each step as its title and what it says of its record. */
const steps = () => stepItems().map((item) => `${item.querySelector("strong")!.textContent}：${item.querySelector(".ideal-pill")!.textContent}`);
const choose = (name: RegExp) => fireEvent.click(within(screen.getByRole("list", { name: "職員一覧" })).getByRole("button", { name }));
const evidence = (summary: string, name = "原本確認") => { set(summary, `${name}の資料名・参照先`, "合成の原本"); set(summary, `${name}の状態`, "verified"); set(summary, `${name}の確認責任者`, "確認者"); };
const period = (summary: string, start = "2026-04-01T00:00", end = "2028-04-01T00:00") => { set(summary, "適用開始（日本時間）", start); set(summary, "適用終了（日本時間）", end); };

const T = {
  person: "職員を登録・氏名を訂正する", employment: "雇用関係を登録・改定する", contract: "契約を登録・改定する", capability: "資格・監督条件を登録する", amendment: "資格の取消・失効を記録する",
  employer: "雇用主を登録・変更する", site: "事業場を登録・変更する", model: "兼業の管理モデルを登録・変更する",
  agreement: "36協定を登録・変更する", review: "規則の適用確認を登録・変更する", decision: "改定規則の公開判断を記録する", transition: "制度切替の集計条件を登録・変更する",
  attribution: "事業場間の時間外の帰属の判断を登録・変更する", calendar: "1年単位の変形労働時間制のカレンダーを登録・変更する",
} as const;

test("the route reads the workflow context once and keeps only what it shows", async () => {
  const { calls, client } = api(() => F.CONTEXT);
  const state = await readRoute(route, client, syntheticContext("ADMIN"));
  expect(calls).toEqual([{ method: "GET", path: READ, body: undefined }]);
  expect(route.names).toBe("roster");
  expect(state).toEqual({ kind: "ready", partial: [], data: roster() });
  // What the endpoint returns for other screens is not kept.
  const kept = JSON.stringify((state as { data: Roster }).data);
  for (const other of ["leave_account", "g1", "pub1", "actual-1", "d1", "input_hash", "can_correct_actuals"]) expect(kept).not.toContain(other);
  expect(Object.keys((state as { data: Roster }).data).sort()).toEqual([
    "accountingTransitions", "agreements", "annualCalendars", "capabilities", "capabilityAmendments", "capabilityTargets", "contracts", "duties", "employerIds", "employers", "employments",
    "establishments", "managementModels", "people", "ruleDecisions", "ruleReviews", "ruleRevision", "siteDecisions", "staging",
  ]);
  // Without a reconciled input the server refuses the read: that is the route's problem.
  const refused = api(() => { throw new PlanningError(409, "版2の確認済み入力が必要です。旧版の不足情報を推測して変換しません。"); });
  expect(await readRoute(route, refused.client, syntheticContext("ADMIN"))).toEqual({ kind: "problem", status: 409, detail: "版2の確認済み入力が必要です。旧版の不足情報を推測して変換しません。" });
});

test("each staged value carries the revision of its saved record; a qualification is found by its content", () => {
  const value = roster({ capabilities: [F.CAPABILITY, { ...F.CAPABILITY, end: "2026-06-01T00:00:00+09:00" }], employers: [F.EMPLOYER], contracts: [F.CONTRACT, { ...F.CONTRACT, revision_id: "c-input", employer_id: "agency" }] });
  expect(value.contracts.map((item) => [item.key, item.revision])).toEqual([["c1", 2], ["c-input", 0]]);
  // The staged period a withdrawal shortened has no record of its own; the original has.
  expect(value.capabilities.map((item) => [item.key, item.revision])).toEqual([[F.CAPABILITY_HASH, 1], ["staged:1", 0]]);
  expect(value.capabilityTargets).toEqual([{ key: F.CAPABILITY_HASH, revision: 1, payload: F.CAPABILITY }]);
  // An employer registered by name, one only saved, and one that records only name by its identifier.
  expect(value.employers.map((item) => [item.key, item.revision])).toEqual([["hospital", 1], ["clinic", 1]]);
  expect(value.employerIds).toEqual(["hospital", "clinic", "agency"]);
});

test("first the current state, the next step and the history; no form is open and nothing is read", async () => {
  const { calls, view } = await mount();
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["記録の状態と次の操作", "現在の状態", "次の操作", "履歴"]);
  expect(within(panel("現在の状態")).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["記録の検証結果", "職員ごとの記録", "契約と適用期間", "施設の記録", "規則・協定・判断"]);
  expect(within(panel("次の操作")).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["新しい職員を追加する手順", "職員の記録を登録・改定する", "施設の記録を登録・変更する", "規則・協定・判断を登録・変更する"]);
  expect(screen.getByText("記録の検証：不整合なし")).toBeInTheDocument();
  expect(panel("現在の状態")).toHaveTextContent("システムによる検証で、編集中の記録に不整合は見つかっていません。");
  // The contract overview: each contract with its regime and the state of each piece of evidence, as registered.
  expect(within(screen.getByRole("region", { name: "この部署の契約の一覧" })).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["職員", "雇用", "勤務区分", "制度", "適用期間（日本時間）", "原本確認", "制度の根拠", "版"]);
  expect(rows("この部署の契約の一覧")).toEqual(["合成 一直接雇用常勤一般制2026-01-01 00:00 〜 2028-01-01 00:00確認済み未確認第2版"]);
  expect(rows("登録されている雇用主")).toEqual(["合成病院確認済み第1版", "合成診療所確認済み第1版"]);
  expect(rows("登録されている事業場")).toEqual(["合成病院2026-01-01 00:00 〜 2029-01-01 00:00確認済み第1版", "合成診療所2026-01-01 00:00 〜 2029-01-01 00:00確認済み第1版"]);
  // Names are shown; the identifiers stay available, folded away.
  expect(Array.from(screen.getByText("雇用主・事業場の識別情報").closest("details")!.querySelectorAll(".ideal-v3-identifiers > div")).map((item) => item.textContent)).toEqual([
    "雇用主（合成病院）：hospital", "雇用主（合成診療所）：clinic", "事業場（合成病院の事業場（2026-01-01 00:00 〜 2029-01-01 00:00））：site1", "事業場（合成診療所の事業場（2026-01-01 00:00 〜 2029-01-01 00:00））：site2",
  ]);
  expect(screen.getByText("雇用主・事業場の識別情報").closest("details")!.open).toBe(false);
  // A site is named by its employer; its own period is not repeated before the row's period.
  expect(rows("登録されている36協定")).toEqual(["合成病院の事業場2026-01-01 00:00 〜 2029-01-01 00:00ない確認済み第1版"]);
  expect(rows("登録されている規則の適用確認")).toEqual(["r-2026 合成の条項2026-01-01 00:00 〜 2029-01-01 00:002026-04-01・2027-04-01記録あり確認済み第1版"]);
  expect(rows("登録されている年間カレンダー")).toEqual(["合成病院の事業場2026-04-01 〜 2027-04-011日0件確認済み第1版"]);
  for (const text of ["登録されている兼業の管理モデルはありません。", "登録されている公開判断はありません。", "登録されている制度切替の集計条件はありません。", "登録されている帰属の判断はありません。"]) expect(panel("現在の状態")).toHaveTextContent(text);
  // Each group says how many records of each kind the server returned; the kinds without one are one list, not a heading each.
  expect(counts("施設の記録の件数")).toEqual(["雇用主2件", "事業場2件", "兼業の管理モデル未登録"]);
  expect(counts("規則・協定・判断の件数")).toEqual(["36協定1件", "規則の適用確認1件", "改定規則の公開判断未登録", "制度切替の集計条件未登録", "事業場間の時間外の帰属の判断未登録", "1年単位の変形労働時間制のカレンダー1件"]);
  expect(within(screen.getByRole("list", { name: "施設の記録のうち未登録の項目" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["登録されている兼業の管理モデルはありません。"]);
  expect(within(screen.getByRole("list", { name: "規則・協定・判断のうち未登録の項目" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["登録されている公開判断はありません。", "登録されている制度切替の集計条件はありません。", "登録されている帰属の判断はありません。"]);
  expect(within(panel("現在の状態")).getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual(["雇用主", "事業場", "未登録の項目", "36協定", "規則の適用確認", "1年単位の変形労働時間制のカレンダー", "未登録の項目"]);
  // The tables of a group are in one reveal, closed at first; the contract overview is not in one.
  expect(Array.from(panel("現在の状態").querySelectorAll("details > summary")).map((summary) => summary.textContent)).toEqual(["施設の記録を表で見る（4件）", "雇用主・事業場の識別情報", "規則・協定・判断を表で見る（3件）"]);
  expect(Array.from(panel("現在の状態").querySelectorAll("details")).map((details) => details.open)).toEqual([false, false, false]);
  expect(screen.getByRole("region", { name: "この部署の契約の一覧" }).closest("details")).toBeNull();
  // Nobody is chosen: the list of people, and what choosing one does.
  expect(within(screen.getByRole("list", { name: "職員一覧" })).getAllByRole("button").map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([["合合成 一雇用関係 3件・契約 1件・資格 1件", "false"], ["合合成 二雇用関係 0件・契約 0件・資格 0件", "false"]]);
  expect(panel("現在の状態")).toHaveTextContent("職員を選ぶと、その職員の雇用関係・契約・資格を表示し、「次の操作」の手順と記録をその職員に絞ります。");
  // Fourteen tasks, one per record kind, all closed.
  expect(Array.from(panel("次の操作").querySelectorAll(".ideal-v3-task > details > summary")).map((summary) => summary.textContent)).toEqual(Object.values(T));
  for (const summary of Object.values(T)) expect(task(summary).open).toBe(false);
  expect(within(task(T.contract)).getByLabelText("編集する対象")).not.toBeVisible();
  // The history: the current versions, that earlier ones cannot be read here, and the audit history.
  expect(panel("履歴")).toHaveTextContent("この画面に表示しているのは、各記録の現在の版です。いつ・どの役割が記録を変更したかは、この画面には表示されません。監査の履歴で確認できます。");
  expect(panel("履歴")).toHaveTextContent("以前の版保存のたびに記録の版が1つ進み、以前の版は上書きされずにサーバーに残ります。以前の版の内容は、この画面には表示されません。");
  expect(panel("履歴")).toHaveTextContent("登録されている記録14件（最も新しい版は第2版）");
  expect(within(panel("履歴")).getByRole("link", { name: "監査の履歴を開く" })).toHaveAttribute("href", "/workspace/governance/audit");
  expect(rows("すべての記録の現在の版")).toHaveLength(14);
  expect(rows("すべての記録の現在の版")[5]).toBe("合成 一・合成病院 2026-01-01 00:00 〜 2028-01-01 00:00契約第2版");
  // Every link stays inside the workspace; only the workspace's own class families are used.
  expect(Array.from(view.container.querySelectorAll("a")).map((link) => link.getAttribute("href")).sort()).toEqual(["/workspace/governance/audit", "/workspace/plan/input", "/workspace/plan/input"]);
  const classes = Array.from(view.container.querySelectorAll("[class]")).flatMap((element) => Array.from(element.classList));
  // `sr-only` is the one name outside the workspace's own (the colon read after an identifier's label).
  expect(classes.filter((name) => !/^(ideal-|is-|lucide|sr-only$)/.test(name))).toEqual([]);
  expect(classes).not.toContain("ideal-v3-purpose");
  expect(calls).toEqual([]);
});

test("an employer whose name is not registered is said so, and told apart from another one", async () => {
  await mount(roster({ employers: [], records: F.RECORDS.filter((row) => row.kind !== "employer") }));
  expect(panel("現在の状態")).toHaveTextContent("名称を登録した雇用主はありません。");
  expect(rows("登録されている事業場").map((text) => text?.slice(0, 13))).toEqual(["名称未登録の雇用主（1）2", "名称未登録の雇用主（2）2"]);
  expect(rows("この部署の契約の一覧")[0]).not.toContain("hospital");
  expect(Array.from(screen.getByText("雇用主・事業場の識別情報").closest("details")!.querySelectorAll(".ideal-v3-identifiers > div")).slice(0, 2).map((item) => item.textContent)).toEqual(["雇用主（名称未登録の雇用主（1））：hospital", "雇用主（名称未登録の雇用主（2））：clinic"]);
});

test("the server's staging issues are shown as it reports them", async () => {
  await mount(roster({ staging_valid: false, validation_issues: [{ location: ["accounting_transitions", 0], message: "Value error, Accounting transition requires adjacent revisions of the same relationship and site", type: "value_error" }] }));
  expect(screen.getByText("記録の検証：不整合 1件")).toBeInTheDocument();
  const alert = within(panel("現在の状態")).getByRole("alert");
  expect(alert).toHaveTextContent("編集中の記録に不整合があります");
  expect(within(alert).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["accounting_transitions / 0：Value error, Accounting transition requires adjacent revisions of the same relationship and site"]);
  // The records can still be corrected.
  expect(task(T.transition)).toBeInTheDocument();
});

test("the header leads to the server's result when it found something; the row under it goes to each section", async () => {
  Element.prototype.scrollIntoView = jest.fn();
  const invalid = await mount(roster({ staging_valid: false, validation_issues: [{ location: ["contracts", 0], message: "合成の不整合", type: "value_error" }] }));
  fireEvent.click(screen.getByRole("button", { name: "検証結果を見る" }));
  expect(screen.getByRole("heading", { level: 3, name: "記録の検証結果" })).toHaveFocus();
  // The sections are reached by buttons of the page, never by links; each says what its section holds.
  const sections = within(screen.getByRole("navigation", { name: "この画面の内容" }));
  expect(sections.getAllByRole("button").map((button) => button.textContent)).toEqual(["現在の状態 職員2名（保存済み2名）・契約1件", "次の操作 新しい職員の手順・操作14件", "履歴 現在の版と監査の履歴"]);
  expect(sections.queryAllByRole("link")).toEqual([]);
  for (const name of ["現在の状態", "次の操作", "履歴"]) {
    fireEvent.click(sections.getByRole("button", { name: new RegExp(`^${name} `) }));
    expect(screen.getByRole("heading", { level: 2, name })).toHaveFocus();
  }
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(4);
  // No label of the row is the text of a task's summary, which the journeys find by exact text.
  for (const button of sections.getAllByRole("button")) expect(Object.values(T)).not.toContain(button.textContent);
  invalid.view.unmount();
  // Nothing found: there is no result to lead to.
  await mount();
  expect(screen.queryByRole("button", { name: "検証結果を見る" })).toBeNull();
});

test("a site is told from another site of the same employer by its period, and only then", async () => {
  const second = { ...F.SITE, establishment_id: "site3", start: "2029-01-01T00:00:00+09:00", end: "2031-01-01T00:00:00+09:00" };
  await mount(roster({ establishments: [F.SITE, F.SITE2, second], records: [...F.RECORDS, { kind: "establishment", key: "k-establishment-site3", entity_id: "site3", revision: 1, payload: second }] }));
  expect(rows("登録されている36協定")).toEqual(["合成病院の事業場（2026-01-01 00:00 〜 2029-01-01 00:00）2026-01-01 00:00 〜 2029-01-01 00:00ない確認済み第1版"]);
  choose(/合成 一/);
  expect(rows("合成 一の雇用関係").map((text) => text?.slice(0, 13))).toEqual(["合成病院の事業場（2026", "合成病院の事業場（2026", "合成診療所の事業場2026"]);
});

test("every task says in one line what it records, beside its summary and not in it", async () => {
  await mount();
  const hints = Object.values(T).map((summary) => { const described = screen.getByText(summary, { selector: "summary" }).getAttribute("aria-describedby")!; return document.getElementById(described)!.textContent!; });
  expect(new Set(hints).size).toBe(14);
  for (const hint of hints) { expect(hint).toMatch(/記録します|登録します/); expect(Object.values(T)).not.toContain(hint); }
  // The withdrawal or expiry of a qualification adds a record and removes none: an ordinary task, and its line says so.
  const amendment = task(T.amendment).closest(".ideal-v3-task")!;
  expect(amendment).toHaveClass("ideal-v3-task--routine");
  expect(amendment).toHaveTextContent("取消・失効の日時と理由を記録します。元の資格の記録は残ります。");
  expect(document.querySelectorAll(".ideal-v3-task--danger")).toHaveLength(0);
  // The tasks of a group stand in one list each.
  expect(Array.from(panel("次の操作").querySelectorAll(".ideal-v3-task-list")).map((list) => list.querySelectorAll(":scope > .ideal-v3-task").length)).toEqual([5, 3, 6]);
});

test("choosing a person shows their records and narrows the staff tasks to them", async () => {
  await mount();
  open(T.person); open(T.contract); open(T.capability); open(T.employer);
  expect(within(field(T.contract, "編集する対象")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "新しい契約を登録する", "合成 一・合成病院 2026-01-01 00:00 〜 2028-01-01 00:00（第2版）"]);
  choose(/合成 二/);
  const detail = screen.getByRole("heading", { level: 4, name: "合成 二（第1版）" }).closest("article")!;
  for (const text of ["登録されている雇用関係はありません。", "登録されている契約はありません。", "登録されている資格はありません。"]) expect(detail).toHaveTextContent(text);
  expect(within(within(detail).getByRole("navigation", { name: "選択職員の詳細" })).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["本人アカウント", "/workspace/people/memberships?person=p2"], ["入職・退職", "/workspace/people/lifecycle?person=p2"]]);
  expect(detail).toHaveTextContent("識別情報職員の識別子：p2");
  expect(panel("次の操作")).toHaveTextContent("職員の記録は、選択中の合成 二さんのものに絞っています。");
  expect(within(field(T.contract, "編集する対象")).getAllByRole("option")).toHaveLength(2);
  expect(within(field(T.person, "編集する対象")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "新しい職員を登録する", "合成 二（第1版）"]);
  // A new record of the person's kinds starts with the person; the facility's records are not narrowed.
  set(T.contract, "編集する対象", "new");
  expect(field(T.contract, "対象職員")).toHaveValue("p2");
  expect(within(field(T.employer, "編集する対象")).getAllByRole("option")).toHaveLength(4);
  press(T.contract, "入力を破棄する");
  choose(/合成 一/);
  expect(rows("合成 一の雇用関係")).toEqual([
    "合成病院の事業場2026-01-01 00:00 〜 2026-07-01 00:00通常の労働時間制確認済み第1版",
    "合成病院の事業場2026-07-01 00:00 〜 2028-01-01 00:00通常の労働時間制確認済み第1版",
    "合成診療所の事業場2026-01-01 00:00 〜 2028-01-01 00:00通常の労働時間制確認済み第1版",
  ]);
  expect(rows("合成 一の契約")).toEqual(["合成病院2026-01-01 00:00 〜 2028-01-01 00:00直接雇用・常勤一般制確認済み未確認第2版"]);
  expect(rows("合成 一の資格")).toEqual(["調剤（薬剤部）2026-01-01 00:00 〜 2028-01-01 00:00監督者は不要（監督できる人数 0名）確認済み第1版"]);
  fireEvent.click(screen.getByRole("button", { name: "職員の選択を解除する" }));
  expect(within(field(T.contract, "編集する対象")).getAllByRole("option")).toHaveLength(3);
  // The search narrows the list only.
  fireEvent.change(screen.getByLabelText("職員を検索"), { target: { value: "二" } });
  expect(within(screen.getByRole("list", { name: "職員一覧" })).getAllByRole("button")).toHaveLength(1);
  expect(screen.getByText("1名を表示")).toBeInTheDocument();
});

test("the person the URL names is chosen at first; one the records do not hold is said to be missing", async () => {
  const named = await mount(roster(), serve(), { selectedPersonId: "p2" });
  expect(within(screen.getByRole("list", { name: "職員一覧" })).getByRole("button", { name: /合成 二/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { level: 4, name: "合成 二（第1版）" })).toBeInTheDocument();
  expect(steps()[0]).toBe("1. 職員の氏名を登録する：記録あり");
  open(T.capability); set(T.capability, "編集する対象", "new");
  expect(field(T.capability, "対象職員")).toHaveValue("p2");
  named.view.unmount();
  await mount(roster(), serve(), { selectedPersonId: "p-gone" });
  expect(within(panel("現在の状態")).getByRole("alert")).toHaveTextContent("指定された職員は、現在の入力版と記録にありません。職員一覧から選び直してください。");
  expect(steps()[0]).toBe("1. 職員の氏名を登録する：記録なし");
  open(T.contract);
  expect(within(field(T.contract, "編集する対象")).getAllByRole("option")).toHaveLength(3);
});

test("the showcase shows the route ready and with nothing yet, and never reaches a server", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="people" view="contracts" role="ADMIN" />);
  expect(await screen.findByRole("heading", { level: 2, name: "現在の状態" })).toBeInTheDocument();
  expect(rows("この部署の契約の一覧")).toEqual([
    "高橋 葵直接雇用常勤一般制2026-04-01 00:00 〜 2028-04-01 00:00確認済み確認済み第1版",
    "鈴木 悠斗直接雇用短時間一般制2026-04-01 00:00 〜 2028-04-01 00:00確認済み未確認第2版",
  ]);
  expect(within(screen.getByRole("list", { name: "職員一覧" })).getAllByRole("button")).toHaveLength(3);
  expect(rows("登録されている雇用主")).toEqual(["東都医療センター（架空）確認済み第1版"]);
  // The administrator has no records yet: the steps say which exist.
  choose(/佐藤 美咲/);
  expect(steps()).toEqual([
    "1. 職員の氏名を登録する：記録あり", "2. 雇用主と事業場を用意する（施設で一度だけ）：記録あり", "3. 雇用関係を登録する：記録なし", "4. 契約を登録する：前の手順が先",
    "5. 担当できる業務（資格）を登録する：記録なし", "6. 計画の入力に反映する：計画の画面で行う",
  ]);
  expect(stepItems()[3]).toHaveTextContent("先にこの職員の雇用関係を登録してください。");
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="people" view="contracts" role="ADMIN" state="empty" />);
  expect(await screen.findByText("登録されている職員はいません。「次の操作」の「職員を登録・氏名を訂正する」から登録します。")).toBeInTheDocument();
  expect(screen.getByText("登録されている契約はありません。")).toBeInTheDocument();
  expect(panel("履歴")).toHaveTextContent("登録されている記録0件");
  expect(task(T.person)).toBeInTheDocument();
  // A pharmacist and a leader are not given the route at all.
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe("the steps of adding a person", () => {
  test("say which records exist for the chosen person and start the task that registers the next one", async () => {
    await mount();
    // Nobody chosen: the steps of a person not registered yet.
    expect(panel("次の操作")).toHaveTextContent("まだ登録していない新しい職員の手順です。");
    // One line before the list; how to use it is a reveal of background, closed. That a step
    // and a task are one thing is seen, not explained: a start carries the arrow of a control
    // that leads down the page, and the task it opens carries the step's number as its tag.
    const lead = screen.getByRole("heading", { level: 3, name: "新しい職員を追加する手順" }).nextElementSibling!;
    expect(lead).toHaveTextContent(/^まだ登録していない新しい職員の手順です。手順のボタンは、この下に並ぶ同じ番号の操作を、新しい記録の入力から開きます。$/);
    const usage = screen.getByText("この手順の使い方").closest("details")!;
    expect(usage.open).toBe(false);
    expect(Array.from(usage.querySelectorAll("li")).map((item) => item.textContent)).toEqual([
      "氏名を登録した後、「現在の状態」の職員一覧でその職員を選ぶと、その職員の記録の有無を表示します。", "記録は1件ずつ保存され、途中でやめても保存済みの分は残ります。", "記録が条件を満たすかどうかは、「現在の状態」の「記録の検証結果」で確認してください。",
    ]);
    expect(panel("次の操作")).not.toHaveTextContent("別の登録ではありません");
    const tagOf = (summary: string) => task(summary).closest(".ideal-v3-task")!.querySelector(".ideal-v3-task__hint > .ideal-pill")?.textContent ?? null;
    expect([T.person, T.employer, T.site, T.employment, T.contract, T.capability].map(tagOf)).toEqual(["手順1", "手順2", "手順2", "手順3", "手順4", "手順5"]);
    expect(Object.values(T).filter((summary) => tagOf(summary) !== null)).toHaveLength(6);
    expect(steps()).toEqual([
      "1. 職員の氏名を登録する：記録なし", "2. 雇用主と事業場を用意する（施設で一度だけ）：記録あり", "3. 雇用関係を登録する：前の手順が先", "4. 契約を登録する：前の手順が先",
      "5. 担当できる業務（資格）を登録する：前の手順が先", "6. 計画の入力に反映する：計画の画面で行う",
    ]);
    expect(stepItems()[2]).toHaveTextContent("先に職員の氏名を登録し、上で選んでください。");
    const list = within(screen.getByRole("list", { name: "新しい職員を追加する手順" }));
    expect(list.getAllByRole("button").map((button) => button.textContent)).toEqual(["氏名の登録を始める", "雇用主の登録を始める", "事業場の登録を始める"]);
    for (const button of list.getAllByRole("button")) expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(list.getByRole("link", { name: "計画の「前提・取込」" })).toHaveAttribute("href", "/workspace/plan/input");
    // The first step without a record is the thing to do next: its start is the one filled button.
    expect(list.getAllByRole("button").filter((button) => button.classList.contains("ideal-button--primary")).map((button) => button.textContent)).toEqual(["氏名の登録を始める"]);
    // The step opens its task on a new record and moves focus to the task's content step.
    await act(async () => { fireEvent.click(list.getByRole("button", { name: "氏名の登録を始める" })); });
    expect(task(T.person).open).toBe(true);
    expect(field(T.person, "編集する対象")).toHaveValue("new");
    expect(within(task(T.person)).getByRole("heading", { level: 4, name: "2. 職員の氏名を入力する" })).toHaveFocus();
    await act(async () => { fireEvent.click(list.getByRole("button", { name: "事業場の登録を始める" })); });
    expect(task(T.site).open).toBe(true);
    expect(within(task(T.site)).getByRole("heading", { level: 4, name: "2. 事業場の内容と根拠を入力する" })).toHaveFocus();
    expect(task(T.contract).open).toBe(false);
    // A person with a name and nothing else: employment and qualification are next; the contract waits for the employment.
    choose(/合成 二/);
    expect(panel("次の操作")).toHaveTextContent("合成 二さんについて、どの記録があるかを表示しています。");
    expect(list.getAllByRole("button").map((button) => button.textContent)).toEqual(["氏名の登録を始める", "雇用主の登録を始める", "事業場の登録を始める", "雇用関係の登録を始める", "資格の登録を始める"]);
    expect(list.getAllByRole("button").filter((button) => button.classList.contains("ideal-button--primary")).map((button) => button.textContent)).toEqual(["雇用関係の登録を始める"]);
    await act(async () => { fireEvent.click(list.getByRole("button", { name: "雇用関係の登録を始める" })); });
    expect(task(T.employment).open).toBe(true);
    expect(field(T.employment, "対象職員")).toHaveValue("p2");
    expect(within(task(T.employment)).getByRole("heading", { level: 4, name: "2. 雇用関係の内容と根拠を入力する" })).toHaveFocus();
    await act(async () => { fireEvent.click(list.getByRole("button", { name: "資格の登録を始める" })); });
    expect(field(T.capability, "対象職員")).toHaveValue("p2");
    // A person with every record: every step says that its record exists (not that it is valid).
    choose(/合成 一/);
    expect(steps().slice(0, 5).every((text) => text.endsWith("：記録あり"))).toBe(true);
    expect(list.getAllByRole("button").filter((button) => button.classList.contains("ideal-button--primary"))).toEqual([]);
    await act(async () => { fireEvent.click(list.getByRole("button", { name: "契約の登録を始める" })); });
    expect(field(T.contract, "対象職員")).toHaveValue("p1");
    expect(within(task(T.contract)).getByRole("heading", { level: 4, name: "2. 契約の内容と根拠を入力する" })).toHaveFocus();
  });

  test("a step does not replace entries that are not saved", async () => {
    await mount();
    open(T.employer); set(T.employer, "編集する対象", "new"); set(T.employer, "雇用主の正式名称", "入力中の名称");
    expect(hasUnsavedChanges()).toBe(true);
    const list = within(screen.getByRole("list", { name: "新しい職員を追加する手順" }));
    await act(async () => { fireEvent.click(list.getByRole("button", { name: "雇用主の登録を始める" })); });
    expect(panel("次の操作")).toHaveTextContent("入力中で保存していない内容があります。");
    expect(field(T.employer, "雇用主の正式名称")).toHaveValue("入力中の名称");
    press(T.employer, "入力を破棄する");
    await act(async () => { fireEvent.click(list.getByRole("button", { name: "雇用主の登録を始める" })); });
    expect(panel("次の操作")).not.toHaveTextContent("入力中で保存していない内容があります。");
    expect(field(T.employer, "雇用主の正式名称")).toHaveValue("");
  });
});

type Entry = { summary: string; target: string | null; fill: () => unknown; expected: { path: string; body: unknown }; version: string; change: string };
/** The entries of each record kind and the body the established form sent for them. */
const ENTRIES: Record<string, Entry> = {
  "a new person": { summary: T.person, target: "new", expected: B.NEW_PERSON, version: "新規登録（第1版を作成）", change: "職員の氏名：（なし） → 合成 三", fill: () => set(T.person, "職員の氏名", "合成 三") },
  "a corrected name": { summary: T.person, target: "p1", expected: B.RENAMED_PERSON, version: "第1版 → 第2版", change: "職員の氏名：合成 一 → 合成 一郎", fill: () => set(T.person, "職員の氏名", "合成 一郎") },
  "a new employer": { summary: T.employer, target: "new", expected: B.NEW_EMPLOYER, version: "新規登録（第1版を作成）", change: "雇用主の正式名称：（なし） → 合成薬局", fill: () => { set(T.employer, "雇用主の正式名称", "合成薬局"); evidence(T.employer); } },
  "a new site": { summary: T.site, target: "new", expected: B.NEW_ESTABLISHMENT, version: "新規登録（第1版を作成）", change: "事業場の雇用主：（なし） → 合成病院", fill: () => { set(T.site, "事業場の雇用主", "hospital"); period(T.site); evidence(T.site); } },
  "a new management model": { summary: T.model, target: "new", expected: B.NEW_MANAGEMENT_MODEL, version: "新規登録（第1版を作成）", change: "先契約側の法定外時間上限：（なし） → 36000秒（10時間0分）", fill: () => {
    set(T.model, "対象職員", "p1"); period(T.model); set(T.model, "先契約の雇用主", "hospital"); set(T.model, "後契約の雇用主", "clinic"); set(T.model, "管理モデルの月起算日", "2026-04-01");
    set(T.model, "先契約側の法定外時間上限（秒）", "36000"); set(T.model, "後契約側の総労働時間上限（秒）", "72000"); evidence(T.model, "先契約の雇用主の合意"); evidence(T.model, "後契約の雇用主の合意"); evidence(T.model, "通知の確認");
  } },
  "a new flextime employment": { summary: T.employment, target: "new", expected: B.NEW_FLEX_EMPLOYMENT, version: "新規登録（第1版を作成）", change: "毎週の所定休日：（なし） → 土・日", fill: () => {
    set(T.employment, "対象職員", "p1"); period(T.employment); set(T.employment, "雇用先の事業場", "site1"); set(T.employment, "契約締結順（未確認の場合は空欄）", "2"); set(T.employment, "活動の区分", "nonemployment"); set(T.employment, "週の起算曜日", "6");
    set(T.employment, "法定休日の日付（1行に1日、YYYY-MM-DD）", "2026-04-05\n2026-04-12"); tick(T.employment, "週起算と法定休日を原本照合した"); set(T.employment, "法定休日の与え方", "four_week"); set(T.employment, "変形休日制の起算日（就業規則の定め）", "2026-04-01");
    set(T.employment, "労働時間制度", "flex"); set(T.employment, "清算期間の起算日", "2026-04-01"); set(T.employment, "清算期間の長さ（月数）", "2"); tick(T.employment, "完全週休2日制の特例を適用する（労使協定による）");
    fireEvent.click(group(T.employment, "毎週の所定休日").getByLabelText("日")); fireEvent.click(group(T.employment, "毎週の所定休日").getByLabelText("土"));
    set(T.employment, "その他の所定休日（1行に1日、YYYY-MM-DD）", "2026-04-29"); set(T.employment, "雇用関係に適用する協定", "a1"); evidence(T.employment, "兼業申告の確認"); evidence(T.employment, "変形労働時間制の根拠（就業規則・労使協定）");
  } },
  "a new employment under monthly variable hours": { summary: T.employment, target: "new", expected: B.NEW_MONTHLY_EMPLOYMENT, version: "新規登録（第1版を作成）", change: "雇用関係の履歴：（なし） → 合成病院との雇用関係（2026-01-01 00:00から）", fill: () => {
    set(T.employment, "対象職員", "p1"); period(T.employment); set(T.employment, "雇用関係の履歴", "rel1"); set(T.employment, "雇用先の事業場", "site1"); set(T.employment, "労働時間制度", "monthly_variable");
    set(T.employment, "変形期間の起算日", "2026-04-01"); set(T.employment, "変形期間の日数（空欄なら起算日から1か月ごと）", "28"); evidence(T.employment, "兼業申告の確認"); evidence(T.employment, "変形労働時間制の根拠（就業規則・労使協定）");
  } },
  "a new employment under a one-year calendar": { summary: T.employment, target: "new", expected: B.NEW_ANNUAL_EMPLOYMENT, version: "新規登録（第1版を作成）", change: "適用するカレンダー：（なし） → 合成病院 2026-04-01 〜 2027-04-01", fill: () => {
    set(T.employment, "対象職員", "p1"); period(T.employment); set(T.employment, "雇用先の事業場", "site1"); set(T.employment, "労働時間制度", "annual_variable"); set(T.employment, "適用するカレンダー", "cal1"); evidence(T.employment, "兼業申告の確認");
  } },
  "a revised employment": { summary: T.employment, target: "emp2", expected: B.REVISED_EMPLOYMENT, version: "第1版 → 第2版", change: "適用終了（日本時間）：2028-01-01 00:00 → 2027-10-01 00:00", fill: () => { set(T.employment, "適用終了（日本時間）", "2027-10-01T00:00"); tick(T.employment, "週起算と法定休日を原本照合した"); } },
  "a new contract": { summary: T.contract, target: "new", expected: B.NEW_CONTRACT, version: "新規登録（第1版を作成）", change: "勤務できる曜日：（なし） → 月・火・水・木・金・土", fill: () => {
    set(T.contract, "対象職員", "p1"); set(T.contract, "適用する雇用関係", "rel1"); period(T.contract); set(T.contract, "雇用形態", "agency"); tick(T.contract, "有期契約"); set(T.contract, "勤務時間区分", "part_time"); set(T.contract, "労働時間制度", "variable");
    for (const day of ["土", "日", "土"]) fireEvent.click(group(T.contract, "勤務できる曜日").getByLabelText(day));
    for (const kind of ["LATE", "DAY"]) fireEvent.click(group(T.contract, "勤務できる種類").getByLabelText(kind));
    set(T.contract, "対象期間の契約上限（秒）", "576000"); set(T.contract, "週の所定労働時間（秒）", "108000"); set(T.contract, "勤務間休息時間（秒）", "39600"); set(T.contract, "最大連続勤務日数", "5");
    tick(T.contract, "兼業の有無と勤務情報を確認した"); set(T.contract, "適用する協定（任意）", "a1"); fireEvent.click(group(T.contract, "派遣を認める業務").getByLabelText("調剤"));
    evidence(T.contract); evidence(T.contract, "労働時間制度の確認"); evidence(T.contract, "派遣の適用根拠");
  } },
  "a revised contract": { summary: T.contract, target: "c1", expected: B.REVISED_CONTRACT, version: "第2版 → 第3版", change: "最大連続勤務日数：5日 → 4日", fill: () => set(T.contract, "最大連続勤務日数", "4") },
  "a new qualification": { summary: T.capability, target: "new", expected: B.NEW_CAPABILITY, version: "新規登録（第1版を作成）", change: "監督者の配置：（なし） → 必要", fill: () => {
    set(T.capability, "対象職員", "p1"); period(T.capability); set(T.capability, "担当業務", "病棟"); set(T.capability, "勤務場所", "本館"); tick(T.capability, "監督者の配置が必要"); set(T.capability, "同時に監督できる人数", "2"); evidence(T.capability);
  } },
  // A qualification is identified by its content: changed, it is sent as one not registered yet.
  "a qualification whose content is changed": { summary: T.capability, target: F.CAPABILITY_HASH, expected: B.CHANGED_CAPABILITY, version: "新規登録（第1版を作成）", change: "同時に監督できる人数：0名 → 3名", fill: () => set(T.capability, "同時に監督できる人数", "3") },
  "a withdrawal of a qualification": { summary: T.amendment, target: null, expected: B.NEW_CAPABILITY_AMENDMENT, version: "新規登録（第1版を作成）", change: "取消・失効の対象資格：（なし） → 合成 一・調剤（薬剤部） 2026-01-01 00:00 〜 2028-01-01 00:00", fill: () => {
    set(T.amendment, "取消・失効の対象資格", F.CAPABILITY_HASH); set(T.amendment, "資格を使用できなくなる日時（日本時間）", "2026-06-01T00:00"); set(T.amendment, "資格の取消・失効理由", "免許の失効"); evidence(T.amendment);
  } },
  "a new agreement with a special clause": { summary: T.agreement, target: "new", expected: B.NEW_AGREEMENT, version: "新規登録（第1版を作成）", change: "協定の月時間外上限：（なし） → 288000秒（80時間0分）", fill: () => {
    period(T.agreement); set(T.agreement, "協定を適用する事業場", "site1"); set(T.agreement, "協定年の起算日", "2026-04-01"); set(T.agreement, "協定月の起算日", "2026-04-01"); tick(T.agreement, "特別条項の定めがある");
    set(T.agreement, "協定の日時間外上限（秒）", "10800"); set(T.agreement, "協定の月時間外上限（秒）", "288000"); set(T.agreement, "協定の年時間外上限（秒）", "2160000"); tick(T.agreement, "休日労働を認める定めがある"); evidence(T.agreement); evidence(T.agreement, "特別条項の適用根拠");
  } },
  "a new rule review": { summary: T.review, target: "new", expected: B.NEW_RULE_REVIEW, version: "新規登録（第1版を作成）", change: "照合した条項：（なし） → 第2条", fill: () => {
    period(T.review); set(T.review, "一次資料のURL", "https://example.invalid/new"); set(T.review, "資料の版（改正日など）", "2026-10-01 改正"); set(T.review, "取得した資料のSHA-256（16進64桁）", "f".repeat(64)); set(T.review, "照合した条項", "第2条");
    set(T.review, "経過措置・非該当の理由", "該当なし"); set(T.review, "今回の確認日", "2026-10-01"); set(T.review, "次回の確認期限", "2027-10-01"); evidence(T.review);
  } },
  "a new rule decision": { summary: T.decision, target: "new", expected: B.NEW_RULE_DECISION, version: "新規登録（第1版を作成）", change: "判断に結び付ける影響の一覧：（なし） → 2件（照合値 dddddddddddd…）", fill: async () => {
    await act(async () => { set(T.decision, "判断する制度確認（資料のハッシュ付き）", "rev1"); }); set(T.decision, "判断", "publish"); set(T.decision, "判断日", "2026-04-02"); evidence(T.decision);
  } },
  "a new accounting transition": { summary: T.transition, target: "new", expected: B.NEW_ACCOUNTING_TRANSITION, version: "新規登録（第1版を作成）", change: "切替後の雇用条件：（なし） → 合成 一・合成病院 2026-07-01 00:00 〜 2028-01-01 00:00", fill: () => {
    set(T.transition, "切替前の雇用条件", "emp1"); set(T.transition, "切替後の雇用条件", "emp2"); set(T.transition, "確認した集計方法", "preserve_overlapping_full_weeks"); evidence(T.transition);
  } },
  "a new site attribution decision": { summary: T.attribution, target: "new", expected: B.NEW_SITE_DECISION, version: "新規登録（第1版を作成）", change: "時間外を帰属させる順序：（なし） → 事業場をまたいで働いた順に数える", fill: () => {
    period(T.attribution); set(T.attribution, "判断の対象とする雇用主", "hospital"); set(T.attribution, "時間外を帰属させる順序", "time_order"); set(T.attribution, "判断の理由と根拠（人事・法務）", "人事と法務の確認による"); evidence(T.attribution);
  } },
  "a new annual calendar": { summary: T.calendar, target: "new", expected: B.NEW_ANNUAL_CALENDAR, version: "新規登録（第1版を作成）", change: "区分期間1の同意：（なし） → 確認済み・資料 合成の同意書・確認責任者 確認者・有効期限 2027-04-01 00:00", fill: () => {
    set(T.calendar, "カレンダーを適用する事業場", "site1"); set(T.calendar, "対象期間の初日", "2026-04-01"); set(T.calendar, "対象期間の終了日（この日を含まない）", "2027-04-01"); set(T.calendar, "最初の期間の終了日（この日を含まない。ここまでを日ごとに確定）", "2026-05-01");
    set(T.calendar, "確定した労働日と所定時間（1行に1日：YYYY-MM-DD 時:分）", "2026-04-01 8:00\n2026-04-02 7:30"); press(T.calendar, "区分期間を追加");
    set(T.calendar, "区分期間1の開始日", "2026-05-01"); set(T.calendar, "区分期間1の終了日（この日を含まない）", "2027-04-01"); set(T.calendar, "区分期間1の労働日数", "220"); set(T.calendar, "区分期間1の総労働時間（秒）", "6336000"); set(T.calendar, "区分期間1の確定日（任意）", "2026-03-01");
    tick(T.calendar, "区分期間1の同意資料を記録する"); set(T.calendar, "区分期間1の同意の状態", "verified"); set(T.calendar, "区分期間1の同意の資料名・参照先", "合成の同意書"); set(T.calendar, "区分期間1の同意の確認責任者", "確認者"); set(T.calendar, "区分期間1の同意の有効期限（任意・日本時間）", "2027-04-01T00:00");
    set(T.calendar, "特定期間（1行に1期間：開始日 終了日）", "2026-08-01 2026-08-15"); evidence(T.calendar);
  } },
};

test.each(Object.entries(ENTRIES))("%s: confirmed with the four statements and sent as the established form sent it", async (_name, entry) => {
  const { calls, refresh } = await mount(roster(), serve({ key: "k", revision: 7, kind: "x" }));
  const summary = entry.summary;
  open(summary);
  if (entry.target) set(summary, "編集する対象", entry.target);
  await entry.fill();
  await review(summary);
  // Nothing is sent before the confirmation, which says the four things.
  expect(posts(calls)).toEqual([]);
  expect(within(surface(summary)).getByRole("heading", { level: 4, name: entry.target ? "3. 保存前の確認" : "2. 保存前の確認" })).toHaveFocus();
  expect(within(surface(summary)).getAllByRole("term").filter((term) => !term.closest(".ideal-v3-identifiers")).map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
  expect(changes(summary)).toContain(entry.change);
  expect(line(summary, "作成される版")).toHaveTextContent(entry.version);
  expect(line(summary, "通知").querySelector("dd")).toHaveTextContent(NOTICE);
  expect(line(summary, "競合・部分失敗")).toHaveTextContent(/保存前の時点では検出されていません。保存時にサーバーが、.+(が第\d版のままであること|がまだ登録されていないこと)を照合します。/);
  await confirm(summary);
  expect(sent(calls)).toEqual(entry.expected);
  expect(posts(calls)[0].path).toBe(`${entry.expected.path}?${SCOPE}`);
  // The route is read again; what was saved is said from the server's answer, with where the plan's input is derived again.
  expect(refresh).toHaveBeenCalledTimes(1);
  const done = within(task(summary)).getAllByRole("status").find((status) => /として保存しました/.test(status.textContent ?? ""))!;
  expect(done).toHaveTextContent(/第7版として保存しました。計画の入力には自動で反映されません。計画に使う前に、計画の「前提・取込」で入力を再導出してください。/);
  expect(within(done).getByRole("link", { name: "計画の「前提・取込」" })).toHaveAttribute("href", "/workspace/plan/input");
  expect(surface(summary)).toBeNull();
  expect(hasUnsavedChanges()).toBe(false);
});

test("what was typed into an editor is shown as typed in its confirmation, and marked as a person's words", async () => {
  await mount(roster(), serve({ key: "k", revision: 7, kind: "x" }));
  open(T.attribution);
  set(T.attribution, "編集する対象", "new");
  period(T.attribution); set(T.attribution, "判断の対象とする雇用主", "hospital"); set(T.attribution, "時間外を帰属させる順序", "time_order"); set(T.attribution, "判断の理由と根拠（人事・法務）", TYPED);
  evidence(T.attribution); set(T.attribution, "原本確認の資料名・参照先", TYPED); set(T.attribution, "原本確認の確認責任者", TYPED);
  await review(T.attribution);
  expect(changes(T.attribution)).toEqual(expect.arrayContaining([`判断の理由と根拠：（なし） → ${TYPED}`, `原本確認の資料：（なし） → ${TYPED}`, `原本確認の確認責任者：（なし） → ${TYPED}`]));
  expect(shownTimes(surface(T.attribution))).toBe(3);
  expect(unmarked(document.body)).toEqual([]);
  // The lines the product words itself (a date, a state named by a map) are not marked.
  const marked = within(line(T.attribution, "変更内容")).getAllByRole("listitem").filter((item) => item.hasAttribute("data-verbatim")).map((item) => item.textContent!.split("：")[0]);
  expect(marked).toEqual(["判断の理由と根拠", "原本確認の資料", "原本確認の確認責任者"]);
});

test("a qualification saved unchanged goes against its own version and creates none", async () => {
  const { calls } = await mount();
  open(T.capability); set(T.capability, "編集する対象", F.CAPABILITY_HASH);
  expect(task(T.capability)).toHaveTextContent("内容を変えると、別の新しい資格として登録されます。元の記録は変わらずに残ります。");
  await review(T.capability);
  expect(line(T.capability, "変更内容")).toHaveTextContent("現在の版との差分はありません。");
  expect(line(T.capability, "作成される版")).toHaveTextContent("第1版のまま（内容が同じため、新しい版は作られません）");
  await confirm(T.capability);
  expect(sent(calls)).toEqual(B.UNCHANGED_CAPABILITY);
});

test("an unknown outcome resends the identical body with its key; the entries are kept meanwhile", async () => {
  let attempts = 0;
  const { calls, refresh } = await mount(roster(), (call) => { if (call.method === "GET") return F.CONTEXT; attempts += 1; if (attempts === 1) throw new PlanningError(503, "unavailable"); return { key: "k", revision: 3, kind: "contract" }; });
  open(T.contract); set(T.contract, "編集する対象", "c1"); set(T.contract, "最大連続勤務日数", "4");
  await review(T.contract);
  await confirm(T.contract);
  expect(line(T.contract, "競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます");
  expect(refresh).not.toHaveBeenCalled();
  await confirm(T.contract, "同じ内容を再送する");
  expect(posts(calls)).toHaveLength(2);
  expect(posts(calls)[1].body).toEqual(posts(calls)[0].body);
  expect((posts(calls)[0].body as { idempotency_key: string }).idempotency_key).toBe("idempotency-key-1");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(within(task(T.contract)).getByText(/契約を第3版として保存しました。/)).toBeInTheDocument();
});

test("a conflict is reviewed as three contents and confirmed again against the version read from the server", async () => {
  const moved = { ...F.CONTEXT, records: F.RECORDS.map((row) => (row.kind === "contract" ? { ...row, revision: 3, payload: { ...F.CONTRACT, rest_seconds: 43200 } } : row)), contracts: [{ ...F.CONTRACT, rest_seconds: 43200 }] };
  let attempts = 0;
  const { calls, refresh } = await mount(roster(), (call) => { if (call.method === "GET") return moved; attempts += 1; if (attempts === 1) throw new PlanningError(409, "Input, version or ledger conflict; refresh and review again"); return { key: "k", revision: 4, kind: "contract" }; });
  open(T.contract); set(T.contract, "編集する対象", "c1"); set(T.contract, "最大連続勤務日数", "4");
  await review(T.contract);
  expect(changes(T.contract)).toEqual(["最大連続勤務日数：5日 → 4日"]);
  await confirm(T.contract);
  // The current version is read by the task; nothing is merged and saving waits for the review.
  expect(gets(calls)).toEqual([READ]);
  expect(within(surface(T.contract)).getByRole("alert")).toHaveTextContent("現在の版は第3版です。編集中の内容は保持しています。自動では統合しません。");
  const compare = within(within(surface(T.contract)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").map((row) => row.textContent);
  expect(compare.slice(1, 3)).toEqual(["勤務間休息時間39600秒（11時間0分）43200秒（12時間0分）39600秒（11時間0分）あり", "最大連続勤務日数5日5日4日あり"]);
  expect(within(surface(T.contract)).getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
  press(T.contract, "三つの内容を確認し、現在の版に対して確認し直す");
  expect(within(surface(T.contract)).getByRole("status")).toHaveTextContent("現在の第3版との差分に更新しました。内容を確認して、もう一度保存してください。");
  expect(changes(T.contract)).toEqual(["勤務間休息時間：43200秒（12時間0分） → 39600秒（11時間0分）", "最大連続勤務日数：5日 → 4日"]);
  expect(line(T.contract, "作成される版")).toHaveTextContent("第3版 → 第4版");
  await confirm(T.contract);
  expect((posts(calls)[1].body as { expected_revision: number }).expected_revision).toBe(3);
  expect((posts(calls)[1].body as { payload: unknown }).payload).toEqual((posts(calls)[0].body as { payload: unknown }).payload);
  expect(refresh).toHaveBeenCalledTimes(2);
});

test("a change the server does not take for a registered record is said as such", async () => {
  const { calls } = await mount(roster(), (call) => { if (call.method === "GET") return F.CONTEXT; throw new PlanningError(409, "conflict"); });
  open(T.contract); set(T.contract, "編集する対象", "c1"); set(T.contract, "対象職員", "p2");
  // The other person has no employment to attach the contract to: the relationship stays to be chosen.
  expect(field(T.contract, "適用する雇用関係")).toHaveValue("");
  expect(within(field(T.contract, "適用する雇用関係")).getAllByRole("option")).toHaveLength(1);
  choose(/合成 一/);
  press(T.contract, "入力を破棄する");
  set(T.contract, "編集する対象", "c1"); set(T.contract, "最大連続勤務日数", "4");
  await review(T.contract); await confirm(T.contract);
  expect(posts(calls)).toHaveLength(1);
  expect(surface(T.contract)).toHaveTextContent("サーバーにある版は、編集を始めたときと同じ第2版です。それでも競合と答えたため、サーバーはこの記録のこの変更を受け付けていません。登録済みの契約の対象職員は変えられません。");
});

describe("what is lawful is the server's to say", () => {
  test("an agreement beyond the legal bounds is sent as entered and refused in the server's words", async () => {
    const { calls } = await mount(roster(), (call) => { if (call.method === "GET") return F.CONTEXT; throw new PlanningError(422, JSON.stringify({ detail: "1 validation error for AgreementV3\n  Value error, Ordinary agreement is limited to 45h/month and 360h/year" })); });
    open(T.agreement); set(T.agreement, "編集する対象", "new");
    period(T.agreement); set(T.agreement, "協定を適用する事業場", "site1"); set(T.agreement, "協定年の起算日", "2026-04-01"); set(T.agreement, "協定月の起算日", "2026-04-01");
    set(T.agreement, "協定の月時間外上限（秒）", "432000"); set(T.agreement, "協定の年時間外上限（秒）", "3240000"); evidence(T.agreement);
    // No bound is set on the fields and none is restated beside them.
    for (const label of ["協定の日時間外上限（秒）", "協定の月時間外上限（秒）", "協定の年時間外上限（秒）"]) expect(field(T.agreement, label)).not.toHaveAttribute("max");
    expect(task(T.agreement).textContent).not.toMatch(/45時間|360時間|100時間|720時間|162000|1296000|2592000/);
    await review(T.agreement);
    expect(within(task(T.agreement)).queryByRole("alert")).toBeNull();
    await confirm(T.agreement);
    expect((sent(calls).body as { payload: { monthly_limit_seconds: number; annual_limit_seconds: number } }).payload).toMatchObject({ monthly_limit_seconds: 432000, annual_limit_seconds: 3240000 });
    expect(line(T.agreement, "競合・部分失敗")).toHaveTextContent("保存していません。サーバーが下の理由で受け付けませんでした。");
    expect(within(surface(T.agreement)).getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりました1 validation error for AgreementV3 Value error, Ordinary agreement is limited to 45h/month and 360h/year");
    // The entries are kept.
    press(T.agreement, "入力に戻る");
    expect(field(T.agreement, "協定の月時間外上限（秒）")).toHaveValue(432000);
  });

  test("an accounting transition offers every employment revision; which pairs stand is not decided here", async () => {
    await mount();
    open(T.transition); set(T.transition, "編集する対象", "new"); set(T.transition, "切替前の雇用条件", "emp1");
    // The revision of another employer, which does not follow the first, is offered as well.
    expect(within(field(T.transition, "切替後の雇用条件")).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["", "emp1", "emp2", "emp3"]);
    expect(task(T.transition)).toHaveTextContent("切替前と切替後の組み合わせとして成り立つかどうかは、サーバーが検証し、成り立たない組み合わせは「現在の状態」の検証結果に表示されます。");
  });

  test("a calendar's divisions are sent as entered; only a line that cannot be read stops the confirmation", async () => {
    const { calls } = await mount();
    open(T.calendar); set(T.calendar, "編集する対象", "new");
    set(T.calendar, "カレンダーを適用する事業場", "site1"); set(T.calendar, "対象期間の初日", "2026-04-01"); set(T.calendar, "対象期間の終了日（この日を含まない）", "2026-04-10"); set(T.calendar, "最初の期間の終了日（この日を含まない。ここまでを日ごとに確定）", "2026-04-05");
    // A division that ends before it starts and is fixed without a consent: the server's to refuse.
    press(T.calendar, "区分期間を追加"); set(T.calendar, "区分期間1の開始日", "2026-04-09"); set(T.calendar, "区分期間1の終了日（この日を含まない）", "2026-04-05"); set(T.calendar, "区分期間1の確定日（任意）", "2026-04-08");
    set(T.calendar, "確定した労働日と所定時間（1行に1日：YYYY-MM-DD 時:分）", "2026-04-01 0:00\n4月2日 8時間"); evidence(T.calendar);
    expect(within(task(T.calendar)).getByRole("alert")).toHaveTextContent("読み取れない行：2行目（4月2日 8時間）");
    await review(T.calendar);
    expect(surface(T.calendar)).toBeNull();
    expect(within(task(T.calendar)).getAllByRole("alert").map((alert) => alert.textContent)).toContain("カレンダーの行に読み取れない内容があります。表示された行を直してください。");
    set(T.calendar, "確定した労働日と所定時間（1行に1日：YYYY-MM-DD 時:分）", "2026-04-01 0:00");
    await review(T.calendar);
    expect(within(task(T.calendar)).queryByRole("alert")).toBeNull();
    await confirm(T.calendar);
    expect((sent(calls).body as { payload: unknown }).payload).toMatchObject({ start: "2026-04-01", end: "2026-04-10", days: [{ day: "2026-04-01", seconds: 0 }], segments: [{ start: "2026-04-09", end: "2026-04-05", working_days: 0, total_seconds: 0, fixed_on: "2026-04-08", consent: null }] });
    expect(task(T.calendar).textContent).not.toMatch(/10時間|52時間|280日|12日|1か月超|30日/);
  });

  test("an employment's working-time system is entered without its legal bounds; flextime points to the workspace's own setting", async () => {
    await mount();
    open(T.employment); set(T.employment, "編集する対象", "new"); set(T.employment, "労働時間制度", "monthly_variable");
    expect(field(T.employment, "変形期間の日数（空欄なら起算日から1か月ごと）")).not.toHaveAttribute("max");
    set(T.employment, "労働時間制度", "flex");
    expect(field(T.employment, "清算期間の長さ（月数）")).not.toHaveAttribute("max");
    expect(within(task(T.employment)).getByRole("link", { name: "設定の「フレックスタイム制」" })).toHaveAttribute("href", "/workspace/settings/flextime");
    expect(task(T.employment).textContent).not.toMatch(/28日|40時間|50時間|8時間×|3か月|2日以上/);
    // A period that does not run forward is an entry slip the server refuses as well.
    set(T.employment, "対象職員", "p1"); period(T.employment, "2026-04-01T00:00", "2026-04-01T00:00"); set(T.employment, "雇用先の事業場", "site1"); evidence(T.employment, "兼業申告の確認"); evidence(T.employment, "変形労働時間制の根拠（就業規則・労使協定）");
    set(T.employment, "清算期間の起算日", "2026-04-01");
    await review(T.employment);
    expect(within(task(T.employment)).getByRole("alert")).toHaveTextContent("適用終了は、適用開始より後にしてください。");
    expect(surface(T.employment)).toBeNull();
  });

  test("a contract needs a kind of duty to work; its terms carry no bound", async () => {
    await mount();
    open(T.contract); set(T.contract, "編集する対象", "new");
    set(T.contract, "対象職員", "p1"); set(T.contract, "適用する雇用関係", "rel1"); period(T.contract); evidence(T.contract); evidence(T.contract, "労働時間制度の確認");
    for (const label of ["対象期間の契約上限（秒）", "週の所定労働時間（秒）", "勤務間休息時間（秒）", "最大連続勤務日数"]) expect(field(T.contract, label)).not.toHaveAttribute("max");
    await review(T.contract);
    expect(within(task(T.contract)).getByRole("alert")).toHaveTextContent("勤務できる種類を1つ以上選んでください。");
  });
});

describe("a rule decision is bound to the server's impact list", () => {
  test("each identifier of the list says what it is the identifier of: an assessment's own and its grant's are two lines", () => {
    const { container } = render(<ImpactList impact={{ review_id: "rev1", rule_id: "r-2026", source_sha256: "c".repeat(64), impact_hash: "9".repeat(64), impact_count: 3, publications: [],
      grant_assessments: [{ assessment_id: "assess-1", account_id: "grant-1", rule_revision: "r-2025", as_of: "2026-01-01" }, { assessment_id: null, account_id: "grant-2", rule_revision: null, as_of: null }],
      grant_records: [{ account_id: "grant-3", granted_on: "2026-02-01" }] }} />);
    // An assessment without an identifier of its own has one line, and it is named as the grant's.
    expect(Array.from(container.querySelectorAll(".ideal-v3-identifiers > div")).map((row) => [row.querySelector("dt")!.textContent, Array.from(row.querySelectorAll("dd code")).map((code) => code.textContent)])).toEqual([
      ["付与照合：照合の識別子：", ["assess-1"]], ["付与照合：付与の識別子：", ["grant-1"]], ["付与照合：付与の識別子：", ["grant-2"]], ["付与原本：", ["grant-3"]],
    ]);
  });

  test("the list is read for the chosen review, read again at the confirmation, shown there and saved with the decision", async () => {
    let reads = 0;
    const later = { ...F.IMPACT, impact_count: 3, impact_hash: "9".repeat(64), grant_records: [...F.IMPACT.grant_records, { account_id: "g2", granted_on: "2026-02-01", revision: 1 }] };
    const { calls } = await mount(roster(), (call) => { if (call.method !== "GET") return { key: "k", revision: 1, kind: "rule_decision" }; if (!call.path.startsWith("/compliance/rule-impact/")) return F.CONTEXT; reads += 1; return reads === 1 ? F.IMPACT : later; });
    open(T.decision); set(T.decision, "編集する対象", "new");
    expect(calls).toEqual([]);
    await act(async () => { set(T.decision, "判断する制度確認（資料のハッシュ付き）", "rev1"); });
    expect(gets(calls)).toEqual([`/compliance/rule-impact/rev1?${SCOPE}`]);
    const shown = within(task(T.decision)).getByRole("group", { name: "サーバーが返した影響の一覧" });
    expect(shown).toHaveTextContent("サーバーが返した影響の一覧：公開 1件・付与照合 0件・付与原本 1件（合計 2件）");
    expect(within(shown).getAllByRole("listitem").slice(0, 2).map((item) => item.textContent)).toEqual(["公開した勤務表 2026-01-05 00:00 〜 2026-01-12 00:00 第3版（規則版 r-2025）", "年休の付与原本（付与日 2026-01-01）"]);
    set(T.decision, "判断", "publish"); set(T.decision, "判断日", "2026-04-02"); evidence(T.decision);
    await review(T.decision);
    // The list had changed meanwhile: what is confirmed and saved is the list read now.
    expect(gets(calls)).toHaveLength(2);
    const bound = within(surface(T.decision)).getByRole("group", { name: "サーバーが返した影響の一覧" });
    expect(bound).toHaveTextContent("この判断に結び付ける影響の一覧：公開 1件・付与照合 0件・付与原本 2件（合計 3件）");
    expect(changes(T.decision)).toContain("判断に結び付ける影響の一覧：（なし） → 3件（照合値 999999999999…）");
    expect(posts(calls)).toEqual([]);
    await confirm(T.decision);
    expect((sent(calls).body as { payload: unknown }).payload).toMatchObject({ review_id: "rev1", rule_id: "r-2026", source_sha256: "c".repeat(64), impact_hash: "9".repeat(64), impact_count: 3, decision: "publish" });
  });

  test("without the list nothing is confirmed; a list the server no longer accepts is refused in its words", async () => {
    let fail = true;
    const { calls } = await mount(roster(), (call) => {
      if (call.method !== "GET") throw new PlanningError(422, JSON.stringify({ detail: "影響の一覧が変わりました。影響を表示し直してから判断してください。" }));
      if (!call.path.startsWith("/compliance/rule-impact/")) return F.CONTEXT;
      if (fail) throw new PlanningError(404, JSON.stringify({ detail: "制度確認が見つかりません。" }));
      return F.IMPACT;
    });
    open(T.decision); set(T.decision, "編集する対象", "new");
    await act(async () => { set(T.decision, "判断する制度確認（資料のハッシュ付き）", "rev1"); });
    expect(within(task(T.decision)).getByRole("alert")).toHaveTextContent("404見つかりません制度確認が見つかりません。");
    set(T.decision, "判断日", "2026-04-02"); evidence(T.decision);
    await review(T.decision);
    expect(surface(T.decision)).toBeNull();
    expect(posts(calls)).toEqual([]);
    fail = false;
    await act(async () => { press(T.decision, "影響の一覧を読み直す"); });
    expect(within(task(T.decision)).getByRole("group", { name: "サーバーが返した影響の一覧" })).toBeInTheDocument();
    await review(T.decision);
    await confirm(T.decision);
    expect(within(surface(T.decision)).getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりました影響の一覧が変わりました。影響を表示し直してから判断してください。");
  });
});

// The route arrives as server HTML. Its tasks have no field until React attaches.
describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("the server HTML holds the state and the closed tasks without fields; what was typed and opened there is kept", async () => {
    const { node, calls } = tree(serve());
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node(roster()));
    expect(container.innerHTML).toContain("契約と適用期間");
    expect(container.innerHTML).toContain(T.contract);
    // The only field of the server HTML is the search of the list of people.
    expect(Array.from(container.querySelectorAll("input, select, textarea")).map((element) => element.getAttribute("type"))).toEqual(["search"]);
    expect(within(container).getAllByText("この操作を準備しています。")).toHaveLength(14);
    const search = container.querySelector("input")!;
    search.value = "二";
    const contract = within(container).getByText(T.contract).closest("details")!;
    contract.open = true;
    await act(async () => { root = hydrateRoot(container, node(roster())); });
    expect(search).toHaveValue("二");
    expect(within(within(container).getByRole("list", { name: "職員一覧" })).getAllByRole("button").map((button) => button.textContent)).toEqual(["合合成 二雇用関係 0件・契約 0件・資格 0件"]);
    expect(contract.open).toBe(true);
    expect(within(contract).getByLabelText("編集する対象")).toBeVisible();
    expect(calls).toEqual([]);
  });
});
