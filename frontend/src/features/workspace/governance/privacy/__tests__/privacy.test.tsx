import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { PlanningError } from "@/lib/planningTransport";
import { TYPED, shownTimes, unmarked } from "../../../shared/__fixtures__/typed";
import { hasUnsavedChanges } from "../../../shared/useUnsavedNavigation";
import { ROUTE_DEFINITIONS, routeKey } from "../../../shell/routes";
import { readRoute } from "../../../shell/routeTypes";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import { COMPLETION, DECISION, DEPARTMENT_HOLD, HOLD, HOLD_RELEASE, NEW_HOLD, NEW_RULE, PEOPLE, POLICY, REQUEST, RULE } from "../__fixtures__/bodies";
import { CLOSED_CASE, NOBODY, READ, SCOPE, VERIFIED_CASE, api, changes, done, field, keyed, line, listed, listing, mount, open, panel, posts, press, set, surface, task, tick, tree, type Call } from "../__fixtures__/harness";
import { privacyOf } from "../model";
import { TASKS } from "../PrivacyTasks";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
afterEach(() => jest.restoreAllMocks());

const conflict = () => new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" }));
const ADMIN_TASKS = [TASKS.decide, TASKS.rule, TASKS.hold, TASKS.control, TASKS.plan, TASKS.copies, TASKS.register, TASKS.backfill, TASKS.inputs];

test("the route reads the privacy listing once and nothing an administrator's task needs", async () => {
  const { calls, client } = api(() => listing());
  expect(await readRoute(route, client, syntheticContext("ADMIN"))).toEqual({ kind: "ready", partial: [], data: privacyOf(listing()) });
  expect(calls).toEqual([{ method: "GET", path: READ, body: undefined }]);
  // The privacy purpose: the context skips publications and notifications, so the route is
  // reachable while an approved use restriction blocks the ordinary planning reads.
  expect(route.names).toBe("privacy");
  const restricted = { ...syntheticContext("PHARMACIST"), publications: [], publication: null, notifications: [], notificationsRead: false };
  const own = api(() => listing({ cases: [{ ...VERIFIED_CASE, allowed_next: [], result_reference_required: [] }], rules: [], holds: [], people: [PEOPLE[0]] }));
  expect(await readRoute(route, own.client, restricted)).toMatchObject({ kind: "ready", data: { rules: [], holds: [], people: [PEOPLE[0]] } });
  expect(own.calls.map((call) => call.path)).toEqual([READ]);
  const refused = api(() => { throw new PlanningError(403, JSON.stringify({ detail: "No active membership in this facility/department" })); });
  expect(await readRoute(route, refused.client, syntheticContext("ADMIN"))).toMatchObject({ kind: "problem", status: 403 });
  expect(ROUTE_DEFINITIONS["governance/privacy"]).toBe(route);
  // The only view of the screen a pharmacist has: the screen without a view opens it.
  expect(routeKey("governance", undefined, "PHARMACIST")).toBe("governance/privacy");
});

test("an administrator first sees the requests, the rules, the holds, the next steps and the history; no form is open and nothing is read", async () => {
  const { calls } = await mount();
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["本人対応の状態と次の操作", "現在の状態", "次の操作", "履歴"]);
  expect(within(screen.getByRole("region", { name: "本人対応の請求" })).getAllByRole("row").map((item) => item.textContent)).toEqual([
    "職員請求の種類請求の内容状態版次にできる判断",
    "合成 一消去合成のerase本人確認済み第2版実施承認、理由を付して不承認",
    "合成 二開示合成のaccess実施承認第3版実施完了、利用停止を解除",
    "合成 一訂正合成のrectify理由を付して不承認第2版なし",
  ]);
  // Two different stages never look the same: the tone is a fixed table of the status code.
  expect(Array.from(screen.getByRole("region", { name: "本人対応の請求" }).querySelectorAll("tbody .ideal-pill")).map((pill) => pill.className.replace("ideal-pill ideal-pill--", ""))).toEqual(["info", "good", "neutral"]);
  expect(screen.getByText("次の判断ができる請求 2件")).toBeInTheDocument();
  expect(panel("現在の状態")).toHaveTextContent("請求の対象として選択中の職員：佐藤 美咲（あなた）。");
  expect(within(screen.getByRole("region", { name: "保存規則" })).getAllByRole("row").map((item) => item.textContent)).toEqual([
    "対象データ種別保存期間の起算保存日数適用期間根拠の状態次回確認日版",
    "勤務表と入力履歴対象期間の終了30日（法定の最低 0日）2026-01-01 〜 2027-01-01（終了日を含まない）未確認2026-12-01第1版",
  ]);
  expect(screen.getByRole("heading", { level: 3, name: "法的保全（保全中 1件）" })).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "法的保全" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["合成 一：保全中（第1版）。理由：当初の理由"]);
  // Each request, then its versions in order: one line per decision, not a chain in one line.
  const history = screen.getByRole("list", { name: "請求ごとの判断の記録" });
  expect(Array.from(history.children).map((item) => [item.querySelector(":scope > strong")?.textContent, ...within(item as HTMLElement).getAllByRole("listitem").map((step) => Array.from(step.children).map((part) => part.textContent))])).toEqual([
    ["合成 一・消去", ["第1版", "受付"], ["第2版", "本人確認済み", "理由：本人確認済み"]], ["合成 二・開示", ["第1版", "受付"]], ["合成 一・訂正", ["第1版", "受付"]],
  ]);
  expect(panel("履歴")).toHaveTextContent("判断した時刻と操作した役割は、この画面には表示されません。監査の履歴で確認できます。");
  expect(document.body).not.toHaveTextContent("API");
  expect(within(panel("履歴")).getByRole("link", { name: "監査の履歴を開く" })).toHaveAttribute("href", "/workspace/governance/audit");
  for (const summary of [TASKS.request, ...ADMIN_TASKS]) expect(task(summary).open).toBe(false);
  // Identifiers are collapsed; names and labels are what is read.
  const identifiers = within(panel("現在の状態")).getByText("識別情報").closest("details")!;
  expect(identifiers.open).toBe(false);
  expect(identifiers).toHaveTextContent("請求の識別子：case-erase");
  expect(identifiers).toHaveTextContent("職員の識別子：p1");
  // One form for identifiers everywhere: what each is of, then the identifier as code.
  expect(identifiers.querySelector("dl")).toHaveClass("ideal-definition-list", "ideal-v3-identifiers");
  expect(Array.from(identifiers.querySelectorAll("dd code")).map((code) => code.textContent)).toContain("case-erase");
  expect(screen.getByRole("region", { name: "本人対応の請求" })).not.toHaveTextContent(/case-|VERIFIED|APPROVED|p1/);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(calls).toEqual([]);
  expect(document.body.innerHTML).not.toMatch(/href="\/(planning|settings|dashboard)/);
  expect(document.body.innerHTML).not.toMatch(/class="[^"]*\b(ui-|workflow-|ideal-v3-purpose)/);
  expect(document.querySelector("dialog")).toBeNull();
});

