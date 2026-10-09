import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { hasUnsavedChanges } from "../../../shared/useUnsavedNavigation";
import { ROUTE_DEFINITIONS, routeDefinition, routeKey } from "../../../shell/routes";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { AdoptionPayload, AdoptionRow, EnrollmentPayload, EnrollmentRow, FlexImpact, FlexListing, FlexSettlements } from "../../api";
import { adoptionLabel, findingParts, flexNames, type FlextimeData } from "../model";
import { entrySlips, emptyForm, refusedRegistration } from "../registration";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => { Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => "11111111-2222-4333-8444-555555555555") }); });
afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const LIST = `/compliance/flex-adoptions?${SCOPE}`;
const SETTLEMENTS = `/compliance/flex-settlements?${SCOPE}`;
const ENROLL = `/compliance/flex-enrollments?${SCOPE}`;
const adoptionPath = (id: string, step: string) => `/compliance/flex-adoptions/${id}/${step}?${SCOPE}`;
const enrollmentPath = (id: string, step: string) => `/compliance/flex-enrollments/${id}/${step}?${SCOPE}`;
const may = { allowed: true, refusal: null };
const not = (refusal: string) => ({ allowed: false, refusal });
const SELF = "登録した管理者本人は確認できません。別の管理者が確認してください。";
const NOT_REGISTERED = "確認できるのは、登録済みで確認待ちの採用だけです。";
const NOT_ENDABLE = "終了できるのは、確認済みで終了日を定めていない採用だけです。";
const STARTED = "開始後は取り下げられません。採用は、将来の清算期間の初日で終了してください。本人を外すときは、清算期間の初日から通常の雇用条件を登録してください。";
const evidence = { reference: "就業規則第20条（合成）", status: "verified" as const, verified_by: "人事A", valid_until: null };
const terms = (over: Partial<AdoptionPayload> = {}): AdoptionPayload => ({
  adoption_id: "flex-1", employer_id: "hospital", establishment_id: "site-hospital", start: "2027-04-01T00:00:00+09:00", end: "2028-04-01T00:00:00+09:00", target_scope: "薬剤部の薬剤師",
  settlement_months: 1, settlement_anchor: "2027-04-01", total_hours_rule: "statutory_frame", agreed_total_description: "暦日数÷7×40時間", standard_day_seconds: 28800,
  work_rules_evidence: evidence, agreement_evidence: evidence, status: "registered", created_by: "other", created_at: "2027-03-01T00:00:00Z", ...over,
});
const adoption = (over: Partial<AdoptionPayload> = {}, extra: Partial<AdoptionRow> = {}): AdoptionRow => ({
  entity_id: over.adoption_id ?? "flex-1", revision: 1, payload: terms(over),
  settlement_starts: { participant_start: ["2027-04-01", "2027-05-01"], end_on: [] },
  actions: { confirm: may, withdraw: may, end: not(NOT_ENDABLE), add_participant: may }, ...extra,
});
/** A confirmed adoption that has started: it can be ended on the days the server lists. */
const running = (extra: Partial<AdoptionRow> = {}) => adoption({ adoption_id: "flex-run", status: "confirmed", start: "2027-01-01T00:00:00+09:00", settlement_anchor: "2027-01-01", target_scope: "開始済みの採用", created_by: "admin", reviewed_by: "other" }, {
  revision: 2, settlement_starts: { participant_start: ["2027-06-01", "2027-07-01"], end_on: ["2027-06-01", "2027-07-01"] },
  actions: { confirm: not(NOT_REGISTERED), withdraw: not(STARTED), end: may, add_participant: may }, ...extra,
});
const enrollment = (over: Partial<EnrollmentPayload> = {}, extra: Partial<EnrollmentRow> = {}): EnrollmentRow => ({
  entity_id: over.enrollment_id ?? "flex-run-p0", revision: 1,
  payload: { enrollment_id: "flex-run-p0", adoption_id: "flex-run", person_id: "p0", start: "2027-06-01T00:00:00+09:00", status: "registered", created_by: "other", created_at: "2027-05-01T00:00:00Z", ...over },
  actions: { confirm: may, withdraw: may }, ...extra,
});
const listing = (over: Partial<FlexListing> = {}): FlexListing => ({
  viewer: "admin", can_manage: true, manage_refusal: null, adoptions: [], enrollments: [],
  establishments: [{ establishment_id: "site-hospital", employer_id: "hospital", start: "2024-12-01T00:00:00+09:00", end: "2029-01-01T00:00:00+09:00" }],
  people: [{ person_id: "p0", name: "薬剤師一" }, { person_id: "p1", name: "薬剤師二" }], ...over,
});
const impact = (over: Partial<FlexImpact> = {}): FlexImpact => ({
  adoption_id: "flex-1", status: "registered", people: [{ person_id: "p0", enrollment_id: "flex-1-p0", start: "2027-04-01T00:00:00+09:00", status: "registered", employment_revisions: [] }],
  timed_duties: [{ scope_id: "hospital/pharmacy", duty_id: "duty-9", person_id: "p0", start: "2027-04-02T09:00:00+09:00" }], blocking: [],
  next_steps: ["参加者ごとに、参加の開始日から始まるフレックスタイム制の雇用条件を登録する"], impact_hash: "a".repeat(64), ...over,
});
const SETTLED: FlexSettlements = { input_hash: "b".repeat(64), people: [
  { person_id: "p0", name: "薬剤師一", settlements: [{ kind: "flextime", start: "2027-04-01", end: "2027-07-01", frame_seconds: 1872000, worked_seconds: 1944000, monthly_overtime_seconds: { "2027-04": 3600, "2027-05": 1800 }, final_month_overtime_seconds: 66600, unattributed_seconds: 900 }] },
  { person_id: "p1", name: "薬剤師二", settlements: [{ kind: "flextime_part", start: "2027-04-01", end: "2027-04-16", frame_seconds: 288000, worked_seconds: 291600, settlement_seconds: 3600 }] },
], findings: [{ rule_id: "work.flextime", status: "unverified", message: "Flextime work rules or agreement unverified: emp-1" }, { rule_id: "x", status: "violation", message: "An untranslated message" }] };
const data = (list: FlexListing = listing(), settlement: FlextimeData["settlement"] = { available: true, result: { input_hash: "b".repeat(64), people: [], findings: [] } }): FlextimeData => ({ listing: list, settlement });

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
function tree(answer: (call: Call) => unknown) {
  const ctx = syntheticContext("ADMIN");
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  let keys = 0;
  const live = liveFrom(ctx, { client, mutate: createMutator("test", () => `idempotency-key-${++keys}`), refresh });
  const View = route.View;
  return { calls, refresh, node: (value: FlextimeData) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider> };
}
async function mount(value: FlextimeData = data(), answer: (call: Call) => unknown = () => ({ entity_id: "x", revision: 1, status: "registered" })) {
  const { node, ...rest } = tree(answer);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node(value)); });
  return { ...rest, show: (next: FlextimeData) => view.rerender(node(next)) };
}

const REGISTER = "フレックスタイム制の採用を登録する";
const CONFIRM = "採用を確認する（影響の確認）";
const ADD = "参加者を追加する";
const CONFIRM_PERSON = "参加を確認する";
const WITHDRAW_PERSON = "参加を取り下げる";
const END = "採用を終了する";
const WITHDRAW = "採用を取り下げる";
const TASKS = [REGISTER, CONFIRM, ADD, CONFIRM_PERSON, WITHDRAW_PERSON, END, WITHDRAW];
const task = (summary: string) => screen.getByText(summary, { selector: "summary" }).closest("details")!;
const field = (summary: string, label: string) => within(task(summary)).getByLabelText(label);
const set = (summary: string, label: string, value: string) => fireEvent.change(field(summary, label), { target: { value } });
const press = (summary: string, name: string) => fireEvent.click(within(task(summary)).getByRole("button", { name }));
const confirm = async (summary: string, name: string) => { await act(async () => { press(summary, name); }); };
const surface = (summary: string) => task(summary).querySelector(".ideal-confirm") as HTMLElement;
const line = (summary: string, term: string) => within(surface(summary)).getByText(term, { selector: "dt" }).parentElement!;
const changes = (summary: string) => within(line(summary, "変更内容")).getAllByRole("listitem").map((item) => item.textContent);
const options = (summary: string, label: string) => within(field(summary, label)).getAllByRole("option").map((option) => option.textContent);
const refusals = (summary: string, label: string) => within(within(task(summary)).getByRole("list", { name: label })).getAllByRole("listitem").map((item) => item.textContent);
const posts = (calls: Call[]) => calls.filter((call) => call.method === "POST");
const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
const NOBODY = "誰にも通知されません。操作後の状態は、管理者のこの画面の一覧に表示されます。操作の記録（操作した役割・版・時刻）は監査の履歴に残ります。";
const CONFLICT = () => new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" }));
const SITE = "事業場1（2024-12-01 〜 2028-12-31）";

