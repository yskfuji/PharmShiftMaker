import { render, screen, waitFor, within } from "@testing-library/react";
import type { IdealRole, IdealScreen } from "@/ideal/types";
import CognitiveWorkspaceShowcase from "../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../showcase/synthetic/context";
import { workspaceV3Routes } from "../../showcase/synthetic/routes";
import { syntheticRequest } from "../../showcase/synthetic/transport";
import { ROUTE_DEFINITIONS, routeKey } from "../routes";
import { routeOf } from "../routeTypes";
import { WORKSPACE_ROUTE_KEYS, type WorkspaceRouteKey } from "../../generated/usecaseRoutes";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

test("every definition belongs to a route of the generated contract", () => {
  expect(Object.keys(ROUTE_DEFINITIONS).filter((key) => !(WORKSPACE_ROUTE_KEYS as readonly string[]).includes(key))).toEqual([]);
  for (const [key, definition] of Object.entries(ROUTE_DEFINITIONS)) expect(definition.key).toBe(key);
});

test("a role with no view of a screen has no route there, in the showcase as in production", () => {
  expect([routeKey("people", undefined, "LEADER"), routeKey("plan", undefined, "PHARMACIST"), routeKey("people", undefined, "ADMIN")]).toEqual([null, null, "people/directory"]);
  render(<CognitiveWorkspaceShowcase screen="people" role="LEADER" />);
  expect(screen.getByRole("heading", { name: "この画面は、あなたの役割では開けません" })).toBeInTheDocument();
});

test("every route of the generated contract has its own definition", () => {
  expect(new Set(Object.keys(ROUTE_DEFINITIONS))).toEqual(new Set(WORKSPACE_ROUTE_KEYS));
  expect(Object.keys(ROUTE_DEFINITIONS)).toHaveLength(WORKSPACE_ROUTE_KEYS.length);
});

test("the showcase runs the route's own read and view, and never reaches a server", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  render(<CognitiveWorkspaceShowcase screen="operations" view="today" role="LEADER" />);
  expect(await screen.findByRole("heading", { name: "予定上の勤務" })).toBeInTheDocument();
  // Named by the route from the context's roster (the viewer's own name is in the frame).
  expect(screen.getByText("高橋 葵")).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the common states are states of the route, not a replacement for it", async () => {
  const { unmount } = render(<CognitiveWorkspaceShowcase screen="operations" view="today" role="LEADER" state="empty" />);
  // The route's own words for "nothing yet", from the same view.
  expect(await screen.findByText("本日の予定勤務はありません。")).toBeInTheDocument();
  unmount();
  for (const [state, name] of [["failure", "読み込めませんでした"], ["conflict", "表示中の版が古くなりました"], ["forbidden", "この画面は、あなたの役割では開けません"]] as const) {
    const view = render(<CognitiveWorkspaceShowcase screen="operations" view="today" role="LEADER" state={state} />);
    expect(screen.getByRole("alert")).toHaveTextContent(name);
    // The frame and the sub-navigation stay; only the route's body is replaced.
    expect(screen.getByRole("heading", { level: 1, name: "当日運用" })).toBeInTheDocument();
    view.unmount();
  }
  render(<CognitiveWorkspaceShowcase screen="operations" view="today" role="LEADER" state="loading" />);
  expect(screen.getByRole("region", { name: "情報を読み込んでいます" })).toBeInTheDocument();
});

/**
 * What each route says, in its own words, when the scope has nothing yet: no roster, a
 * publication without assignments, no notifications, no plan chosen, and every list of the
 * API empty. A route added to the registry must say here what it shows then.
 */