test("the next steps are five groups in the order of the tasks; what cannot be undone says so in words, and the count leads to the decision", async () => {
  Element.prototype.scrollIntoView = jest.fn();
  const { calls, show } = await mount();
  const next = panel("次の操作");
  expect(Array.from(next.querySelectorAll(":scope > .ideal-v3-record > section > h3")).map((heading) => heading.textContent)).toEqual(["請求", "保存規則と法的保全", "職員ごとの消去", "記録の整備", "保存期限を過ぎた勤務入力"]);
  // The order of the tasks is the order they were always in.
  // (A task is the reveal of a task frame; a reveal of background inside a group or a task is not one.)
  expect(Array.from(next.querySelectorAll(".ideal-v3-task > details > summary")).map((summary) => summary.textContent)).toEqual(Object.values(TASKS));
  // What explains the three tasks on one person's records is cut to the order and that
  // opening changes nothing; how they depend on one another and the words they use are a
  // reveal of background, closed, before the tasks.
  const sequence = next.querySelector(".ideal-v3-governance-sequence")!.parentElement!;
  expect(sequence.querySelector(":scope > p.ideal-note")).toHaveTextContent(/^職員1人の記録を消去するときは、まず人物制御を適用し（手順1）、次にその職員の消去計画を作って実行します（手順2）。どの操作も、開いただけでは何も変わりません。$/);
  const background = sequence.querySelector<HTMLDetailsElement>(":scope > details.ideal-v3-disclosure--info")!;
  expect(background.open).toBe(false);
  expect(background.querySelector("summary")).toHaveTextContent("3つの操作の関係と、この欄で使うことば");
  expect(Array.from(background.querySelectorAll("li")).map((item) => item.textContent)).toEqual(["手順2は、手順1を適用した職員にだけ実行できます（サーバーが確かめます）。", "3つ目の操作は、同じ登録済みのコピーの確認と消去を、人物制御を条件にせずに行います。外部管理先の処理確認と保全の判断は、3つ目の操作で記録します。"]);
  expect(Array.from(background.querySelectorAll("dt")).map((item) => item.textContent)).toEqual(["人物制御", "消去計画・確認版", "DB記録・管理ファイル"]);
  // The look is fixed where the tasks are declared, never worked out from the listing.
  const looks = Object.fromEntries(Array.from(next.querySelectorAll(".ideal-v3-task")).map((frame) => [frame.querySelector("summary")!.textContent, [frame.className.replace("ideal-v3-task ideal-v3-task--", ""), frame.querySelector(".ideal-v3-task__hint > .ideal-pill")?.textContent ?? null]]));
  expect(looks).toEqual({
    [TASKS.request]: ["routine", null], [TASKS.decide]: ["primary", null], [TASKS.rule]: ["routine", null], [TASKS.hold]: ["routine", null],
    [TASKS.control]: ["danger", "取り消せません"], [TASKS.plan]: ["danger", "消去は取り消せません"], [TASKS.copies]: ["danger", "消去は取り消せません"],
    [TASKS.register]: ["routine", null], [TASKS.backfill]: ["routine", null], [TASKS.inputs]: ["danger", "消去は取り消せません"],
  });
  for (const summary of Object.values(TASKS)) {
    const described = screen.getByText(summary, { selector: "summary" });
    expect(described.textContent).toBe(summary);
    expect(described).toHaveAccessibleDescription(/ます。/);
  }
  // From the count to its task: a button of the page, which opens the task and reads nothing.
  const jump = screen.getByRole("button", { name: "判断する" });
  expect(jump.closest("section")).toBe(screen.getByText("次の判断ができる請求 2件").closest("section"));
  fireEvent.click(jump);
  expect(task(TASKS.decide).open).toBe(true);
  expect(screen.getByText(TASKS.decide, { selector: "summary" })).toHaveFocus();
  for (const summary of ADMIN_TASKS.filter((name) => name !== TASKS.decide)) expect(task(summary).open).toBe(false);
  expect(calls).toEqual([]);
  // No request accepts a decision: the count says so and there is nothing to lead to.
  show(listing({ cases: [CLOSED_CASE] }));
  expect(screen.getByText("次の判断ができる請求なし")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "判断する" })).toBeNull();
});