test("the route reads the adoptions and the settlement; a missing input version is said, another failure is partial", async () => {
  const { calls, client } = api((call) => (call.path === LIST ? listing() : SETTLED));
  expect(await readRoute(route, client, syntheticContext("ADMIN"))).toEqual({ kind: "ready", partial: [], data: { listing: listing(), settlement: { available: true, result: SETTLED } } });
  expect(calls).toEqual([{ method: "GET", path: LIST, body: undefined }, { method: "GET", path: SETTLEMENTS, body: undefined }]);
  expect(route.names).toBe("none");
  // The input version the URL names is the one the settlement is asked for.
  const named = api((call) => (call.path === LIST ? listing() : SETTLED));
  await readRoute(route, named.client, { ...syntheticContext("ADMIN"), selectedInputHash: "c".repeat(64) });
  expect(named.calls[1].path).toBe(`${SETTLEMENTS}&input_hash=${"c".repeat(64)}`);
  // No input version to compute from yet: the route's own state, not a failure.
  const none = api((call) => { if (call.path === LIST) return listing(); throw new PlanningError(409, "版2の確認済み入力が必要です。旧版の不足情報を推測して変換しません。"); });
  expect(await readRoute(route, none.client, syntheticContext("ADMIN"))).toEqual({ kind: "ready", partial: [], data: { listing: listing(), settlement: { available: false, reason: "版2の確認済み入力が必要です。旧版の不足情報を推測して変換しません。" } } });
  const failed = api((call) => { if (call.path === LIST) return listing(); throw new PlanningError(503, "unavailable"); });
  expect(await readRoute(route, failed.client, syntheticContext("ADMIN"))).toEqual({ kind: "ready", partial: [{ resource: "フレックスタイム制の清算", status: 503, detail: "unavailable" }], data: { listing: listing(), settlement: null } });
  const refused = api(() => { throw new PlanningError(403, "Administrator membership required"); });
  expect(await readRoute(route, refused.client, syntheticContext("ADMIN"))).toEqual({ kind: "problem", status: 403, detail: "Administrator membership required" });
  // The screen without a view resolves to the first view the role has; an unknown view to no route.
  expect(routeDefinition("settings/flextime")).toBe(route);
  expect(routeKey("settings", undefined, "ADMIN")).toBe("settings/appearance");
  expect(routeDefinition("settings/appearance")).toBe(ROUTE_DEFINITIONS["settings/appearance"]);
  expect(routeKey("settings", "no-such-view", "ADMIN")).toBeNull();
});