const NOTHING_YET: Record<string, (role: IdealRole) => string[]> = {
  "governance/actuals": () => ["登録済みの実績はありません。実績は、原本の取込か公開勤務からの記録で登録されます。", "登録されている実績0件"],
  "governance/audit": () => ["記録はありません。"],
  "governance/privacy": (role) => (role === "ADMIN"
    ? ["この部署の請求はありません。", "保存規則は登録されていません。", "法的保全の記録はありません。", "判断の記録はありません。"]
    : ["あなたの請求はありません。", "判断の記録はありません。"]),
  "home/index": (role) => role === "PHARMACIST"
    ? ["予定されている勤務はありません", "公開版 v12 にあなたの勤務はありません", "あなたに同意を求めている申請はありません。"]
    : ["本日の予定勤務0件", "今日の勤務に関わるケース0件", "欠勤・交換の記録 0件"],
  "operations/cases": () => ["いま対応が必要なケースはありません。", "公開版 v12 に、申請できる勤務はありません。"],
  "operations/today": () => ["本日の予定勤務はありません。"],
  "people/contracts": () => ["登録されている職員はいません。", "登録されている契約はありません。", "システムによる検証で、編集中の記録に不整合は見つかっていません。"],
  "people/directory": () => ["表示できる職員はいません。"],
  "people/lifecycle": () => ["進行中の手続きはありません。"],
  "people/memberships": () => ["紐付けはありません。"],
  "plan/compare": () => ["比較する案が指定されていません"],
  "plan/drafts": () => ["確認する案が指定されていません"],
  "plan/input": () => ["この入力版に登録された必要配置はありません。"],
  "plan/publications": () => ["公開通知はありません。"],
  "requests/leave": (role) => [role === "PHARMACIST" ? "あなたに登録された年休の付与はありません。" : "この部署に登録された年休の付与はありません。", "進行中のあなたの申請はありません。", "申請の記録はありません。"],
  "requests/mine": () => ["いま対応が必要なケースはありません。", "公開版 v12 に、申請できる勤務はありません。"],
  "requests/outside": () => ["現在の申告はありません。", "申告の記録はありません。"],
  "requests/swap": () => ["いま対応が必要なケースはありません。", "公開版 v12 に、申請できる勤務はありません。"],
  "schedule/index": (role) => [role === "PHARMACIST" ? "表示期間に、あなたの公開済みの勤務はありません。" : "表示期間に、公開済みの勤務はありません。"],
  "settings/flextime": () => ["採用していません（既定）。", "清算の対象となる実績はまだありません。", "取り下げた採用・終了した採用はありません。"],
  "settings/notifications": () => ["未確認の通知はありません。"],
};
/** Routes that show one state or one setting and no list: there is no "nothing yet" for
 * them, and the same content is shown. The text proves the route itself is rendered. */
const WITHOUT_A_LIST: Record<string, string> = {
  "governance/recovery": "バックアップからの復元",
  "plan/generate": "同じ前提から3案を作成",
  "settings/absence-consent": "代わりに入る人の同意",
  "settings/appearance": "配色",
};

test("every route of the registry says what it shows when there is nothing yet", () => {
  expect([...Object.keys(NOTHING_YET), ...Object.keys(WITHOUT_A_LIST)].sort()).toEqual(Object.keys(ROUTE_DEFINITIONS).sort());
});

const cases = (Object.keys(ROUTE_DEFINITIONS) as WorkspaceRouteKey[])
  .flatMap((key) => (routeOf(key).roles as readonly IdealRole[]).map((role) => [key, role] as const));

test.each(cases)("%s as %s: the empty state is the route's own, not a generic panel", async (key, role) => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const route = routeOf(key);
  render(<CognitiveWorkspaceShowcase screen={route.screen as IdealScreen} view={route.view === "index" ? undefined : route.view} role={role} state="empty" />);
  const main = await screen.findByRole("main");
  for (const text of WITHOUT_A_LIST[key] ? [WITHOUT_A_LIST[key]] : NOTHING_YET[key](role)) {
    await waitFor(() => expect(main).toHaveTextContent(text));
  }
  expect(within(main).queryByRole("alert")).toBeNull();
  // The shell is in step with the routes: no unread notification is counted.
  expect(screen.queryAllByRole("link", { name: /未確認/ })).toEqual([]);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the empty context is the same scope with nothing yet", () => {
  for (const role of ["ADMIN", "LEADER", "PHARMACIST"] as const) {
    const ready = syntheticContext(role);
    const empty = syntheticContext(role, true);
    expect(empty).toEqual({ ...ready, names: {}, notifications: [], selectedDraftIds: [], publication: { ...ready.publication, assignments: [] }, publications: [{ ...ready.publication, assignments: [] }] });
    expect(ready.notifications).toHaveLength(1);
    expect(ready.notificationsRead && empty.notificationsRead).toBe(true);
  }
});