test("each task that cannot be undone shows its steps before its first field, and says at which step something is erased", async () => {
  await mount((call) => (call.path.includes("/erasure-candidates") ? { observed_at: "2026-10-05T09:00:00+09:00", inputs: [] } : {}));
  const outline = async (summary: string) => { const details = await open(summary); const group = within(details).getByRole("group", { name: summary }); const first = group.querySelector(".ideal-v3-record")!.firstElementChild!; return { steps: within(first as HTMLElement).getAllByRole("listitem").map((item) => item.textContent), text: first.textContent }; };
  // The numbers are those of the task's own headings; the last step is the one named in words.
  expect((await outline(TASKS.control)).steps).toEqual(["1対象の職員を選ぶ", "2いまの状態を確かめ、もとにする判断と理由を入力する", "3内容を確かめて、人物制御を適用する取り消せない手順"]);
  expect((await outline(TASKS.control)).text).toContain("この操作では、記録もコピーも消去しません。");
  expect((await outline(TASKS.plan)).steps).toHaveLength(5);
  expect((await outline(TASKS.plan)).text).toContain("手順1〜4では、何も消去されません。");
  expect((await outline(TASKS.copies)).steps).toHaveLength(4);
  expect((await outline(TASKS.copies)).text).toContain("手順1〜3では、何も消去されません。");
  expect((await outline(TASKS.inputs)).steps).toHaveLength(3);
  expect((await outline(TASKS.inputs)).text).toContain("手順1・2では、何も消去されません。");
  // The order of the three tasks on one person's records is said in their descriptions.
  // The server enforces one order only: the plan needs the control (subject_controls.py).
  // The third task needs neither and is not numbered as a step after them.
  for (const [summary, step] of [[TASKS.control, "手順1"], [TASKS.plan, "手順2"], [TASKS.copies, "人物制御の適用は条件ではありません"]] as const) expect(screen.getByText(summary, { selector: "summary" })).toHaveAccessibleDescription(new RegExp(step));
  expect(screen.getByText(TASKS.copies, { selector: "summary" })).not.toHaveAccessibleDescription(/手順3/);
  // A record written before the last step that cannot be taken back is said at its step.
  expect((await outline(TASKS.copies)).steps[2]).toBe("3消去されるものと残る理由を確かめる取り消せない記録を含むことがあります");
  expect((await outline(TASKS.copies)).text).toContain("「外部管理先の処理確認」を記録すると、その記録は取り消せません");
  expect((await outline(TASKS.plan)).text).toContain("「共同消去判断」を記録すると、その判断は記録として残ります。記録し直せますが、取り下げる操作はありません。");
  // The step that may write such a record says so beside its name; what exactly it writes is
  // a reveal under the outline's sentence, closed until it is asked for.
  expect((await outline(TASKS.plan)).steps[3]).toBe("4消去されるものと残るものを確かめる取り下げられない記録を含むことがあります");
  for (const summary of [TASKS.plan, TASKS.copies]) {
    const more = task(summary).querySelector<HTMLDetailsElement>(".ideal-v3-governance-outline > details")!;
    expect(more.open).toBe(false);
    expect(more.querySelector("summary")).toHaveTextContent("最後の手順より前に残る記録");
  }
  expect(task(TASKS.control).querySelector(".ideal-v3-governance-outline > details")).toBeNull();
});

test("a legal hold shows its state as a word beside the name, and a released one is told apart from one in force", async () => {
  const { show } = await mount(undefined, listing({ holds: [HOLD, { ...HOLD, hold_id: "hold-2", revision: 2, active: false, person_id: null, payload: {} }] }));
  const holds = within(screen.getByRole("list", { name: "法的保全" })).getAllByRole("listitem");
  expect(holds.map((item) => item.textContent)).toEqual(["合成 一：保全中（第1版）。理由：当初の理由", "部署全体：解除済み（第2版）。理由：（なし）"]);
  expect(holds.map((item) => [item.className, item.querySelector(".ideal-pill")?.className])).toEqual([["is-active", "ideal-pill ideal-pill--warn"], ["", "ideal-pill ideal-pill--neutral"]]);
  expect(screen.getByRole("heading", { level: 3, name: "法的保全（保全中 1件）" })).toBeInTheDocument();
  // The server looks for a hold in every department of the facility; the list is this
  // department's. That is said under the list whether or not this department has a hold,
  // so that a refusal caused by another department's hold has its reason on the screen.
  const section = () => screen.getByRole("heading", { level: 3, name: /^法的保全/ }).closest("section")!;
  expect(section()).toHaveTextContent("保全中の職員には、人物制御の適用も消去の実行もできません。「部署全体」の保全が保全中のあいだは、どの職員にもできません（サーバーが受け付けません）。同じ施設のほかの部署の保全も同じように止めますが、その保全はこの一覧には出ません。");
  show(listing({ holds: [] }));
  expect(section()).toHaveTextContent("法的保全の記録はありません。同じ施設のほかの部署で、対象の職員または部署全体が保全中のときも、サーバーは人物制御の適用と消去の実行を受け付けません。その保全は、この一覧には出ません。");
  // A hold that was released stops nobody: only the sentence about the other departments is said.
  show(listing({ holds: [{ ...HOLD, active: false }] }));
  expect(section()).not.toHaveTextContent("保全中の職員には");
  expect(section()).toHaveTextContent("その保全は、この一覧には出ません。");
});

test("a rule revised several times is listed once per data kind and anchor, at its newest revision", async () => {
  await mount(undefined, listing({ rules: [
    { key: "a", revision: 1, payload: POLICY }, { key: "b", revision: 2, payload: { ...POLICY, retention_days: 60 } },
    { key: "c", revision: 1, payload: { ...POLICY, anchor: "last_activity", retention_days: 10 } }, { key: "d", revision: 1, payload: { ...POLICY, category: "control", anchor: "case_closed" } },
  ], holds: [], cases: [] }));
  expect(within(screen.getByRole("region", { name: "保存規則" })).getAllByRole("row").slice(1).map((item) => item.textContent?.slice(0, 22))).toEqual([
    "消去・保全・復元制御本人対応の終了30日（法", "勤務表と入力履歴最終更新・受渡し10日（法定", "勤務表と入力履歴対象期間の終了60日（法定の",
  ]);
  expect(screen.getByText("次の判断ができる請求なし")).toBeInTheDocument();
  expect(screen.getByText("この部署の請求はありません。")).toBeInTheDocument();
  expect(screen.getByText("法的保全の記録はありません。")).toBeInTheDocument();
});