test("first the current state with the settlement, the next step and the history; no form is open", async () => {
  const withdrawn = adoption({ adoption_id: "flex-old", status: "withdrawn", start: "2026-04-01T00:00:00+09:00", end: "2027-04-01T00:00:00+09:00", created_by: "admin", decided_by: "other", withdrawal_reason: "協定を見直すため" });
  const ended = running({ payload: { ...running().payload, end: "2027-07-01T00:00:00+09:00", end_reason: "合成の終了理由", decided_by: "admin" } });
  const gone = enrollment({ enrollment_id: "flex-run-p1", person_id: "p1", status: "withdrawn", withdrawal_reason: "本人の申出", decided_by: "other" });
  const { calls } = await mount(data(listing({ adoptions: [adoption({ created_by: "admin" }, { actions: { ...adoption().actions, confirm: not(SELF) } }), ended, withdrawn], enrollments: [enrollment({ status: "confirmed", reviewed_by: "admin" }), gone] }), { available: true, result: SETTLED }));
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["採用の状態と次の操作", "現在の状態", "次の操作", "履歴"]);
  expect(screen.getByText("確認待ちの採用 1件")).toBeInTheDocument();
  // Withdrawn adoptions are history; an adoption with an end date is still in effect.
  // A card is a region named by its state, its period and, for assistive technology, its
  // site; on screen the site, with its own period, is the card's first fact.
  const waiting = within(panel("現在の状態")).getByRole("region", { name: `確認待ち 採用の期間 2027-04-01 〜 2028-03-31 、${SITE}` });
  expect(waiting.querySelector("h3 > .sr-only")).toHaveTextContent(`、${SITE}`);
  const facts = (card: HTMLElement) => Array.from(card.querySelectorAll(".ideal-v3-flextime-facts > div")).map((row) => `${row.querySelector("dt")!.textContent}：${row.querySelector("dd")!.textContent!.replace(/\s+/g, " ").trim()}`);
  expect(facts(waiting).slice(0, 1)).toEqual([`事業場：${SITE}`]);
  // What the journey U22 locates and reads (ideal-deep-u19-u27.spec.ts): exactly one region
  // whose name holds 「採用の期間 <first day> 〜」 (the site's own period follows a bracket, so
  // it is never taken for the adoption's), and, in it, the one `dd` that follows the `dt`
  // 「登録」 and the one that follows the `dt` 「確認」, each with exactly the account's name.
  const regions = (name: RegExp) => within(panel("現在の状態")).queryAllByRole("region", { name });
  expect(regions(/採用の期間 2027-04-01 〜/)).toEqual([waiting]);
  expect(regions(/採用の期間 2024-12-01 〜/)).toHaveLength(0);
  const after = (card: HTMLElement, term: string) => Array.from(card.querySelectorAll("dt")).filter((item) => item.textContent === term).map((item) => (item.nextElementSibling?.tagName === "DD" ? item.nextElementSibling.textContent : null));
  expect([after(waiting, "登録"), after(waiting, "確認")]).toEqual([["あなた"], ["まだ確認されていません"]]);
  expect(waiting).toHaveTextContent(`この採用の確認について、サーバーの回答：${SELF}`);
  expect(waiting).toHaveTextContent("参加者はいません。");
  const active = within(panel("現在の状態")).getByRole("region", { name: `採用中 採用の期間 2027-01-01 〜 2027-06-30 、${SITE}` });
  expect(regions(/採用の期間 2027-01-01 〜 2027-06-30/)).toEqual([active]);
  expect([after(active, "登録"), after(active, "確認")]).toEqual([["あなた"], ["別の管理者"]]);
  // The evidence says its state in words, as pills; every pair of facts has a neighbour.
  expect(Array.from(active.querySelectorAll(".ideal-v3-flextime-marks .ideal-pill")).length).toBeGreaterThanOrEqual(2);
  expect(active.querySelectorAll(".ideal-v3-flextime-facts > div:not(.ideal-v3-flextime-facts__wide)").length % 2).toBe(0);
  expect(active).toHaveTextContent("終了：あなた（合成の終了理由）。2027-07-01 から採用しません。");
  // The participants: a row each of the name, the day, the state as a pill and who recorded it.
  expect(within(within(active).getByRole("list", { name: "参加者" })).getAllByRole("listitem").map((item) => Array.from(item.children).filter((part) => !part.classList.contains("sr-only")).map((part) => part.textContent))).toEqual([
    ["薬剤師一", "2027-06-01 から", "採用中", "登録 別の管理者・確認 あなた"], ["薬剤師二", "2027-06-01 から", "取下げ済み", "登録 別の管理者・取下げの理由 本人の申出"],
  ]);
  expect(within(panel("現在の状態")).queryByRole("region", { name: /採用の期間 2026-04-01 〜/ })).toBeNull();
  // The settlement, with the server's numbers and findings.
  expect(within(screen.getByRole("region", { name: "職員別・清算期間別の清算" })).getAllByRole("row").map((item) => item.textContent)).toEqual([
    "職員清算期間総枠実労働各月の時間外（週平均50時間超）最終月に加える時間外割り当てられない時間外",
    "薬剤師一2027-04-01 〜 2027-06-30520:00540:001:3018:300:15",
    "薬剤師二2027-04-01 〜 2027-04-15（途中入社・退職の部分）80:0081:00—1:00—",
  ]);
  expect(within(screen.getByRole("list", { name: "清算で確認が必要な点" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "未確認：雇用条件（※1）：フレックスタイム制の就業規則・労使協定の根拠が、確認済みではありません。", "違反：An untranslated message",
  ]);
  // The key of the record a finding names is not in the sentence on screen: it stands, with
  // the sentence's mark, among the identifiers that open on request.
  expect(panel("現在の状態")).toHaveTextContent("※の付いた記録の識別子は、この下の「清算の識別情報」で確認できます。");
  const keys = screen.getByText("清算の識別情報").closest("details")!;
  expect(keys.open).toBe(false);
  expect(Array.from(keys.querySelectorAll(".ideal-v3-identifiers > div")).map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd code")!.textContent])[0]).toEqual(["※1 雇用条件の識別子：", "emp-1"]);
  expect(screen.getByRole("list", { name: "清算で確認が必要な点" })).not.toHaveTextContent("emp-1");
  // One fact per column: the period names the row; the site and the scope have their own columns.
  expect(within(screen.getByRole("region", { name: "取り下げた採用・終了した採用" })).getAllByRole("row").map((item) => item.textContent)).toEqual([
    "採用の期間事業場対象労働者の範囲区分理由記録した管理者版",
    `2027-01-01 〜 2027-06-30${SITE}開始済みの採用終了合成の終了理由あなた第2版`, `2026-04-01 〜 2027-03-31${SITE}薬剤部の薬剤師取下げ協定を見直すため別の管理者第1版`,
  ]);
  expect(within(screen.getByRole("list", { name: "取り下げた参加" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["薬剤師二：2027-06-01 から（取下げ済み）：本人の申出（記録 別の管理者）"]);
  expect(within(panel("履歴")).getByRole("link", { name: "監査の履歴を開く" })).toHaveAttribute("href", "/workspace/governance/audit");
  for (const summary of TASKS) expect(task(summary).open).toBe(false);
  // What cannot be undone has the danger tone and says so in words; nothing else has either.
  const frame = (summary: string) => task(summary).closest(".ideal-v3-task")!;
  for (const summary of TASKS) {
    const final = [WITHDRAW_PERSON, END, WITHDRAW].includes(summary);
    expect(frame(summary).classList.contains("ideal-v3-task--danger")).toBe(final);
    expect(within(frame(summary) as HTMLElement).queryAllByText("取り消せません").length).toBe(final ? 1 : 0);
  }
  expect(within(task(REGISTER)).getByLabelText("事業場")).not.toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(calls).toEqual([]);
  expect(document.body.innerHTML).not.toMatch(/href="\/(planning|settings|dashboard)/);
  expect(document.body.innerHTML).not.toMatch(/class="[^"]*\b(ui-|workflow-|ideal-v3-purpose)/);
  // Identifiers and status codes are folded away or worded.
  expect(waiting.querySelector("dl")).not.toHaveTextContent(/site-hospital|flex-1|registered|confirmed/);
  expect(within(waiting).getByText("識別情報").closest("details")).toHaveTextContent("採用の識別子：flex-1事業場の識別子：site-hospital雇用主の識別子：hospital登録したアカウント：admin");
});

test("a finding's sentence is split at the record it names, and is never changed", () => {
  const id = (text: string) => ({ text, identifier: true });
  const said = (text: string) => ({ text, identifier: false });
  expect(findingParts("雇用条件 emp-1：2026-10-01 から始まる清算期間の全体が、入力に含まれていません。")).toEqual([said("雇用条件 "), id("emp-1"), said("：2026-10-01 から始まる清算期間の全体が、入力に含まれていません。")]);
  expect(findingParts("雇用条件 emp-1 の清算期間・総枠の条件が、確認済みの採用 flex-1 と一致しません。")).toEqual([said("雇用条件 "), id("emp-1"), said(" の清算期間・総枠の条件が、確認済みの採用 "), id("flex-1"), said(" と一致しません。")]);
  expect(findingParts("採用 flex-1 の協定届の提出日が、採用の開始日より後です。")).toEqual([said("採用 "), id("flex-1"), said(" の協定届の提出日が、採用の開始日より後です。")]);
  // A sentence that names no record in that form, and one that is not translated, are one piece.
  for (const whole of ["フレックスタイム制の職員は始業・終業の時刻を自分で決めるため、時刻付きの勤務を計画できません。", "An untranslated message", ""]) expect(findingParts(whole)).toEqual(whole ? [said(whole)] : []);
  for (const sentence of ["契約 c-1：フレックスタイム制では時刻付きの勤務を割り当てないため、計画上の最低時間を設定できません。", "施設の採用と本人の参加が、雇用条件 emp-9 を覆っていません。"]) expect(findingParts(sentence).map((part) => part.text).join("")).toBe(sentence);
});

test("each record the findings name has one mark, in the order it is first named; its key is listed once among the identifiers", async () => {
  await mount(data(listing(), { available: true, result: { ...SETTLED, input_hash: null, findings: [
    { rule_id: "a", status: "violation", message: "Flextime settlement terms differ from the confirmed adoption flex-1: emp-1" },
    { rule_id: "b", status: "unverified", message: "Flextime work rules or agreement unverified: emp-1" },
    { rule_id: "c", status: "violation", message: "A flextime contract cannot require planned minimum hours: c-1" },
    { rule_id: "d", status: "violation", message: "Flextime settlement overtime has no work in the final month to be attributed to" },
  ] } }));
  expect(within(screen.getByRole("list", { name: "清算で確認が必要な点" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "違反：雇用条件（※1）の清算期間・総枠の条件が、確認済みの採用（※2）と一致しません。",
    "未確認：雇用条件（※1）：フレックスタイム制の就業規則・労使協定の根拠が、確認済みではありません。",
    "違反：契約（※3）：フレックスタイム制では時刻付きの勤務を割り当てないため、計画上の最低時間を設定できません。",
    "違反：清算期間の総枠を超えた時間を、最終月の労働に割り当てられません。",
  ]);
  // Without an input hash the reveal still holds the keys the marks stand for.
  expect(Array.from(screen.getByText("清算の識別情報").closest("details")!.querySelectorAll(".ideal-v3-identifiers > div")).map((row) => [row.querySelector("dt")!.textContent, row.querySelector("dd code")!.textContent])).toEqual([
    ["※1 雇用条件の識別子：", "emp-1"], ["※2 採用の識別子：", "flex-1"], ["※3 契約の識別子：", "c-1"],
  ]);
});

test("what cannot be shown or managed is said in the route's or the server's own words", async () => {
  const view = await mount(data(listing({ can_manage: false, manage_refusal: "施設管理者による確認が必要です", adoptions: [adoption()] }), { available: false, reason: "版2の確認済み入力が必要です。" }));
  expect(panel("現在の状態")).toHaveTextContent("施設管理者による確認が必要です（閲覧のみ）");
  expect(panel("次の操作")).toHaveTextContent("施設管理者による確認が必要です（閲覧のみ）");
  for (const summary of TASKS) expect(screen.queryByText(summary, { selector: "summary" })).toBeNull();
  expect(panel("現在の状態")).toHaveTextContent("清算は、まだ表示できません。サーバーの回答：版2の確認済み入力が必要です。");
  view.show(data(listing(), null));
  expect(panel("現在の状態")).toHaveTextContent("清算を読み込めませんでした。");
  expect(panel("現在の状態")).toHaveTextContent("採用していません（既定）。");
  expect(screen.getByText("採用していません", { selector: ".ideal-pill" })).toBeInTheDocument();
  expect(screen.getByText("取り下げた採用・終了した採用はありません。")).toBeInTheDocument();
  view.show(data());
  expect(panel("現在の状態")).toHaveTextContent("清算の対象となる実績はまだありません。");
});

test("the showcase shows an administrator the adoptions, the settlement and the tasks, ready and empty", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="settings" view="flextime" role="ADMIN" />);
  expect(await screen.findByRole("heading", { level: 2, name: "現在の状態" })).toBeInTheDocument();
  expect(within(panel("現在の状態")).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
    "採用中採用の期間 2026-04-01 〜 2027-03-31、事業場1（2026-04-01 〜 2028-03-31）", "確認待ち採用の期間 2027-04-01 〜 2028-03-31、事業場1（2026-04-01 〜 2028-03-31）", "フレックスタイム制の清算",
  ]);
  expect(panel("現在の状態")).toHaveTextContent("鈴木 悠斗：2026-11-01 から確認待ち登録 あなた");
  expect(within(screen.getByRole("region", { name: "職員別・清算期間別の清算" })).getAllByRole("row")[1]).toHaveTextContent("高橋 葵2026-09-01 〜 2026-09-30171:25174:000:002:34—");
  expect(screen.getByRole("list", { name: "清算で確認が必要な点" })).toHaveTextContent("未確認：雇用条件（※1）：2026-10-01 から始まる清算期間の全体が、入力に含まれていません。");
  expect(screen.getByRole("list", { name: "清算で確認が必要な点" })).not.toHaveTextContent("synthetic-employment-1");
  expect(screen.getByText("清算の識別情報").closest("details")).toHaveTextContent("※1 雇用条件の識別子：synthetic-employment-1");
  expect(screen.getByRole("region", { name: "取り下げた採用・終了した採用" })).toHaveTextContent("対象範囲を見直すため（合成）別の管理者");
  for (const summary of TASKS) expect(screen.getByText(summary, { selector: "summary" })).toBeInTheDocument();
  // What the synthetic answer says the viewer may do is what the tasks offer.
  task(CONFIRM_PERSON).open = true;
  expect(await within(task(CONFIRM_PERSON)).findByText("あなたが確認できる参加はありません。")).toBeInTheDocument();
  expect(refusals(CONFIRM_PERSON, "確認できない参加")).toContain(`鈴木 悠斗：2026-11-01 から（確認待ち）：${SELF}`);
  task(END).open = true;
  set(END, "終了する採用", "synthetic-flex-1");
  expect(options(END, "終了日（この日から採用しない）")).toEqual(["選んでください", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);
  ready.unmount();
  // The settings screen without a view is the appearance route for every role.
  const index = render(<CognitiveWorkspaceShowcase screen="settings" role="ADMIN" />);
  expect(await screen.findByRole("heading", { name: "配色" })).toBeInTheDocument();
  index.unmount();
  render(<CognitiveWorkspaceShowcase screen="settings" view="flextime" role="ADMIN" state="empty" />);
  expect(await screen.findByText(/採用していません（既定）。/)).toBeInTheDocument();
  expect(screen.getByText("清算の対象となる実績はまだありません。")).toBeInTheDocument();
  expect(screen.getByText("取り下げた採用・終了した採用はありません。")).toBeInTheDocument();
  expect(screen.getByText(REGISTER, { selector: "summary" })).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

describe("registering an adoption", () => {
  const TERMS = {
    adoption_id: "flex-2027-04-01-11111111", employer_id: "hospital", establishment_id: "site-hospital", start: "2027-04-01T00:00:00+09:00", end: "2029-01-01T00:00:00+09:00",
    target_scope: "薬剤部の薬剤師", settlement_months: 1, settlement_anchor: "2027-04-01", total_hours_rule: "statutory_frame", agreed_total_description: "清算期間の暦日数 ÷ 7 × 40時間", standard_day_seconds: 28800,
    flexible_time: [{ start: "07:00", end: "20:00" }], core_time: [{ start: "10:00", end: "15:00" }],
    work_rules_evidence: { reference: "就業規則第20条（合成）", status: "verified", verified_by: "人事A", valid_until: null },
    agreement_evidence: { reference: "労使協定（合成）", status: "verified", verified_by: "人事A", valid_until: null },
  };
  const ENROLLED = (person: string) => ({ payload: { enrollment_id: `${TERMS.adoption_id}-${person}`, adoption_id: TERMS.adoption_id, person_id: person, start: "2027-04-01T00:00:00+09:00" } });
  function enter(participants = ["薬剤師一"]) {
    task(REGISTER).open = true;
    set(REGISTER, "事業場", "site-hospital");
    set(REGISTER, "対象労働者の範囲", " 薬剤部の薬剤師 ");
    set(REGISTER, "清算期間の起算日（採用の開始日）", "2027-04-01");
    set(REGISTER, "採用の最終日（この日を含む）", "2028-12-31");
    set(REGISTER, "協定で定めた総労働時間", "清算期間の暦日数 ÷ 7 × 40時間");
    set(REGISTER, "標準となる1日の労働時間（「時間:分」の形。例：7:45）", "8:00");
    set(REGISTER, "フレキシブルタイムの開始", "07:00"); set(REGISTER, "フレキシブルタイムの終了", "20:00");
    set(REGISTER, "コアタイムの開始", "10:00"); set(REGISTER, "コアタイムの終了", "15:00");
    for (const [name, reference] of [["就業規則の規定", "就業規則第20条（合成）"], ["労使協定", "労使協定（合成）"]]) {
      set(REGISTER, `${name}の資料名・参照先`, reference);
      set(REGISTER, `${name}の状態`, "verified");
      set(REGISTER, `${name}の確認責任者`, " 人事A ");
    }
    for (const name of participants) fireEvent.click(field(REGISTER, name));
  }

  test("the answers are checked before anything is sent; the adoption and each participant are then registered", async () => {
    const { calls, refresh } = await mount();
    enter(["薬剤師一", "薬剤師二"]);
    expect(options(REGISTER, "事業場")).toEqual(["選んでください", SITE]);
    expect(hasUnsavedChanges()).toBe(true);
    press(REGISTER, "入力内容を確認する");
    expect(calls).toEqual([]);
    expect(within(surface(REGISTER)).getByRole("heading", { level: 3, name: "2. 登録前の確認" })).toHaveFocus();
    expect(within(surface(REGISTER)).getAllByRole("term").filter((term) => !term.closest(".ideal-v3-identifiers")).map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
    expect(changes(REGISTER)).toEqual([
      `事業場：（なし） → ${SITE}`, "対象労働者の範囲：（なし） → 薬剤部の薬剤師", "清算期間：（なし） → 1か月", "起算日（採用の開始日）：（なし） → 2027-04-01", "採用の最終日：（なし） → 2028-12-31",
      "総労働時間の定め：（なし） → 法定の枠（清算期間の暦日数 ÷ 7 × 40時間）", "協定で定めた総労働時間：（なし） → 清算期間の暦日数 ÷ 7 × 40時間", "標準となる1日の労働時間：（なし） → 8:00",
      "フレキシブルタイム：（なし） → 07:00〜20:00", "コアタイム：（なし） → 10:00〜15:00", "就業規則の規定の根拠：（なし） → 就業規則第20条（合成）（確認済み・人事A）", "労使協定の根拠：（なし） → 労使協定（合成）（確認済み・人事A）",
      "協定届：（なし） → なし", "協定の有効期間の終了日：（なし） → なし", "状態：（なし） → 確認待ち", "参加者（起算日から参加）：（なし） → 薬剤師一、薬剤師二",
    ]);
    expect(line(REGISTER, "作成される版")).toHaveTextContent("採用の記録を新規登録します（第1版、確認待ち）。参加者 2人の参加の記録も、それぞれ第1版（確認待ち）として登録します。");
    expect(line(REGISTER, "通知")).toHaveTextContent(NOBODY);
    expect(line(REGISTER, "競合・部分失敗")).toHaveTextContent("採用が登録された後で参加の登録が失敗したときは、採用は登録されたままで、失敗した参加者とサーバーの理由を知らせます。");
    expect(surface(REGISTER)).toHaveTextContent("登録した管理者とは別の管理者が、影響を表示して確認します。");
    await confirm(REGISTER, "この内容で登録する（確認待ち）");
    // The bodies the established screen sent for the same entries (checked against it when
    // this screen replaced it).
    expect(calls).toEqual([
      { method: "POST", path: LIST, body: { payload: TERMS, idempotency_key: "idempotency-key-1" } },
      { method: "POST", path: ENROLL, body: { ...ENROLLED("p0"), idempotency_key: "idempotency-key-2" } },
      { method: "POST", path: ENROLL, body: { ...ENROLLED("p1"), idempotency_key: "idempotency-key-3" } },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(REGISTER)).getByRole("status")).toHaveTextContent("採用を第1版として登録しました（確認待ち）。別の管理者が影響を確認して確認するまで、フレックスタイム制は有効になりません。");
    expect(within(within(task(REGISTER)).getByRole("list", { name: "参加者の登録結果" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["薬剤師一：参加を登録しました（確認待ち）。", "薬剤師二：参加を登録しました（確認待ち）。"]);
    expect(surface(REGISTER)).toBeNull();
    expect(field(REGISTER, "対象労働者の範囲")).toHaveValue("");
    expect(within(task(REGISTER)).getByRole("heading", { level: 3, name: "1. 採用の内容を入力する" })).toHaveFocus();
    expect(hasUnsavedChanges()).toBe(false);
  });

  test("a settlement period over a month asks for the filing; the weekend rule sends its rest days", async () => {
    const { calls } = await mount();
    enter([]);
    expect(within(task(REGISTER)).queryByLabelText("届出日")).toBeNull();
    set(REGISTER, "清算期間", "3");
    set(REGISTER, "届出日", "2027-03-20"); set(REGISTER, "届出先の労働基準監督署", " 合成労働基準監督署 "); set(REGISTER, "協定の有効期間の終了日", "2028-12-31");
    set(REGISTER, "届出の控えの資料名・参照先", "届出控え（合成）");
    fireEvent.click(field(REGISTER, RULE("full_two_day_weekend")));
    fireEvent.click(field(REGISTER, "日曜日")); fireEvent.click(field(REGISTER, "土曜日"));
    press(REGISTER, "入力内容を確認する");
    expect(changes(REGISTER)).toEqual(expect.arrayContaining([
      "清算期間：（なし） → 3か月", "総労働時間の定め：（なし） → 完全週休2日制の特例（8時間 × 所定労働日数）・毎週の休日：土・日",
      "協定届：（なし） → 2027-03-20 合成労働基準監督署／届出控え（合成）（未確認）", "協定の有効期間の終了日：（なし） → 2028-12-31", "参加者（起算日から参加）：（なし） → なし（後から追加できます）",
    ]));
    await confirm(REGISTER, "この内容で登録する（確認待ち）");
    expect(calls).toEqual([{ method: "POST", path: LIST, body: { idempotency_key: "idempotency-key-1", payload: {
      ...TERMS, settlement_months: 3, total_hours_rule: "full_two_day_weekend", rest_weekdays: [5, 6],
      filing: { filed_on: "2027-03-20", office: "合成労働基準監督署", evidence: { reference: "届出控え（合成）", status: "unverified", verified_by: null, valid_until: null } }, agreement_valid_until: "2028-12-31",
    } } }]);
  });

  test("after a lost response the identical registration goes out again, with the same identity and key", async () => {
    let sends = 0;
    const { calls, refresh } = await mount(data(), () => { if (++sends === 1) throw new TypeError("Failed to fetch"); return { entity_id: "x", revision: 1, status: "registered" }; });
    enter();
    press(REGISTER, "入力内容を確認する");
    await confirm(REGISTER, "この内容で登録する（確認待ち）");
    expect(line(REGISTER, "競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。");
    expect(refresh).not.toHaveBeenCalled();
    await confirm(REGISTER, "同じ内容を再送する");
    expect(calls.map((call) => call.path)).toEqual([LIST, LIST, ENROLL]);
    expect(JSON.stringify(calls[1].body)).toBe(JSON.stringify(calls[0].body));
    expect(calls[1].body).toEqual({ payload: TERMS, idempotency_key: "idempotency-key-1" });
    expect(global.crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("a participant the server refuses is reported by name with its reason; the adoption stays registered", async () => {
    const { refresh } = await mount(data(), (call) => {
      if (call.path === ENROLL && (call.body as ReturnType<typeof ENROLLED>).payload.person_id === "p1") throw new PlanningError(422, JSON.stringify({ detail: "この職員には、期間の重なる参加がすでにあります。" }));
      return { entity_id: "x", revision: 1, status: "registered" };
    });
    enter(["薬剤師一", "薬剤師二"]);
    press(REGISTER, "入力内容を確認する");
    await confirm(REGISTER, "この内容で登録する（確認待ち）");
    expect(within(task(REGISTER)).getByRole("status")).toHaveTextContent("採用を第1版として登録しました（確認待ち）。");
    expect(within(within(task(REGISTER)).getByRole("list", { name: "参加者の登録結果" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "薬剤師一：参加を登録しました（確認待ち）。",
      "薬剤師二：参加を登録できませんでした。この職員には、期間の重なる参加がすでにあります。 一覧を確かめ、登録されていなければ「参加者を追加する」から登録してください。",
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("the server's refusal returns to the fields, under a heading that takes focus, with each message at the field it is about", async () => {
    let refusal: unknown = { detail: "採用は、将来の清算期間の初日から始めてください（さかのぼる採用はできません）。" };
    const { calls, refresh } = await mount(data(), () => { throw new PlanningError(422, JSON.stringify(refusal)); });
    enter();
    press(REGISTER, "入力内容を確認する");
    await confirm(REGISTER, "この内容で登録する（確認待ち）");
    expect(surface(REGISTER)).toBeNull();
    let summary = within(task(REGISTER)).getByRole("region", { name: "サーバーが登録を受け付けませんでした（1件）" });
    expect(within(summary).getByRole("heading", { level: 4 })).toHaveFocus();
    fireEvent.click(within(summary).getByRole("button", { name: "採用は、将来の清算期間の初日から始めてください（さかのぼる採用はできません）。" }));
    expect(field(REGISTER, "清算期間の起算日（採用の開始日）")).toHaveFocus();
    expect(field(REGISTER, "清算期間の起算日（採用の開始日）")).toHaveAttribute("aria-invalid", "true");
    expect(field(REGISTER, "採用の最終日（この日を含む）")).not.toHaveAttribute("aria-invalid");
    expect(field(REGISTER, "対象労働者の範囲")).toHaveValue(" 薬剤部の薬剤師 ");
    expect(refresh).not.toHaveBeenCalled();
    // The messages of the server's record check name their fields; they are worded in Japanese.
    refusal = { detail: "2 validation errors for FlexAdoption\n  Value error, Each core time lies strictly inside the flexible time [type=value_error, input_value={'adoption_id': 'flex'}, input_type=dict]\n    For further information visit https://errors.pydantic.dev/2.12/v/value_error\nstandard_day_seconds\n  Input should be greater than 0 [type=greater_than, input_value=0, input_type=int]\n    For further information visit https://errors.pydantic.dev/2.12/v/greater_than" };
    set(REGISTER, "コアタイムの開始", "06:00");
    press(REGISTER, "入力内容を確認する");
    expect(within(surface(REGISTER)).getByRole("heading", { name: "2. 登録前の確認" })).toHaveFocus();
    await confirm(REGISTER, "この内容で登録する（確認待ち）");
    summary = within(task(REGISTER)).getByRole("region", { name: "サーバーが登録を受け付けませんでした（2件）" });
    expect(within(summary).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["コアタイムは、フレキシブルタイムの内側に収めてください。", "Input should be greater than 0"]);
    expect(field(REGISTER, "コアタイムの開始")).toHaveAttribute("aria-invalid", "true");
    expect(field(REGISTER, "標準となる1日の労働時間（「時間:分」の形。例：7:45）")).toHaveAttribute("aria-invalid", "true");
    // The identity of the entry is kept; the changed entry is a new attempt with a new key.
    expect(posts(calls).map((call) => [(call.body as { payload: { adoption_id: string } }).payload.adoption_id, (call.body as { idempotency_key: string }).idempotency_key])).toEqual([[TERMS.adoption_id, "idempotency-key-1"], [TERMS.adoption_id, "idempotency-key-2"]]);
    // A refusal for another reason (403) is the server's message, without a field.
    refusal = { detail: "フレックス勤務の操作は許可されていません" };
    press(REGISTER, "入力内容を確認する");
    await confirm(REGISTER, "この内容で登録する（確認待ち）");
    expect(within(task(REGISTER)).getByRole("region", { name: "サーバーが登録を受け付けませんでした（1件）" })).toHaveTextContent("フレックス勤務の操作は許可されていません");
  });

  test("an adoption that is already registered is compared and never registered over", async () => {
    const theirs = adoption({ adoption_id: TERMS.adoption_id, target_scope: "先に登録された内容", created_by: "admin" });
    const { calls } = await mount(data(), (call) => { if (call.method === "GET") return listing({ adoptions: [theirs] }); throw CONFLICT(); });
    enter([]);
    press(REGISTER, "入力内容を確認する");
    await confirm(REGISTER, "この内容で登録する（確認待ち）");
    expect(surface(REGISTER)).toHaveTextContent("現在の版は第1版です。");
    expect(within(within(surface(REGISTER)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").map((item) => item.textContent)).toContain("対象労働者の範囲（なし）先に登録された内容薬剤部の薬剤師あり");
    press(REGISTER, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(within(task(REGISTER)).getByRole("status")).toHaveTextContent("この採用は、すでに登録されています（第1版、確認待ち）。重ねて登録はしていません。内容を変えるときは、取り下げてから新しく登録します。");
    expect(posts(calls)).toHaveLength(1);
    expect(surface(REGISTER)).toBeNull();
  });

  test("only the order of a period's two ends is checked here, in a summary that takes focus", async () => {
    const { calls } = await mount();
    enter([]);
    set(REGISTER, "採用の最終日（この日を含む）", "2027-03-31");
    set(REGISTER, "フレキシブルタイムの終了", "06:00");
    // Core time outside flexible time, a start in the past, an unverified source: none is judged here.
    set(REGISTER, "コアタイムの開始", "05:00"); set(REGISTER, "コアタイムの終了", "23:00");
    press(REGISTER, "入力内容を確認する");
    const summary = within(task(REGISTER)).getByRole("region", { name: "入力内容に誤りがあります（2件）" });
    expect(within(summary).getByRole("heading", { level: 4 })).toHaveFocus();
    expect(within(summary).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["採用の最終日は、起算日以降にしてください。", "フレキシブルタイムの終了は、開始より後にしてください。"]);
    expect(field(REGISTER, "採用の最終日（この日を含む）")).toHaveAttribute("aria-invalid", "true");
    expect(surface(REGISTER)).toBeNull();
    expect(calls).toEqual([]);
    expect(entrySlips({ ...emptyForm(), settlement_anchor: "2020-01-01", last_day: "2020-01-01", core_start: "05:00", core_end: "23:00", flexible_start: "07:00", flexible_end: "20:00", standard_day: "1:00" }, String)).toEqual([]);
  });
});

const RULE = (rule: "statutory_frame" | "full_two_day_weekend") => (rule === "statutory_frame" ? "法定の枠（清算期間の暦日数 ÷ 7 × 40時間）" : "完全週休2日制の特例（8時間 × 所定労働日数）");

test("an adoption is named by its site, period, scope and status; a long scope is cut short", () => {
  const names = flexNames(listing());
  expect(adoptionLabel(adoption({ target_scope: "あ".repeat(24) }), names)).toBe(`${SITE}：2027-04-01 〜 2028-03-31・${"あ".repeat(24)}（確認待ち）`);
  expect(adoptionLabel(adoption({ target_scope: "あ".repeat(25), status: "withdrawn" }), names)).toBe(`${SITE}：2027-04-01 〜 2028-03-31・${"あ".repeat(24)}…（取下げ済み）`);
  // An account has no name: it is the viewer or another administrator. Unknown people and sites are said so.
  expect([names.account("admin"), names.account("someone"), names.account(undefined), names.person("p9"), names.site("s9")]).toEqual(["あなた", "別の管理者", "（なし）", "この部署の一覧にない職員", "この部署の一覧にない事業場"]);
});

test("the server's refusals of a registration are worded, never judged, here", () => {
  const id = (field: string) => `f-${field}`;
  expect(refusedRegistration("事業場と雇用主が部署の記録と一致しないか、採用の期間が事業場の期間の外です。", id)).toEqual([{ message: "事業場と雇用主が部署の記録と一致しないか、採用の期間が事業場の期間の外です。", fieldId: "f-establishment_id" }]);
  expect(refusedRegistration("部署の勤務計画の入力がありません。先に入力を登録してください。", id)).toEqual([{ message: "部署の勤務計画の入力がありません。先に入力を登録してください。", fieldId: undefined }]);
  expect(refusedRegistration("1 validation error for FlexAdoption\nflexible_time.0\n  Value error, A time window must end after it starts (local times) [type=value_error, input_value={'start': '20:00'}, input_type=dict]\n    For further information visit https://errors.pydantic.dev/2.12/v/value_error", id))
    .toEqual([{ message: "時間帯の終了は、開始より後にしてください。", fieldId: "f-flexible_start" }]);
  expect(refusedRegistration("1 validation error for FlexAdoption\nwork_rules_evidence\n  Value error, Verified evidence requires a responsible verifier [type=value_error, input_value={}, input_type=dict]", id))
    .toEqual([{ message: "確認済みの根拠には、確認した人が必要です。", fieldId: "f-work_rules" }]);
  expect(refusedRegistration("1 validation error for FlexAdoption\n  Value error, A rule that is not listed [type=value_error, input_value={}, input_type=dict]", id)).toEqual([{ message: "A rule that is not listed", fieldId: undefined }]);
});

describe("confirming an adoption", () => {
  const waiting = () => data(listing({ adoptions: [adoption(), running(), adoption({ adoption_id: "flex-mine", target_scope: "自分で登録した採用", created_by: "admin" }, { actions: { ...adoption().actions, confirm: not(SELF) } })] }));
  const CONFIRMED = { revision: 2, status: "confirmed", confirmed_enrollments: ["flex-1-p0"], enrollments_needing_another_admin: [] };

  test("only the adoptions the server lets the viewer confirm are offered; the others carry its reason", async () => {
    const { calls } = await mount(waiting());
    task(CONFIRM).open = true;
    expect(options(CONFIRM, "確認する採用")).toEqual(["選んでください", `${SITE}：2027-04-01 〜 2028-03-31・薬剤部の薬剤師（確認待ち）（第1版）`]);
    expect(refusals(CONFIRM, "確認できない採用")).toEqual([`${SITE}：2027-01-01 〜 2028-03-31・開始済みの採用（採用中）：${NOT_REGISTERED}`, `${SITE}：2027-04-01 〜 2028-03-31・自分で登録した採用（確認待ち）：${SELF}`]);
    expect(calls).toEqual([]);
  });

  test("when the server allows none, there is no control to confirm with", async () => {
    await mount(data(listing({ adoptions: [adoption({ created_by: "admin" }, { actions: { ...adoption().actions, confirm: not(SELF) } })] })));
    task(CONFIRM).open = true;
    expect(task(CONFIRM)).toHaveTextContent("あなたが確認できる採用はありません。");
    expect(refusals(CONFIRM, "確認できない採用")).toEqual([`${SITE}：2027-04-01 〜 2028-03-31・薬剤部の薬剤師（確認待ち）：${SELF}`]);
    expect(within(task(CONFIRM)).queryByRole("button")).toBeNull();
    expect(within(task(CONFIRM)).queryByRole("combobox")).toBeNull();
  });

  test("the impact is read on demand, shown in the confirmation, and its check value is sent with it", async () => {
    const { calls, refresh } = await mount(waiting(), (call) => (call.method === "GET" ? impact() : CONFIRMED));
    task(CONFIRM).open = true;
    set(CONFIRM, "確認する採用", "flex-1");
    await confirm(CONFIRM, "確認の前に影響を表示する");
    expect(calls).toEqual([{ method: "GET", path: adoptionPath("flex-1", "impact"), body: undefined }]);
    expect(within(surface(CONFIRM)).getByRole("heading", { level: 3, name: "2. 確認すると変わること" })).toHaveFocus();
    expect(changes(CONFIRM)).toEqual(["状態：確認待ち → 採用中", "確認した管理者：（なし） → あなた"]);
    expect(line(CONFIRM, "作成される版")).toHaveTextContent("第1版 → 第2版");
    expect(line(CONFIRM, "通知")).toHaveTextContent(NOBODY);
    expect(line(CONFIRM, "競合・部分失敗")).toHaveTextContent("採用の記録が第1版のままであることと、ここに表示した影響の内容が変わっていないことを照合します。");
    expect(surface(CONFIRM)).toHaveTextContent("参加者 1人：薬剤師一（2027-04-01 から）");
    expect(surface(CONFIRM)).toHaveTextContent("開始日以降の時刻付きの勤務（割当から外す必要があります）：1件");
    expect(within(surface(CONFIRM)).getByRole("list", { name: "確認の後に行うこと" })).toHaveTextContent("参加者ごとに、参加の開始日から始まるフレックスタイム制の雇用条件を登録する");
    await confirm(CONFIRM, "内容と影響を確認して採用する");
    expect(posts(calls)).toEqual([{ method: "POST", path: adoptionPath("flex-1", "confirm"), body: { expected_revision: 1, impact_hash: "a".repeat(64), idempotency_key: "idempotency-key-1" } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(CONFIRM)).getByRole("status")).toHaveTextContent("採用を確認しました（第2版、採用中）。参加者ごとに、参加の開始日から始まるフレックスタイム制の雇用条件を登録してください。");
    expect(within(task(CONFIRM)).getByRole("link", { name: "契約・資格で雇用条件を登録する" })).toHaveAttribute("href", "/workspace/people/contracts");
  });

  test("what the server says stops the confirmation is shown, and no confirmation is offered", async () => {
    const { calls } = await mount(waiting(), () => impact({ blocking: ["就業規則の規定の根拠が確認済みではありません。"] }));
    task(CONFIRM).open = true;
    set(CONFIRM, "確認する採用", "flex-1");
    await confirm(CONFIRM, "確認の前に影響を表示する");
    expect(surface(CONFIRM)).toBeNull();
    expect(within(task(CONFIRM)).getByRole("heading", { level: 3, name: "2. 確認すると変わること（いまは確認できません）" })).toHaveFocus();
    expect(within(task(CONFIRM)).getByRole("list", { name: "確認できない理由" })).toHaveTextContent("就業規則の規定の根拠が確認済みではありません。");
    expect(within(task(CONFIRM)).queryByRole("button", { name: "内容と影響を確認して採用する" })).toBeNull();
    press(CONFIRM, "採用の選択に戻る");
    expect(within(task(CONFIRM)).getByRole("heading", { level: 3, name: "1. 確認する採用を選び、影響を表示する" })).toHaveFocus();
    expect(posts(calls)).toEqual([]);
  });

  test("a changed impact is compared; the confirmation is then bound to the impact read again", async () => {
    const now = impact({ timed_duties: [], impact_hash: "d".repeat(64) });
    let sends = 0;
    let impacts = 0;
    const { calls } = await mount(waiting(), (call) => {
      if (call.path === LIST) return listing({ adoptions: [adoption({}, { revision: 2 })] });
      if (call.method === "GET") return ++impacts === 1 ? impact() : now;
      if (++sends === 1) throw CONFLICT();
      return { ...CONFIRMED, revision: 3, enrollments_needing_another_admin: ["flex-1-p0"] };
    });
    task(CONFIRM).open = true;
    set(CONFIRM, "確認する採用", "flex-1");
    await confirm(CONFIRM, "確認の前に影響を表示する");
    await confirm(CONFIRM, "内容と影響を確認して採用する");
    expect(within(within(surface(CONFIRM)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").map((item) => item.textContent)).toContain("開始日以降の時刻付きの勤務1件0件1件あり");
    expect(within(surface(CONFIRM)).getByRole("button", { name: "内容と影響を確認して採用する" })).toBeDisabled();
    press(CONFIRM, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(CONFIRM)).toHaveTextContent("現在の第2版と、読み直した影響に対する確認として確認し直します。");
    await confirm(CONFIRM, "内容と影響を確認して採用する");
    expect(posts(calls)[1].body).toEqual({ expected_revision: 2, impact_hash: "d".repeat(64), idempotency_key: "idempotency-key-2" });
    expect(within(task(CONFIRM)).getByRole("status")).toHaveTextContent("採用を確認しました（第3版、採用中）。参加 1件は、あなたが登録したかあなた自身の参加のため、別の管理者の確認が必要です。");
  });

  test("an unknown outcome resends the identical confirmation; a failed read of the impact is the task's own problem", async () => {
    let sends = 0;
    let reads = 0;
    const { calls } = await mount(waiting(), (call) => {
      if (call.method === "GET") { if (++reads === 1) throw new PlanningError(503, "unavailable"); return impact(); }
      if (++sends === 1) throw new PlanningError(504, "timeout");
      return CONFIRMED;
    });
    task(CONFIRM).open = true;
    set(CONFIRM, "確認する採用", "flex-1");
    await confirm(CONFIRM, "確認の前に影響を表示する");
    expect(task(CONFIRM)).toHaveTextContent("読み込めませんでした");
    expect(surface(CONFIRM)).toBeNull();
    await confirm(CONFIRM, "確認の前に影響を表示する");
    await confirm(CONFIRM, "内容と影響を確認して採用する");
    await confirm(CONFIRM, "同じ内容を再送する");
    expect(posts(calls)).toHaveLength(2);
    expect(JSON.stringify(posts(calls)[1].body)).toBe(JSON.stringify(posts(calls)[0].body));
  });
});

describe("participants", () => {
  const withRunning = (enrollments: EnrollmentRow[] = []) => data(listing({ adoptions: [running(), adoption({ adoption_id: "flex-gone", status: "withdrawn" }, { settlement_starts: { participant_start: [], end_on: [] }, actions: { ...adoption().actions, add_participant: not("取り下げた採用には参加を登録できません。") } })], enrollments }));

  test("a participant starts on one of the days the server lists; every person of the department can be chosen", async () => {
    const already = enrollment({ status: "confirmed" });
    const { calls, refresh } = await mount(withRunning([already]));
    task(ADD).open = true;
    expect(options(ADD, "参加者を追加する採用")).toEqual(["選んでください", `${SITE}：2027-01-01 〜 2028-03-31・開始済みの採用（採用中）`]);
    expect(refusals(ADD, "参加者を追加できない採用")).toEqual([`${SITE}：2027-04-01 〜 2028-03-31・薬剤部の薬剤師（取下げ済み）：取り下げた採用には参加を登録できません。`]);
    expect(options(ADD, "参加の開始日（清算期間の初日）")).toEqual(["選んでください"]);
    set(ADD, "参加者を追加する採用", "flex-run");
    // Exactly the server's days, whatever today's date is; the server answers for the person.
    expect(options(ADD, "参加の開始日（清算期間の初日）")).toEqual(["選んでください", "2027-06-01", "2027-07-01"]);
    expect(options(ADD, "職員")).toEqual(["選んでください", "薬剤師一", "薬剤師二"]);
    set(ADD, "職員", "p1"); set(ADD, "参加の開始日（清算期間の初日）", "2027-07-01");
    press(ADD, "参加の内容を確認する");
    expect(calls).toEqual([]);
    expect(within(surface(ADD)).getByRole("heading", { level: 3, name: "2. 登録前の確認" })).toHaveFocus();
    expect(changes(ADD)).toEqual(["参加者：（なし） → 薬剤師二", "参加の開始日：（なし） → 2027-07-01", "状態：（なし） → 確認待ち"]);
    expect(line(ADD, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
    expect(line(ADD, "通知")).toHaveTextContent(NOBODY);
    await confirm(ADD, "参加を登録する（確認待ち）");
    expect(calls).toEqual([{ method: "POST", path: ENROLL, body: { payload: { enrollment_id: "flex-run-p1-11111111", adoption_id: "flex-run", person_id: "p1", start: "2027-07-01T00:00:00+09:00" }, idempotency_key: "idempotency-key-1" } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(ADD)).getByRole("status")).toHaveTextContent("薬剤師二 の参加を第1版として登録しました（確認待ち）。");
    expect(hasUnsavedChanges()).toBe(false);
  });

  test("the server's refusal of the chosen person is shown in its words; a lost response resends the same participation", async () => {
    let sends = 0;
    const { calls } = await mount(withRunning(), () => {
      if (++sends === 1) throw new PlanningError(422, JSON.stringify({ detail: "この職員には、期間の重なる参加がすでにあります。" }));
      if (sends === 2) throw new TypeError("Failed to fetch");
      return { entity_id: "x", revision: 1, status: "registered" };
    });
    task(ADD).open = true;
    set(ADD, "参加者を追加する採用", "flex-run"); set(ADD, "職員", "p0"); set(ADD, "参加の開始日（清算期間の初日）", "2027-06-01");
    press(ADD, "参加の内容を確認する");
    await confirm(ADD, "参加を登録する（確認待ち）");
    expect(line(ADD, "競合・部分失敗")).toHaveTextContent("保存していません。サーバーが下の理由で受け付けませんでした。");
    expect(surface(ADD)).toHaveTextContent("この職員には、期間の重なる参加がすでにあります。");
    await confirm(ADD, "参加を登録する（確認待ち）");
    await confirm(ADD, "同じ内容を再送する");
    expect(JSON.stringify(calls[2].body)).toBe(JSON.stringify(calls[1].body));
    expect(calls.map((call) => (call.body as { idempotency_key: string }).idempotency_key)).toEqual(["idempotency-key-1", "idempotency-key-2", "idempotency-key-2"]);
  });

  test("a participation is confirmed only where the server allows; its refusal is shown without a control", async () => {
    const mine = enrollment({ enrollment_id: "flex-run-p1", person_id: "p1", created_by: "admin" }, { actions: { confirm: not(SELF), withdraw: may } });
    const { calls, refresh } = await mount(withRunning([enrollment(), mine]), () => ({ revision: 2, status: "confirmed" }));
    task(CONFIRM_PERSON).open = true;
    expect(options(CONFIRM_PERSON, "確認する参加")).toEqual(["選んでください", "薬剤師一：2027-06-01 から（確認待ち）（第1版）"]);
    expect(refusals(CONFIRM_PERSON, "確認できない参加")).toEqual([`薬剤師二：2027-06-01 から（確認待ち）：${SELF}`]);
    set(CONFIRM_PERSON, "確認する参加", "flex-run-p0");
    press(CONFIRM_PERSON, "内容を確認する");
    expect(within(surface(CONFIRM_PERSON)).getByRole("heading", { level: 3, name: "2. 確認前の確認" })).toHaveFocus();
    expect(changes(CONFIRM_PERSON)).toEqual(["状態：確認待ち → 採用中", "確認した管理者：（なし） → あなた"]);
    expect(line(CONFIRM_PERSON, "作成される版")).toHaveTextContent("第1版 → 第2版");
    await confirm(CONFIRM_PERSON, "この参加を確認する");
    expect(calls).toEqual([{ method: "POST", path: enrollmentPath("flex-run-p0", "confirm"), body: { expected_revision: 1, idempotency_key: "idempotency-key-1" } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(CONFIRM_PERSON)).getByRole("status")).toHaveTextContent("薬剤師一 の参加を確認しました（第2版）。");
  });

  test("with no participation the server allows, the task offers nothing but the reasons", async () => {
    await mount(withRunning([enrollment({ created_by: "admin" }, { actions: { confirm: not(SELF), withdraw: not("開始後の参加は取り下げられません。本人を外すときは、清算期間の初日から通常の雇用条件を登録してください。") } })]));
    task(CONFIRM_PERSON).open = true; task(WITHDRAW_PERSON).open = true;
    expect(task(CONFIRM_PERSON)).toHaveTextContent("あなたが確認できる参加はありません。");
    expect(task(WITHDRAW_PERSON)).toHaveTextContent("取り下げられる参加はありません。");
    expect(refusals(WITHDRAW_PERSON, "取り下げられない参加")).toEqual(["薬剤師一：2027-06-01 から（確認待ち）：開始後の参加は取り下げられません。本人を外すときは、清算期間の初日から通常の雇用条件を登録してください。"]);
    for (const summary of [CONFIRM_PERSON, WITHDRAW_PERSON]) { expect(within(task(summary)).queryByRole("button")).toBeNull(); expect(within(task(summary)).queryByRole("combobox")).toBeNull(); }
  });

  test("a participation is withdrawn with a reason; a conflict is reviewed against the current version", async () => {
    const theirs = enrollment({ status: "confirmed", reviewed_by: "other" }, { revision: 2 });
    let sends = 0;
    const { calls } = await mount(withRunning([enrollment()]), (call) => {
      if (call.method === "GET") return listing({ enrollments: [theirs] });
      if (++sends === 1) throw CONFLICT();
      return { revision: 3, status: "withdrawn" };
    });
    task(WITHDRAW_PERSON).open = true;
    set(WITHDRAW_PERSON, "取り下げる参加", "flex-run-p0");
    expect(within(task(WITHDRAW_PERSON)).getByRole("heading", { level: 3, name: "2. 取り下げる理由を入力する" })).toBeInTheDocument();
    set(WITHDRAW_PERSON, "参加を取り下げる理由（必須）", "本人の申出");
    expect(hasUnsavedChanges()).toBe(true);
    press(WITHDRAW_PERSON, "内容を確認する");
    expect(changes(WITHDRAW_PERSON)).toEqual(["状態：確認待ち → 取下げ済み", "取下げの理由：（なし） → 本人の申出", "取下げを記録した管理者：（なし） → あなた"]);
    // The server has no step that takes a withdrawal back: the confirming button is the destructive one.
    expect(surface(WITHDRAW_PERSON)).toHaveClass("ideal-confirm--danger");
    expect(within(surface(WITHDRAW_PERSON)).getByRole("button", { name: "理由を記録して参加を取り下げる" })).toHaveClass("ideal-button--danger");
    await confirm(WITHDRAW_PERSON, "理由を記録して参加を取り下げる");
    expect(posts(calls)[0]).toEqual({ method: "POST", path: enrollmentPath("flex-run-p0", "withdraw"), body: { expected_revision: 1, reason: "本人の申出", idempotency_key: "idempotency-key-1" } });
    expect(within(within(surface(WITHDRAW_PERSON)).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("状態確認待ち採用中取下げ済みあり");
    press(WITHDRAW_PERSON, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(WITHDRAW_PERSON)).toHaveTextContent("現在の第2版に対する操作として確認し直します。");
    expect(changes(WITHDRAW_PERSON)[0]).toBe("状態：採用中 → 取下げ済み");
    await confirm(WITHDRAW_PERSON, "理由を記録して参加を取り下げる");
    expect(posts(calls)[1].body).toEqual({ expected_revision: 2, reason: "本人の申出", idempotency_key: "idempotency-key-2" });
    expect(within(task(WITHDRAW_PERSON)).getByRole("status")).toHaveTextContent("薬剤師一 の参加を取り下げました（第3版、取下げ済み）。");
  });

  test("a record the server no longer lets the viewer decide is left alone after the review", async () => {
    const closed = enrollment({ status: "confirmed" }, { revision: 2, actions: { confirm: may, withdraw: not("開始後の参加は取り下げられません。") } });
    const { calls } = await mount(withRunning([enrollment()]), (call) => { if (call.method === "GET") return listing({ enrollments: [closed] }); throw CONFLICT(); });
    task(WITHDRAW_PERSON).open = true;
    set(WITHDRAW_PERSON, "取り下げる参加", "flex-run-p0");
    set(WITHDRAW_PERSON, "参加を取り下げる理由（必須）", "本人の申出");
    press(WITHDRAW_PERSON, "内容を確認する");
    await confirm(WITHDRAW_PERSON, "理由を記録して参加を取り下げる");
    press(WITHDRAW_PERSON, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(within(task(WITHDRAW_PERSON)).getByRole("status")).toHaveTextContent("この操作は行っていません。開始後の参加は取り下げられません。");
    expect(surface(WITHDRAW_PERSON)).toBeNull();
    expect(posts(calls)).toHaveLength(1);
  });
});

describe("ending and withdrawing an adoption", () => {
  const both = () => data(listing({ adoptions: [adoption(), running()] }));

  test("an adoption ends on one of the server's days, with a reason", async () => {
    const { calls, refresh } = await mount(both(), () => ({ revision: 3, status: "confirmed", end: "2027-07-01T00:00:00+09:00", withdrawn_enrollments: ["flex-run-p1"] }));
    task(END).open = true;
    expect(options(END, "終了する採用")).toEqual(["選んでください", `${SITE}：2027-01-01 〜 2028-03-31・開始済みの採用（採用中）（第2版）`]);
    expect(refusals(END, "終了できない採用")).toEqual([`${SITE}：2027-04-01 〜 2028-03-31・薬剤部の薬剤師（確認待ち）：${NOT_ENDABLE}`]);
    set(END, "終了する採用", "flex-run");
    // Exactly the days the server listed for this adoption.
    expect(options(END, "終了日（この日から採用しない）")).toEqual(["選んでください", "2027-06-01", "2027-07-01"]);
    set(END, "終了日（この日から採用しない）", "2027-07-01");
    set(END, "終了する理由（必須）", "合成の清算期間境界で終了");
    press(END, "内容を確認する");
    expect(calls).toEqual([]);
    expect(within(surface(END)).getByRole("heading", { level: 3, name: "3. 終了前の確認" })).toHaveFocus();
    expect(changes(END)).toEqual(["採用の期間：2027-01-01 〜 2028-03-31 → 2027-01-01 〜 2027-06-30", "取下げ・終了の理由：（なし） → 合成の清算期間境界で終了", "取下げ・終了を記録した管理者：（なし） → あなた"]);
    expect(line(END, "作成される版")).toHaveTextContent("第2版 → 第3版");
    expect(line(END, "通知")).toHaveTextContent(NOBODY);
    expect(line(END, "競合・部分失敗")).toHaveTextContent("この採用の記録が第2版のままであることを照合します。違っていれば何も変更せず、競合として知らせます。終了日以降に始まる参加は、同じ処理で取り下げられます。");
    expect(within(surface(END)).getByRole("button", { name: "理由を記録して終了する" })).toHaveClass("ideal-button--danger");
    await confirm(END, "理由を記録して終了する");
    expect(calls).toEqual([{ method: "POST", path: adoptionPath("flex-run", "end"), body: { expected_revision: 2, end_on: "2027-07-01", reason: "合成の清算期間境界で終了", idempotency_key: "idempotency-key-1" } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(END)).getByRole("status")).toHaveTextContent("採用を 2027-07-01 で終了します（第3版）。終了日以降に始まる参加 1件を取り下げました。参加者の雇用条件を、終了日から通常の労働時間制で登録し直してください。");
    expect(within(task(END)).getByRole("heading", { level: 3, name: "1. 終了する採用を選ぶ" })).toHaveFocus();
  });

  test("the server's refusal of an end is shown in its words; an unknown outcome resends the identical end", async () => {
    let sends = 0;
    const { calls } = await mount(both(), () => {
      if (++sends === 1) throw new PlanningError(422, JSON.stringify({ detail: "終了日は、採用期間内の将来の清算期間の初日にしてください。" }));
      if (sends === 2) throw new PlanningError(500, "error");
      return { revision: 3, status: "confirmed", end: "2027-06-01T00:00:00+09:00", withdrawn_enrollments: [] };
    });
    task(END).open = true;
    set(END, "終了する採用", "flex-run"); set(END, "終了日（この日から採用しない）", "2027-06-01"); set(END, "終了する理由（必須）", "理由");
    press(END, "内容を確認する");
    await confirm(END, "理由を記録して終了する");
    expect(surface(END)).toHaveTextContent("終了日は、採用期間内の将来の清算期間の初日にしてください。");
    await confirm(END, "理由を記録して終了する");
    await confirm(END, "同じ内容を再送する");
    expect(JSON.stringify(calls[2].body)).toBe(JSON.stringify(calls[1].body));
    expect(within(task(END)).getByRole("status")).toHaveTextContent("採用を 2027-06-01 で終了します（第3版）。参加者の雇用条件を");
  });

  test("an adoption is withdrawn with a reason where the server allows it", async () => {
    const { calls, refresh } = await mount(both(), () => ({ revision: 2, status: "withdrawn" }));
    task(WITHDRAW).open = true;
    expect(options(WITHDRAW, "取り下げる採用")).toEqual(["選んでください", `${SITE}：2027-04-01 〜 2028-03-31・薬剤部の薬剤師（確認待ち）（第1版）`]);
    expect(refusals(WITHDRAW, "取り下げられない採用")).toEqual([`${SITE}：2027-01-01 〜 2028-03-31・開始済みの採用（採用中）：${STARTED}`]);
    set(WITHDRAW, "取り下げる採用", "flex-1");
    set(WITHDRAW, "取り下げる理由（必須）", "協定を見直すため");
    press(WITHDRAW, "内容を確認する");
    expect(changes(WITHDRAW)).toEqual(["状態：確認待ち → 取下げ済み", "取下げ・終了の理由：（なし） → 協定を見直すため", "取下げ・終了を記録した管理者：（なし） → あなた"]);
    expect(within(surface(WITHDRAW)).getByRole("button", { name: "理由を記録して取り下げる" })).toHaveClass("ideal-button--danger");
    expect(surface(WITHDRAW)).toHaveTextContent("取り下げた採用は元に戻せません。");
    await confirm(WITHDRAW, "理由を記録して取り下げる");
    expect(calls).toEqual([{ method: "POST", path: adoptionPath("flex-1", "withdraw"), body: { expected_revision: 1, reason: "協定を見直すため", idempotency_key: "idempotency-key-1" } }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(within(task(WITHDRAW)).getByRole("status")).toHaveTextContent("採用を取り下げました（第2版、取下げ済み）。");
  });

  test("a record that is gone after a conflict is said so, and nothing more is sent", async () => {
    const { calls } = await mount(both(), (call) => { if (call.method === "GET") return listing(); throw CONFLICT(); });
    task(WITHDRAW).open = true;
    set(WITHDRAW, "取り下げる採用", "flex-1");
    set(WITHDRAW, "取り下げる理由（必須）", "理由");
    press(WITHDRAW, "内容を確認する");
    await confirm(WITHDRAW, "理由を記録して取り下げる");
    expect(surface(WITHDRAW)).toHaveTextContent("現在、この記録はサーバーにありません。");
    press(WITHDRAW, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(within(task(WITHDRAW)).getByRole("status")).toHaveTextContent("この記録は、現在サーバーにありません。操作は行っていません。");
    expect(posts(calls)).toHaveLength(1);
  });
});

// The route arrives as server HTML. Its tasks have no field until React attaches, so
// nothing can be typed into a form that could not keep it.
describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("the server HTML holds the state and the closed tasks without fields; a task opened there stays open and gets its form", async () => {
    const { node, calls } = tree(() => ({}));
    const value = data(listing({ adoptions: [adoption()] }), { available: true, result: SETTLED });
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node(value));
    expect(container.innerHTML).toContain("現在の状態");
    expect(container.innerHTML).toContain("職員別・清算期間別の清算");
    expect(container.innerHTML).toContain(REGISTER);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    const register = within(container).getByText(REGISTER, { selector: "summary" }).closest("details")!;
    register.open = true;
    await act(async () => { root = hydrateRoot(container, node(value)); });
    expect(register.open).toBe(true);
    expect(within(register).getByLabelText("対象労働者の範囲")).toBeVisible();
    expect(within(container).getByText(WITHDRAW, { selector: "summary" }).closest("details")!.querySelector("select")).not.toBeNull();
    expect(calls).toEqual([]);
  });
});