test("a pharmacist is answered as the API answers one: own duties and own name only", async () => {
  const own = "synthetic-pharmacist";
  const pharmacist = syntheticRequest(false, "PHARMACIST");
  const leader = syntheticRequest(false, "LEADER");
  type Duty = { person_id: string };
  const publications = await pharmacist<Array<{ assignments: Duty[] }>>("/publications?scope_id=x");
  expect(publications[0].assignments.map((duty) => duty.person_id)).toEqual([own]);
  expect((await leader<Array<{ assignments: Duty[] }>>("/publications?scope_id=x"))[0].assignments).toHaveLength(2);
  // The calendar: own duties, the changes among them, and no export of the department's publication.
  type Calendar = { visibility: string; assignments: Duty[]; changes: unknown[]; can_export_department: boolean };
  const calendar = await pharmacist<Calendar>("/schedule-calendar?scope_id=x");
  expect([calendar.visibility, calendar.assignments.map((duty) => duty.person_id), calendar.changes, calendar.can_export_department]).toEqual(["self", [own], [], false]);
  const whole = await leader<Calendar>("/schedule-calendar?scope_id=x");
  expect([whole.visibility, whole.assignments.length, whole.changes.length, whole.can_export_department]).toEqual(["department", 2, 1, true]);
  // Who changed the absence consent is for administrators only, and is an account, not a role.
  type Settings = { absence_replacement_consent: { history: Array<{ actor: string }> | null } };
  expect((await pharmacist<Settings>("/scope-settings?scope_id=x")).absence_replacement_consent.history).toBeNull();
  expect((await leader<Settings>("/scope-settings?scope_id=x")).absence_replacement_consent.history).toBeNull();
  expect((await syntheticRequest(false, "ADMIN")<Settings>("/scope-settings?scope_id=x")).absence_replacement_consent.history?.map((item) => item.actor)).toEqual(["synthetic-admin"]);
  // The account links are the active ones unless the inactive ones are asked for.
  type Link = { person_id: string; active: boolean };
  expect((await leader<Link[]>("/memberships?scope_id=x&include_inactive=false")).map((link) => link.active)).toEqual([true, true, true]);
  expect((await leader<Link[]>("/memberships?scope_id=x&include_inactive=true")).filter((link) => !link.active).map((link) => link.person_id)).toEqual(["synthetic-leader"]);
  const daily = await pharmacist<{ visibility: string; scheduled_assignments: Duty[] }>("/daily-operations?scope_id=x");
  expect([daily.visibility, daily.scheduled_assignments.map((duty) => duty.person_id)]).toEqual(["self", [own]]);
  const privacy = await pharmacist<{ people: Duty[] }>("/compliance/privacy?scope_id=x");
  expect(privacy.people.map((person) => person.person_id)).toEqual([own]);
  expect((await leader<{ people: Duty[] }>("/compliance/privacy?scope_id=x")).people).toHaveLength(3);
  // An answer that depends on the viewer in another way is given per role, as the API gives it.
  type Declarations = { person_id: string; declarations: Array<{ payload: Duty; actions: { change: { allowed: boolean } } }> };
  const mine = await pharmacist<Declarations>("/compliance/declaration-context?scope_id=x");
  expect([mine.person_id, mine.declarations.map((row) => row.payload.person_id)]).toEqual([own, [own, own]]);
  const reviewed = await leader<Declarations>("/compliance/declaration-context?scope_id=x");
  expect(reviewed.declarations.map((row) => [row.payload.person_id, row.actions.change.allowed])).toEqual([["synthetic-leader", false]]);
  const everyone = await syntheticRequest(false, "ADMIN")<Declarations>("/compliance/declaration-context?scope_id=x");
  expect(everyone.declarations.map((row) => row.actions.change.allowed)).toEqual([true, true, true]);
  // Only the lists a route marks are narrowed; every other answer is the same for all roles.
  for (const route of workspaceV3Routes.filter((item) => !item.own && !item.byRole && typeof item.path === "string")) {
    const path = `${(route.path as string).replace("/planning", "")}?scope_id=x`;
    expect(await pharmacist(path)).toEqual(await leader(path));
  }
  const ctx = syntheticContext("PHARMACIST");
  expect(ctx.names).toEqual({});
  expect(ctx.publication?.assignments.map((duty) => duty.person_id)).toEqual([own]);
  expect(syntheticContext("LEADER").publication?.assignments).toHaveLength(2);
});

test("a pharmacist's schedule in the showcase names nobody else", async () => {
  render(<CognitiveWorkspaceShowcase screen="schedule" role="PHARMACIST" />);
  const main = within(await screen.findByRole("main"));
  expect(await main.findByText(/自分の公開勤務 1件/)).toBeInTheDocument();
  expect(main.queryByText(/鈴木 悠斗|佐藤 美咲|synthetic-leader|相手の職員/)).toBeNull();
  // The department's export is not offered to a pharmacist, as the API says.
  expect(main.queryByText("部署の公開版を出力")).toBeNull();
  // With data the shell counts the one unread notification the routes are given.
  expect(screen.getAllByRole("link", { name: "通知 （未確認1件）" }).length).toBeGreaterThan(0);
});

test("the selected-person state is the ready state with a person named: the band in the route, the person in the frame's links", async () => {
  render(<CognitiveWorkspaceShowcase screen="people" view="lifecycle" role="ADMIN" state="selected-person" />);
  const band = await screen.findByRole("region", { name: "表示を絞っている職員" });
  expect(band).toHaveTextContent("表示を絞っている職員：高橋 葵。");
  expect(band).toHaveTextContent("サインイン中のアカウントは 佐藤 美咲（システム管理者） のまま変わっていません。");
  // Narrowed to that person's case; the other person's is not shown.
  expect(screen.getByRole("progressbar", { name: "高橋 葵のタスク進捗" })).toBeInTheDocument();
  expect(screen.queryByRole("progressbar", { name: "鈴木 悠斗のタスク進捗" })).toBeNull();
  const tabs = within(screen.getByRole("navigation", { name: "職員の機能" })).getAllByRole("link");
  expect(tabs.every((link) => link.getAttribute("href")?.endsWith("&person=synthetic-pharmacist"))).toBe(true);
  expect(within(screen.getAllByRole("navigation", { name: "主要ナビゲーション" })[0]).getByRole("link", { name: /^勤務表/ }).getAttribute("href")).not.toContain("person=");
});
