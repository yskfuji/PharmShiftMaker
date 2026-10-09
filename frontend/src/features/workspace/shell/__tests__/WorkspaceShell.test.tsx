import { render, screen, within } from "@testing-library/react";
import type { IdealRole, IdealScreen } from "@/ideal/types";
import WorkspaceShell, { type ShellInitial } from "../WorkspaceShell";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const initial = (role: IdealRole): ShellInitial => {
  const scope = { scope_id: "synthetic/clinical-pharmacy", display_name: "東都医療センター · 薬剤部", person_id: "synthetic-person", role, input_revision: 12 };
  return {
    viewerName: "鈴木 悠斗",
    scopes: [scope],
    scope,
    publications: [{ publication_id: "synthetic-publication-12", version: 12, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00", assignments: [], validation_status: "valid" }],
    selectedPublicationId: "synthetic-publication-12",
    requestedPeriod: "2026-10",
    notifications: [],
  };
};

const shell = (screenKey: IdealScreen, view: string | undefined, role: IdealRole = "ADMIN") =>
  render(<WorkspaceShell initial={initial(role)} screen={screenKey} view={view}><p>the route</p></WorkspaceShell>);
const head = () => screen.getByRole("heading", { level: 1 }).closest("header") as HTMLElement;

test("the page head says the screen and what the open view is for; the view's name is said by its tab alone", () => {
  shell("people", "lifecycle");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^職員$/);
  expect(within(head()).getByText("自動で判定する確認と、担当者が確かめて記録する確認を、手続きごとに進めます。")).toBeInTheDocument();
  // Not above the title any more: the name of the view is the current tab's.
  expect(within(head()).queryByText("入職・退職")).toBeNull();
  const tabs = screen.getByRole("navigation", { name: "職員の機能" });
  expect(within(tabs).getAllByRole("link", { current: "page" }).map((link) => link.textContent)).toEqual(["入職・退職手続きの確認"]);
});

test.each([
  ["home", "今日", "今対応すること、今日把握すること、最近変わったことを確認します。", "判断が必要なこと"],
  ["schedule", "勤務表", "公開版、直前版との差分、職員・資格ごとの勤務を確認します。", "月間計画と自分の予定"],
] as const)("%s has no views: its head carries the contract's sentence, not the hint of the main navigation again", (screenKey, title, sentence, hint) => {
  shell(screenKey, undefined);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(new RegExp(`^${title}$`));
  expect(within(head()).getByText(sentence)).toBeInTheDocument();
  expect(within(head()).queryByText(hint)).toBeNull();
  expect(screen.queryByRole("navigation", { name: `${title}の機能` })).toBeNull();
});

test.each([["input", 0], ["compare", 2], ["publications", 4]] as const)("plan/%s: the process numbers the stages and marks the open one; no stage is said to be done", (view, at) => {
  shell("plan", view, "LEADER");
  const stages = within(screen.getByRole("navigation", { name: "計画の機能" })).getAllByRole("link");
  expect(stages.map((link) => link.querySelector("strong")?.textContent)).toEqual(["前提・取込", "候補生成", "案の比較", "確認・編集", "公開版"]);
  expect(stages.map((link) => link.getAttribute("aria-current"))).toEqual(stages.map((_, index) => (index === at ? "page" : null)));
  // The frame knows the order of the stages and which one is open, and nothing of what has
  // been done in them: a stage before the open one has no check mark and no class of its
  // own, and is told from the open one by aria-current alone.
  expect(stages.map((link) => link.querySelectorAll("svg").length)).toEqual([0, 0, 0, 0, 0]);
  expect(stages.map((link) => link.className)).toEqual(["", "", "", "", ""]);
  // What is drawn is what is read: each stage's number, in its step mark, starts its name.
  expect(stages.map((link) => link.querySelector(".ideal-v3-subnav-step")?.textContent)).toEqual(["1", "2", "3", "4", "5"]);
  expect(stages.map((link) => link.querySelector(".ideal-v3-subnav-step")?.childElementCount)).toEqual([0, 0, 0, 0, 0]);
  expect(stages.map((link) => link.textContent)).toEqual(["1前提・取込入力の確定", "2候補生成3案を作成", "3案の比較差を比較", "4確認・編集検証する", "5公開版通知まで確認"]);
});

test("the tabs of another screen carry neither a number nor a mark", () => {
  shell("governance", "privacy");
  const tabs = within(screen.getByRole("navigation", { name: "ガバナンスの機能" })).getAllByRole("link");
  expect(tabs.map((link) => link.textContent)).toEqual(["監査操作の記録", "実績照合取込と照合の記録", "個人情報請求・保全・消去", "復旧復元後の状態"]);
  expect(tabs.some((link) => link.className !== "" || link.querySelector("svg, .ideal-v3-subnav-step"))).toBe(false);
});

test("settings: two named groups of tabs; a group's name is a label, not a destination", () => {
  shell("settings", "flextime");
  const tabs = screen.getByRole("navigation", { name: "設定の機能" });
  const groups = within(tabs).getAllByRole("group");
  expect(groups.map((group) => [group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby") as string)?.textContent, within(group).getAllByRole("link").map((link) => link.textContent)])).toEqual([
    ["個人設定", ["外観配色", "通知届いた通知"]],
    ["施設・部署設定", ["欠勤の同意同意を求めるか", "フレックス登録と確認"]],
  ]);
  for (const name of ["個人設定", "施設・部署設定"]) {
    const label = within(tabs).getByText(name, { selector: ".ideal-v3-subnav-label" });
    expect(label.closest("a, button")).toBeNull();
    expect(label).not.toHaveAttribute("tabindex");
  }
  expect(within(tabs).getAllByRole("link", { current: "page" }).map((link) => link.textContent)).toEqual(["フレックス登録と確認"]);
});

test("settings as a pharmacist: the group keeps only the tabs the role has", () => {
  shell("settings", "appearance", "PHARMACIST");
  const groups = within(screen.getByRole("navigation", { name: "設定の機能" })).getAllByRole("group");
  expect(groups.map((group) => within(group).getAllByRole("link").map((link) => link.querySelector("strong")?.textContent))).toEqual([["外観", "通知"], ["欠勤の同意"]]);
});

test("the context band: the scope form the journeys submit, and the three facts of what is shown", () => {
  shell("schedule", undefined);
  const band = screen.getByRole("region", { name: "表示中の業務コンテキスト" });
  expect(within(band).getByLabelText("施設・部署")).toHaveValue("synthetic/clinical-pharmacy");
  expect(within(band).getByRole("button", { name: "表示" })).toHaveAttribute("type", "submit");
  expect(Array.from(band.querySelectorAll("dl > div")).map((fact) => [fact.querySelector("dt")?.textContent, fact.querySelector("dd")?.textContent])).toEqual([["対象期間", "2026-10"], ["公開版", "v12"], ["検証状態", "公開時に検証済み"]]);
});

test("the person the URL names travels with the frame's links only to the routes that look at a person", () => {
  render(<WorkspaceShell initial={initial("ADMIN")} screen="people" view="lifecycle" routeContext={{ case: "case-1", person: "p2" }}><p>the route</p></WorkspaceShell>);
  const context = "scope=synthetic%2Fclinical-pharmacy&period=2026-10&publication=synthetic-publication-12&case=case-1";
  const tabs = within(screen.getByRole("navigation", { name: "職員の機能" })).getAllByRole("link");
  // Every tab of the people screen keeps the person (the directory included).
  expect(tabs.map((link) => link.getAttribute("href"))).toEqual([
    `/workspace/people/directory?${context}&person=p2`,
    `/workspace/people/memberships?${context}&person=p2`,
    `/workspace/people/lifecycle?${context}&person=p2`,
    `/workspace/people/contracts?${context}&person=p2`,
  ]);
  const main = within(screen.getAllByRole("navigation", { name: "主要ナビゲーション" })[0]);
  const hrefOf = (name: RegExp) => main.getByRole("link", { name }).getAttribute("href");
  // The schedule, the settings and the brand's way home do not look at a person: the case and the rest go, the person stays.
  expect(hrefOf(/^勤務表/)).toBe(`/workspace/schedule?${context}`);
  expect(hrefOf(/^設定/)).toBe(`/workspace/settings/appearance?${context}`);
  expect(hrefOf(/^職員/)).toBe(`/workspace/people/directory?${context}&person=p2`);
  expect(hrefOf(/^ガバナンス/)).toBe(`/workspace/governance/audit?${context}`);
  expect(screen.getAllByRole("link", { name: "PharmShiftMaker 今日へ" }).map((link) => link.getAttribute("href"))).toEqual([`/workspace/home?${context}`, `/workspace/home?${context}`]);
});