test("a pharmacist sees their own requests and one task; nothing an administrator does is offered", async () => {
  const mine = listing({ cases: [{ ...VERIFIED_CASE, payload: { ...VERIFIED_CASE.payload, person_id: "synthetic-pharmacist" }, allowed_next: [], result_reference_required: [] }], rules: [], holds: [], people: [{ person_id: "synthetic-pharmacist", name: "高橋 葵" }] });
  const { calls } = await mount(undefined, mine, "PHARMACIST");
  expect(within(screen.getByRole("region", { name: "本人対応の請求" })).getAllByRole("row").map((item) => item.textContent)).toEqual(["職員請求の種類請求の内容状態版", "高橋 葵消去合成のerase本人確認済み第2版"]);
  expect(screen.getByText("あなたの請求 1件")).toBeInTheDocument();
  expect(panel("現在の状態")).toHaveTextContent("請求の対象として選択中の職員：高橋 葵（あなた）。あなた自身の請求だけを出せます。");
  expect(screen.queryByRole("region", { name: "保存規則" })).toBeNull();
  expect(screen.queryByRole("heading", { name: /法的保全/ })).toBeNull();
  expect(task(TASKS.request).open).toBe(false);
  for (const summary of ADMIN_TASKS) expect(screen.queryByText(summary)).toBeNull();
  expect(Array.from(panel("次の操作").querySelectorAll(":scope > .ideal-v3-record > section > h3")).map((heading) => heading.textContent)).toEqual(["請求"]);
  expect(screen.queryByRole("button", { name: "判断する" })).toBeNull();
  expect(panel("次の操作")).toHaveTextContent("請求の判断、保存規則の改定、法的保全、人物制御、コピーと旧勤務入力の確認と消去は、サーバーが管理者にだけ許可しています。");
  expect(screen.queryByRole("link", { name: "監査の履歴を開く" })).toBeNull();
  expect(panel("履歴")).toHaveTextContent("監査の履歴は管理者が確認できます。");
  expect(calls).toEqual([]);
});

test("the showcase renders the route for both roles from fictitious answers, with data and without", async () => {
  global.fetch = jest.fn(() => { throw new Error("no network"); }) as never;
  const admin = render(<CognitiveWorkspaceShowcase screen="governance" view="privacy" role="ADMIN" />);
  expect(await screen.findByText("次の判断ができる請求 2件")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "本人対応の請求" })).getAllByRole("row")[1]).toHaveTextContent("高橋 葵開示自分の勤務記録の開示受付第1版本人確認済み、理由を付して不承認");
  expect(screen.getByRole("region", { name: "保存規則" })).toBeInTheDocument();
  admin.unmount();
  const pharmacist = render(<CognitiveWorkspaceShowcase screen="governance" view="privacy" role="PHARMACIST" />);
  expect(await screen.findByText("あなたの請求 1件")).toBeInTheDocument();
  expect(screen.queryByText(TASKS.decide)).toBeNull();
  expect(screen.queryByText(/鈴木 悠斗/)).toBeNull();
  pharmacist.unmount();
  const empty = render(<CognitiveWorkspaceShowcase screen="governance" view="privacy" role="ADMIN" state="empty" />);
  expect(await screen.findByText("この部署の請求はありません。")).toBeInTheDocument();
  empty.unmount();
  render(<CognitiveWorkspaceShowcase screen="governance" view="privacy" role="PHARMACIST" state="empty" />);
  expect(await screen.findByText("あなたの請求はありません。")).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

