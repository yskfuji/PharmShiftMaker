import { render, screen, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import type { DailyOperationsSnapshot } from "@/ideal/types";
import { readRoute } from "../../../shell/routeTypes";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

const snapshot = (over: Partial<DailyOperationsSnapshot> = {}): DailyOperationsSnapshot => ({
  scope_id: "synthetic/clinical-pharmacy", day: "2026-10-12", observed_at: "2026-10-12T08:16:00+09:00", visibility: "department",
  scheduled_assignments: [
    { duty_id: "d1", person_id: "synthetic-pharmacist", kind: "日勤", task: "病棟", location: "本館", start: "2026-10-12T08:30:00+09:00", end: "2026-10-12T17:30:00+09:00" },
    { duty_id: "d2", person_id: "synthetic-leader", kind: "夜勤", start: "2026-10-12T20:00:00+09:00", end: "2026-10-13T08:00:00+09:00" },
    { duty_id: "d3", person_id: "synthetic-admin", start: "いつか", end: null },
  ],
  scheduled_count: 3, open_case_count: 2, absence_case_count: 1, coverage_finding_count: 0, undelivered_notification_count: 4,
  limitations: ["予定上の勤務であり、在席・出勤実績ではありません。", "配置注意は進行中ケースのサーバー検証結果だけを数えます。"], ...over,
});
const show = (data: DailyOperationsSnapshot) => { const View = route.View; return render(<View data={data} ctx={syntheticContext("LEADER")} />); };
const tiles = () => Array.from(document.querySelectorAll(".ideal-v3-today-counts article")).map((item) => item.textContent);

test("the route reads the daily snapshot of today and nothing else", async () => {
  const calls: string[] = [];
  const client = createIdealClient("test", async <T,>(path: string) => { calls.push(path); return snapshot() as T; });
  expect(await readRoute(route, client, syntheticContext("LEADER"))).toMatchObject({ kind: "ready", partial: [], data: snapshot() });
  expect(calls).toEqual(["/daily-operations?scope_id=synthetic%2Fclinical-pharmacy&day=2026-10-12"]);
});

test("each figure is named by what the server counted, with the time it counted them", () => {
  show(snapshot());
  expect(screen.getByRole("heading", { level: 2, name: "予定上の勤務" }).closest("section")).toHaveTextContent("2026年10月12日（月）予定上の勤務公開済みの勤務表にある今日の勤務と、それに関わる進行中のケースの件数です。10月12日（月）08:16 時点の内容です。");
  expect(tiles()).toEqual([
    "予定勤務3件在席・出勤実績ではありません勤務表で見る ",
    "今日の勤務に関わるケース2件進行中の欠勤・交換（うち欠勤 1件）ケースを開く ",
    "ケースへの指摘0件ケースの検証で見つかった指摘ケースの一覧を開く ",
    "送信待ちの記録4件監査の送付先へまだ送られていない操作の記録（通知を含む・部署全体）",
  ]);
  // A figure that counts what another route shows leads there; the records waiting for the
  // audit delivery have no screen, and one line says what they are and who acts on them.
  expect(Array.from(document.querySelectorAll(".ideal-v3-today-counts a")).map((link) => link.getAttribute("href"))).toEqual(["/workspace/schedule", "/workspace/operations/cases", "/workspace/operations/cases"]);
  expect(screen.getByText(/^「送信待ちの記録」は、通知に限らず/)).toHaveTextContent("送付は運用の処理が行い、滞留は運用の手順で監視します。この画面に、送付の操作はありません。");
  // The journey reads this sentence as the whole text of one element.
  expect(screen.getAllByText("在席・出勤実績ではありません")).toHaveLength(1);
  // Nothing claims that the staffing is met, or that anything was verified.
  expect(document.body).not.toHaveTextContent(/充足|検証済み/);
  // The server's own notes on the figures are there to open, in its words.
  const notes = screen.getByText("この画面の数字について").closest("details")!;
  expect(notes.open).toBe(false);
  // The line about the last tile and the notes stand in the card of the figures they explain.
  const card = screen.getByRole("heading", { level: 2, name: "予定上の勤務" }).closest("section")!;
  expect(card).toContainElement(document.querySelector(".ideal-v3-today-counts") as HTMLElement);
  expect(card).toContainElement(screen.getByText(/^「送信待ちの記録」は、通知に限らず/));
  expect(card).toContainElement(notes);
  expect(Array.from(notes.querySelectorAll("li")).map((item) => item.textContent)).toEqual(snapshot().limitations);
});

test("findings stand out; a viewer's own snapshot says whose notifications are counted", () => {
  show(snapshot({ coverage_finding_count: 2, visibility: "self" }));
  expect(tiles()[2]).toBe("ケースへの指摘2件ケースの検証で見つかった指摘ケースの一覧を開く ");
  expect(document.querySelectorAll(".ideal-v3-today-counts article")[2].className).toBe("ideal-metric ideal-metric--warn");
  expect(tiles()[3]).toBe("送信待ちの記録4件監査の送付先へまだ送られていない、あなたに関わる操作の記録（通知を含む）");
});

test("the duties are a table under the day: who, the duty, its hours, the task and the place", () => {
  show(snapshot());
  expect(screen.getByRole("heading", { level: 2, name: "10月12日（月）の勤務予定" })).toBeInTheDocument();
  const rows = within(screen.getByRole("region", { name: "今日の勤務予定" })).getAllByRole("row").map((row) => Array.from(row.children).map((cell) => cell.textContent));
  expect(rows).toEqual([
    ["職員", "勤務", "時間", "業務", "場所"],
    // The day is said once, by the heading; an end on another day carries its date.
    ["高橋 葵", "日勤", "08:30–17:30", "病棟", "本館"],
    ["鈴木 悠斗", "夜勤", "20:00–10/13 08:00", "—", "—"],
    // What the server did not send, or sent in another form, is said and does not lose the route.
    ["佐藤 美咲", "勤務", "日時未確認", "—", "—"],
  ]);
});

test("the showcase shows the day's duties and counts that agree with the open cases; empty says so", async () => {
  const shown = render(<CognitiveWorkspaceShowcase screen="operations" view="today" role="LEADER" />);
  expect(await screen.findByRole("heading", { level: 2, name: "予定上の勤務" })).toBeInTheDocument();
  // Both synthetic cases are about a duty of the day, one of them an absence.
  expect(tiles().slice(0, 2)).toEqual(["予定勤務2件在席・出勤実績ではありません勤務表で見る ", "今日の勤務に関わるケース2件進行中の欠勤・交換（うち欠勤 1件）ケースを開く "]);
  shown.unmount();
  render(<CognitiveWorkspaceShowcase screen="operations" view="today" role="LEADER" state="empty" />);
  expect(await screen.findByText("本日の予定勤務はありません。")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "今日の勤務予定" })).toBeNull();
  expect(screen.queryByText("この画面の数字について")).toBeNull();
});