describe("filing a request", () => {
  const SEND = `/compliance/privacy/requests?${SCOPE}`;
  const SAVED = { case_id: "new-case", revision: 1, status: "REQUESTED" };
  async function fill() { await open(TASKS.request); set(TASKS.request, "請求の種類", "erase"); set(TASKS.request, "対象と理由", "合成の消去請求"); await press(TASKS.request, "請求の内容を確認する"); }

  test("an administrator files for the person the URL names: confirmed first, then the body the established screen sent", async () => {
    const { calls, refresh } = await mount(() => SAVED, listing(), "ADMIN", { selectedPersonId: "p1" });
    expect(panel("現在の状態")).toHaveTextContent("請求の対象として選択中の職員：合成 一。この職員の請求を、管理者として代わりに出せます。");
    await fill();
    expect(within(surface(TASKS.request)!).getByRole("heading", { name: "2. 請求前の確認" })).toHaveFocus();
    expect(within(surface(TASKS.request)!).getAllByRole("term").map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
    expect(changes(TASKS.request)).toEqual(["請求の対象：（なし） → 合成 一", "請求の種類：（なし） → 消去", "対象と理由：（なし） → 合成の消去請求"]);
    expect(line(TASKS.request, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
    expect(line(TASKS.request, "通知")).toHaveTextContent(`${NOBODY}請求は、本人と管理者のこの画面の一覧に表示されます。受付の記録（操作者・時刻）は監査の履歴に残ります。`);
    expect(line(TASKS.request, "競合・部分失敗")).toHaveTextContent("請求を記録しただけでは、開示・訂正・利用停止・消去は実施されません。");
    expect(calls).toEqual([]);
    expect(hasUnsavedChanges()).toBe(true);
    await press(TASKS.request, "この内容で請求する");
    expect(calls).toEqual([{ method: "POST", path: SEND, body: keyed(REQUEST) }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(done(TASKS.request)).toHaveTextContent("請求を受け付けました（第1版・受付）。本人確認と管理者の判断の後に実施されます。");
    expect(surface(TASKS.request)).toBeNull();
    expect(field(TASKS.request, "対象と理由")).toHaveValue("");
    expect(hasUnsavedChanges()).toBe(false);
  });

  test("without a person in the URL the request is the viewer's own", async () => {
    const { calls } = await mount(() => SAVED, listing({ people: [{ person_id: "synthetic-pharmacist", name: "高橋 葵" }], cases: [], rules: [], holds: [] }), "PHARMACIST");
    await fill();
    expect(changes(TASKS.request)[0]).toBe("請求の対象：（なし） → 高橋 葵（あなた）");
    await press(TASKS.request, "この内容で請求する");
    expect(posts(calls)[0].body).toEqual(keyed({ ...REQUEST, payload: { ...REQUEST.payload, person_id: "synthetic-pharmacist" } }));
  });

  test("an unknown outcome sends the identical body again with the same key", async () => {
    let sends = 0;
    const { calls, refresh } = await mount(() => { if (++sends === 1) throw new PlanningError(503, "unavailable"); return SAVED; }, listing(), "ADMIN", { selectedPersonId: "p1" });
    await fill();
    await press(TASKS.request, "この内容で請求する");
    expect(line(TASKS.request, "競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます");
    expect(refresh).not.toHaveBeenCalled();
    await press(TASKS.request, "同じ内容を再送する");
    expect(posts(calls)).toEqual([{ method: "POST", path: SEND, body: keyed(REQUEST) }, { method: "POST", path: SEND, body: keyed(REQUEST) }]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test.each([
    [403, "本人の請求だけを登録できます。", "この操作は担当外です"],
    [422, "String should have at most 2000 characters", "サーバーの検証で止まりました"],
    [423, "Approved use restriction is active", "いまは操作できません"],
    [409, "Input, version or ledger conflict; refresh and review again", "新しい変更があります"],
  ])("a %i is shown with the server's own message and nothing is claimed", async (status, detail, title) => {
    const { refresh } = await mount(() => { throw new PlanningError(status, JSON.stringify({ detail })); }, listing(), "ADMIN", { selectedPersonId: "p1" });
    await fill();
    await press(TASKS.request, "この内容で請求する");
    expect(line(TASKS.request, "競合・部分失敗")).toHaveTextContent("保存していません。サーバーが下の理由で受け付けませんでした。");
    expect(within(surface(TASKS.request)!).getByRole("alert")).toHaveTextContent(title);
    expect(within(surface(TASKS.request)!).getByRole("alert")).toHaveTextContent(detail);
    expect(refresh).not.toHaveBeenCalled();
    await press(TASKS.request, "入力に戻る");
    expect(field(TASKS.request, "対象と理由")).toHaveValue("合成の消去請求");
  });
});

describe("deciding a request", () => {
  const SEND = (id: string) => `/compliance/privacy/cases/${id}?${SCOPE}`;
  async function enter(caseId: string, status: string, result = "") {
    await open(TASKS.decide);
    set(TASKS.decide, "判断する請求", caseId); set(TASKS.decide, "次の判断", status); set(TASKS.decide, "判断理由", "判断理由"); set(TASKS.decide, "本人確認の根拠", "本人確認資料"); set(TASKS.decide, "本人確認者", "確認者");
    if (result) set(TASKS.decide, /実施結果の参照/, result);
  }
  const options = (label: string) => within(field(TASKS.decide, label)).getAllByRole("option").map((option) => option.textContent);

  test("only the requests and the decisions the server lists are offered; the result reference is required exactly when it says so", async () => {
    await mount();
    await open(TASKS.decide);
    expect(options("判断する請求")).toEqual(["選んでください", "合成 一・消去・本人確認済み（第2版）：合成のerase", "合成 二・開示・実施承認（第3版）：合成のaccess"]);
    expect(listed(TASKS.decide, "次の判断がない請求")).toEqual(["合成 一・訂正・理由を付して不承認（第2版）：サーバーは次の判断を返していません。"]);
    set(TASKS.decide, "判断する請求", "case-erase");
    expect(within(task(TASKS.decide)).getByRole("heading", { name: "2. 請求を確かめ、判断と根拠を入力する" })).toBeInTheDocument();
    expect(options("次の判断")).toEqual(["選んでください", "実施承認", "理由を付して不承認"]);
    set(TASKS.decide, "次の判断", "APPROVED");
    expect(field(TASKS.decide, "実施結果の参照（任意）")).not.toBeRequired();
    set(TASKS.decide, "判断する請求", "case-access");
    expect(options("次の判断")).toEqual(["選んでください", "実施完了", "利用停止を解除"]);
    set(TASKS.decide, "次の判断", "COMPLETED");
    expect(field(TASKS.decide, "実施結果の参照（この判断では必須）")).toBeRequired();
    set(TASKS.decide, "次の判断", "RELEASED");
    expect(field(TASKS.decide, "実施結果の参照（任意）")).not.toBeRequired();
  });

  test("the server's lists alone decide what is offered: another answer, other options", async () => {
    await mount(undefined, listing({ cases: [{ ...CLOSED_CASE, allowed_next: ["VERIFIED"], result_reference_required: ["VERIFIED"] }, { ...VERIFIED_CASE, allowed_next: [] }] }));
    await open(TASKS.decide);
    expect(options("判断する請求")).toEqual(["選んでください", "合成 一・訂正・理由を付して不承認（第2版）：合成のrectify"]);
    set(TASKS.decide, "判断する請求", "case-rectify"); set(TASKS.decide, "次の判断", "VERIFIED");
    expect(options("次の判断")).toEqual(["選んでください", "本人確認済み"]);
    expect(field(TASKS.decide, "実施結果の参照（この判断では必須）")).toBeRequired();
  });

  test("a decision is confirmed first and sent as the established screen sent it; the route is read again", async () => {
    const { calls, refresh } = await mount(() => ({ case_id: "case-erase", revision: 3, status: "APPROVED" }));
    await enter("case-erase", "APPROVED");
    await press(TASKS.decide, "判断の内容を確認する");
    expect(within(surface(TASKS.decide)!).getByRole("heading", { name: "3. 記録前の確認" })).toHaveFocus();
    expect(changes(TASKS.decide)).toEqual(["状態：本人確認済み → 実施承認", "判断理由：（なし） → 判断理由", "本人確認の根拠：（なし） → 本人確認資料", "本人確認者：（なし） → 確認者"]);
    expect(line(TASKS.decide, "作成される版")).toHaveTextContent("第2版 → 第3版");
    expect(line(TASKS.decide, "通知")).toHaveTextContent(`${NOBODY}判断後の状態は、本人と管理者のこの画面の一覧に表示されます。判断の記録（状態・理由・操作者・時刻）は監査の履歴に残ります。`);
    expect(line(TASKS.decide, "競合・部分失敗")).toHaveTextContent("この請求が第2版のままであること、選んだ判断が現在の状態から受け付けられること、本人確認の根拠が確認済みであることを照合します。");
    expect(surface(TASKS.decide)).toHaveTextContent("利用停止の請求を「実施承認」にすると、サーバーは同じ施設のすべての部署で、通常の勤務計画の読取りと操作を停止し");
    expect(calls).toEqual([]);
    await press(TASKS.decide, "この判断を記録する");
    expect(calls).toEqual([{ method: "POST", path: SEND("case-erase"), body: keyed(DECISION) }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(done(TASKS.decide)).toHaveTextContent("判断を記録しました（第3版・実施承認）。");
  });

  test("a reason is shown as it was typed, in the confirmation, in the list and in the history, and is marked as a person's words wherever it is shown", async () => {
    // A journey types reasons that hold an enumeration value and the word 「API」: they are the person's words.
    const decided = { ...VERIFIED_CASE, payload: { ...VERIFIED_CASE.payload, reason: TYPED, decision_history: [{ expected_revision: 1, status: "VERIFIED", reason: TYPED, result_reference: TYPED, identity_evidence: { reference: "ID-1", status: "verified", verified_by: "確認者", valid_until: null } }] } };
    await mount(() => ({ case_id: "case-erase", revision: 3, status: "APPROVED" }), listing({ cases: [decided], holds: [{ ...HOLD, payload: { ...HOLD.payload, reason: TYPED } }] }));
    // Closed: the list of requests, the legal hold and the history of decisions.
    expect(within(screen.getByRole("region", { name: "本人対応の請求" })).getByRole("cell", { name: TYPED })).toHaveAttribute("data-verbatim");
    expect(shownTimes(panel("現在の状態"))).toBe(2);
    expect(shownTimes(panel("履歴"))).toBe(2);
    expect(unmarked(document.body)).toEqual([]);
    // Deciding: the request as read back, then the confirmation of what was typed.
    await open(TASKS.decide);
    set(TASKS.decide, "判断する請求", "case-erase");
    expect(unmarked(task(TASKS.decide))).toEqual([]);
    expect(shownTimes(task(TASKS.decide))).toBe(1);
    set(TASKS.decide, "次の判断", "APPROVED"); set(TASKS.decide, "判断理由", TYPED); set(TASKS.decide, "本人確認の根拠", TYPED); set(TASKS.decide, "本人確認者", TYPED); set(TASKS.decide, /実施結果の参照/, TYPED);
    await press(TASKS.decide, "判断の内容を確認する");
    expect(changes(TASKS.decide)).toEqual(["状態：本人確認済み → 実施承認", `判断理由：（なし） → ${TYPED}`, `本人確認の根拠：（なし） → ${TYPED}`, `本人確認者：（なし） → ${TYPED}`, `実施結果の参照：（なし） → ${TYPED}`]);
    expect(shownTimes(surface(TASKS.decide)!)).toBe(4);
    expect(unmarked(document.body)).toEqual([]);
    // A line that is not a person's words is not marked.
    expect(within(line(TASKS.decide, "変更内容")).getAllByRole("listitem").map((item) => item.hasAttribute("data-verbatim"))).toEqual([false, true, true, true, true]);
  });

  test("a completion carries the result reference", async () => {
    const { calls } = await mount(() => ({ case_id: "case-access", revision: 4, status: "COMPLETED" }));
    await enter("case-access", "COMPLETED", "結果資料");
    await press(TASKS.decide, "判断の内容を確認する");
    expect(changes(TASKS.decide)).toContain("実施結果の参照：（なし） → 結果資料");
    await press(TASKS.decide, "この判断を記録する");
    expect(calls).toEqual([{ method: "POST", path: SEND("case-access"), body: keyed(COMPLETION) }]);
  });

  test("a conflict shows the three contents; it is recorded against the current revision only after the review, and only if the server still accepts the decision", async () => {
    let current = { ...VERIFIED_CASE, revision: 3 };
    let sends = 0;
    const { calls } = await mount((call: Call) => { if (call.method === "GET") return listing({ cases: [current] }); if (++sends === 1) throw conflict(); return { case_id: "case-erase", revision: 4, status: "APPROVED" }; });
    await enter("case-erase", "APPROVED");
    await press(TASKS.decide, "判断の内容を確認する");
    await press(TASKS.decide, "この判断を記録する");
    expect(within(surface(TASKS.decide)!).getAllByRole("alert")[0]).toHaveTextContent("現在の版は第3版です。編集中の内容は保持しています。自動では統合しません。");
    expect(within(within(surface(TASKS.decide)!).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("状態本人確認済み本人確認済み実施承認あり");
    expect(within(surface(TASKS.decide)!).getByRole("button", { name: "この判断を記録する" })).toBeDisabled();
    await press(TASKS.decide, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(TASKS.decide)).toHaveTextContent("現在の第3版に対する判断として確認し直します。");
    await press(TASKS.decide, "この判断を記録する");
    expect(posts(calls).map((call) => call.body)).toEqual([keyed(DECISION), keyed({ expected_revision: 3, payload: { ...DECISION.payload, expected_revision: 3 } }, 2)]);
    // Meanwhile somebody else decided it: the server no longer lists the chosen decision.
    current = { ...VERIFIED_CASE, revision: 5, status: "REJECTED", allowed_next: [] };
    sends = 0;
    await enter("case-erase", "APPROVED");
    await press(TASKS.decide, "判断の内容を確認する");
    await press(TASKS.decide, "この判断を記録する");
    await press(TASKS.decide, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(done(TASKS.decide)).toHaveTextContent("判断は記録していません。この請求は現在「理由を付して不承認」（第5版）で、サーバーは選んだ判断を受け付けません。");
    expect(surface(TASKS.decide)).toBeNull();
    expect(posts(calls)).toHaveLength(3);
  });

  test("a refusal is the server's message", async () => {
    await mount(() => { throw new PlanningError(422, JSON.stringify({ detail: "Decision requires verified identity and a valid transition" })); });
    await enter("case-erase", "APPROVED");
    await press(TASKS.decide, "判断の内容を確認する");
    await press(TASKS.decide, "この判断を記録する");
    expect(within(surface(TASKS.decide)!).getByRole("alert")).toHaveTextContent("Decision requires verified identity and a valid transition");
  });
});

describe("revising a retention rule", () => {
  const SEND = `/compliance/retention-rules?${SCOPE}`;
  async function target(category: string, anchor: string) { await open(TASKS.rule); set(TASKS.rule, "対象データ種別", category); set(TASKS.rule, "保存期間の起算", anchor); await press(TASKS.rule, "この規則の内容を入力する"); }

  test("the current revision is the starting point; the revision is confirmed and sent as the established screen sent it", async () => {
    const { calls, refresh } = await mount(() => ({ key: "rule-2", revision: 2 }));
    await target("planning_history", "period_end");
    expect(task(TASKS.rule)).toHaveTextContent("勤務表と入力履歴・対象期間の終了：現在は第1版です。");
    expect(field(TASKS.rule, "利用目的")).toHaveValue("編集開始目的");
    expect(field(TASKS.rule, "保存日数")).toHaveValue(30);
    set(TASKS.rule, "利用目的", "改定後の目的"); set(TASKS.rule, "保存根拠の確認者", "確認者"); tick(TASKS.rule, "今回の適用範囲・期間・根拠を確認した");
    await press(TASKS.rule, "改定の内容を確認する");
    expect(changes(TASKS.rule)).toEqual(["利用目的：編集開始目的 → 改定後の目的", "保存根拠の状態：未確認 → 確認済み", "保存根拠の確認者：（なし） → 確認者"]);
    expect(line(TASKS.rule, "作成される版")).toHaveTextContent("第1版 → 第2版");
    expect(line(TASKS.rule, "通知")).toHaveTextContent(`${NOBODY}改定の記録（規則の版・操作者・時刻）は監査の履歴に残ります。`);
    expect(surface(TASKS.rule)).toHaveTextContent("規則を登録しても、記録は自動では消去されません。");
    expect(calls).toEqual([]);
    await press(TASKS.rule, "この内容で改定を記録する");
    expect(calls).toEqual([{ method: "POST", path: SEND, body: keyed(RULE) }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(done(TASKS.rule)).toHaveTextContent("保存規則の改定を第2版として記録しました。");
  });

  test("a rule that does not exist yet is created at revision 1", async () => {
    const { calls } = await mount(() => ({ key: "rule-new", revision: 1 }));
    await target("exports", "last_activity");
    expect(task(TASKS.rule)).toHaveTextContent("出力物・最終更新・受渡し：まだ登録されていません。");
    const p = NEW_RULE.payload;
    for (const [label, value] of [["利用目的", p.purpose], ["保存日数", String(p.retention_days)], ["根拠を確認した法定最低保存日数", String(p.legal_minimum_days)], ["適用開始日", p.effective_from], ["適用終了日（この日を含まない）", p.effective_until], ["更新担当者", p.owner], ["次回確認日", p.next_review], ["保存根拠・条項", p.evidence.reference]]) set(TASKS.rule, label, value);
    await press(TASKS.rule, "改定の内容を確認する");
    expect(line(TASKS.rule, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
    await press(TASKS.rule, "この内容で改定を記録する");
    expect(calls).toEqual([{ method: "POST", path: SEND, body: keyed(NEW_RULE) }]);
  });

  test("a conflict is reviewed against the rule as the server holds it now", async () => {
    let sends = 0;
    const { calls } = await mount((call: Call) => { if (call.method === "GET") return listing({ rules: [{ key: "rule-2", revision: 2, payload: { ...POLICY, purpose: "現在の目的" } }] }); if (++sends === 1) throw conflict(); return { key: "rule-3", revision: 3 }; });
    await target("planning_history", "period_end");
    set(TASKS.rule, "利用目的", "改定後の目的"); set(TASKS.rule, "保存根拠の確認者", "確認者"); tick(TASKS.rule, "今回の適用範囲・期間・根拠を確認した");
    await press(TASKS.rule, "改定の内容を確認する");
    await press(TASKS.rule, "この内容で改定を記録する");
    expect(within(within(surface(TASKS.rule)!).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("利用目的編集開始目的現在の目的改定後の目的あり");
    await press(TASKS.rule, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(TASKS.rule)).toHaveTextContent("現在の第2版に対する改定として確認し直します。");
    await press(TASKS.rule, "この内容で改定を記録する");
    expect(posts(calls)[1].body).toEqual(keyed({ ...RULE, expected_revision: 2 }, 2));
  });
});

describe("recording a legal hold", () => {
  const SEND = `/compliance/holds?${SCOPE}`;
  test("a new hold for one person or the whole department, and the release of a registered one, as the established screen sent them", async () => {
    const { calls, refresh } = await mount(() => ({ hold_id: "hold-x", revision: 1 }));
    await open(TASKS.hold);
    expect(within(field(TASKS.hold, "対象の保全記録")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "新しく保全する", "合成 一：保全中（第1版）"]);
    set(TASKS.hold, "対象の保全記録", "new");
    expect(within(field(TASKS.hold, "保全操作")).getAllByRole("option").map((option) => option.textContent)).toEqual(["保全する"]);
    set(TASKS.hold, "保全の対象", "p1"); set(TASKS.hold, "判断理由", "係争の保全");
    await press(TASKS.hold, "保全判断の内容を確認する");
    expect(changes(TASKS.hold)).toEqual(["保全の対象：（なし） → 合成 一", "保全の状態：（なし） → 保全中", "判断理由：（なし） → 係争の保全"]);
    expect(line(TASKS.hold, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
    expect(line(TASKS.hold, "通知")).toHaveTextContent(`${NOBODY}保全判断の記録（保全の状態・操作者・時刻）は監査の履歴に残ります。`);
    expect(surface(TASKS.hold)).toHaveTextContent("保全中の対象について、サーバーは人物制御の適用、消去計画の実行、コピーの消去と旧勤務入力の消去を拒否します。");
    await press(TASKS.hold, "この保全判断を記録する");
    expect(done(TASKS.hold)).toHaveTextContent("保全判断を記録しました（第1版）。");
    set(TASKS.hold, "対象の保全記録", "new"); set(TASKS.hold, "判断理由", "係争の保全");
    await press(TASKS.hold, "保全判断の内容を確認する");
    expect(changes(TASKS.hold)[0]).toBe("保全の対象：（なし） → 部署全体");
    await press(TASKS.hold, "この保全判断を記録する");
    set(TASKS.hold, "対象の保全記録", "hold1");
    expect(task(TASKS.hold)).toHaveTextContent("登録済みの保全の対象は変更できません。");
    set(TASKS.hold, "保全操作", "release"); set(TASKS.hold, "判断理由", "解除の理由");
    await press(TASKS.hold, "保全判断の内容を確認する");
    expect(changes(TASKS.hold)).toEqual(["保全の状態：保全中 → 解除済み", "判断理由：当初の理由 → 解除の理由"]);
    expect(line(TASKS.hold, "作成される版")).toHaveTextContent("第1版 → 第2版");
    await press(TASKS.hold, "この保全判断を記録する");
    expect(calls).toEqual([{ method: "POST", path: SEND, body: keyed(NEW_HOLD) }, { method: "POST", path: SEND, body: keyed(DEPARTMENT_HOLD, 2) }, { method: "POST", path: SEND, body: keyed(HOLD_RELEASE, 3) }]);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  test("a conflict shows the hold as the server holds it now before anything is sent again", async () => {
    let sends = 0;
    const { calls } = await mount((call: Call) => { if (call.method === "GET") return listing({ holds: [{ ...HOLD, revision: 2, payload: { reason: "現在の理由" } }] }); if (++sends === 1) throw conflict(); return { hold_id: "hold1", revision: 3 }; });
    await open(TASKS.hold);
    set(TASKS.hold, "対象の保全記録", "hold1"); set(TASKS.hold, "保全操作", "release"); set(TASKS.hold, "判断理由", "解除の理由");
    await press(TASKS.hold, "保全判断の内容を確認する");
    await press(TASKS.hold, "この保全判断を記録する");
    expect(within(within(surface(TASKS.hold)!).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").map((row) => row.textContent)).toContain("判断理由当初の理由現在の理由解除の理由あり");
    await press(TASKS.hold, "三つの内容を確認し、現在の版に対して確認し直す");
    await press(TASKS.hold, "この保全判断を記録する");
    expect(posts(calls)[1].body).toEqual(keyed({ ...HOLD_RELEASE, expected_revision: 2 }, 2));
  });
});

// The route arrives as server HTML. Its tasks have no field until React attaches, so
// nothing can be typed or chosen in a form that could not keep it.
describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  test("the server HTML holds the state and the closed tasks without fields; a task opened there gets its form, and what is typed then is kept", async () => {
    const { node, calls } = tree(() => ({ preview_hash: "x", changes: [], unresolved_copy_ids: [] }), "ADMIN");
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node(privacyOf(listing())));
    expect(container.innerHTML).toContain("本人対応の請求");
    for (const summary of [TASKS.request, ...ADMIN_TASKS]) expect(container.innerHTML).toContain(summary);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(within(container).getAllByText("この操作を準備しています。").length).toBeGreaterThan(0);
    const request = within(container).getByText(TASKS.request).closest("details")!;
    request.open = true;
    await act(async () => { root = hydrateRoot(container, node(privacyOf(listing()))); });
    expect(request.open).toBe(true);
    const reason = within(request).getByLabelText("対象と理由");
    fireEvent.change(reason, { target: { value: "接続後に入力" } });
    await act(async () => { root!.render(node(privacyOf(listing({ cases: [] })))); });
    expect(within(request).getByLabelText("対象と理由")).toHaveValue("接続後に入力");
    // Nothing an administrator's task needs was read by showing the route.
    expect(calls).toEqual([]);
  });
});

test("with a person named in the URL the band stands before the notice of the subject, which is unchanged; for the viewer there is none", async () => {
  await mount(() => ({}), listing(), "ADMIN", { selectedPersonId: "p1", names: { p1: "合成 一" } });
  const band = screen.getByRole("region", { name: "表示を絞っている職員" });
  expect(band).toHaveTextContent("表示を絞っている職員：合成 一。この画面では、この職員の記録だけを表示し、新しく登録する記録の対象もこの職員になります。サインイン中のアカウントは 佐藤 美咲（システム管理者） のまま変わっていません。");
  expect(within(band).getByRole("link", { name: "絞り込みを解除して全員の記録を表示する" })).toHaveAttribute("href", "/workspace/governance/privacy");
  const notice = screen.getByText("請求の対象として選択中の職員：合成 一。この職員の請求を、管理者として代わりに出せます。", { exact: true });
  expect(notice.tagName).toBe("P");
  expect(band.compareDocumentPosition(notice)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(band.parentElement!.closest("section")).toBe(panel("現在の状態"));
  document.body.innerHTML = "";
  await mount();
  expect(screen.queryByRole("region", { name: "表示を絞っている職員" })).toBeNull();
  expect(panel("現在の状態")).toHaveTextContent("請求の対象として選択中の職員：佐藤 美咲（あなた）。");
});
