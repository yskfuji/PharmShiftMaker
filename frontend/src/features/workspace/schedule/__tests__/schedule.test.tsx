import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole, ScheduleCalendarView } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute, type RouteContext } from "../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../showcase/synthetic/context";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
// The registered export is the workspace's own module, not the wrapper at the earlier path.
jest.mock("../../shared/ExportPublication", () => ({ __esModule: true, default: (props: { scope: string; publication: string; version: number }) => <section aria-label="公開版の登録済み出力">{JSON.stringify(props)}</section> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const duty = (id: string, person: string, day: number, kind = "日勤") => ({ duty_id: id, person_id: person, kind, task: "調剤", location: "中央", start: `2026-10-0${day}T08:30:00+09:00`, end: `2026-10-0${day}T17:15:00+09:00` });
const calendar = (over: Partial<ScheduleCalendarView> = {}): ScheduleCalendarView => ({
  scope_id: "synthetic/clinical-pharmacy", requested_period: "2026-10", visibility: "department",
  publication: { publication_id: "synthetic-publication-12", version: 12, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00", input_hash: "h", created_at: "2026-10-08T07:42:00+09:00" },
  previous_publication: null,
  assignments: [duty("d1", "synthetic-pharmacist", 1), duty("d2", "synthetic-leader", 2, "遅番"), duty("d3", "synthetic-admin", 2)],
  changes: [{ duty_id: "d2", kind: "CHANGED" }], can_export_department: true, limitations: [], ...over,
});

/** The real typed client over a recording transport, so paths are the real ones. */
function api(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = createIdealClient("test", async <T,>(path: string, method = "GET", body?: unknown) => {
    const call = { method, path, body };
    calls.push(call);
    return answer(call) as T;
  });
  return { calls, client };
}

function tree(data: { calendar: ScheduleCalendarView | null }, role: IdealRole = "LEADER", over: Partial<RouteContext> = {}) {
  const ctx = { ...syntheticContext(role), ...over };
  const { client } = api(() => { throw new Error("the schedule reads nothing in the browser"); });
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh: async () => undefined });
  const View = route.View;
  return <LiveProvider live={live}><View data={data} ctx={ctx} /></LiveProvider>;
}
const filters = () => screen.getByRole("region", { name: "勤務表の表示条件" });
const table = () => screen.getByRole("region", { name: "月間勤務表" });
const agenda = () => screen.getByRole("region", { name: "日別勤務予定" });
const people = () => within(table()).getAllByRole("rowheader").map((item) => item.textContent);

test("the route reads the calendar of the selected period and nothing else", async () => {
  const { calls, client } = api(() => calendar());
  const state = await readRoute(route, client, syntheticContext("LEADER"));
  expect(state).toMatchObject({ kind: "ready", partial: [], data: { calendar: calendar() } });
  expect(calls).toEqual([{ method: "GET", path: `/schedule-calendar?${SCOPE}&period=2026-10`, body: undefined }]);
  expect(route.names).toBe("planning");
});

test("no calendar yet is none; a calendar that cannot be read is reported beside the publication", async () => {
  const missing = api(() => { throw new PlanningError(404, "Not Found"); });
  expect(await readRoute(route, missing.client, syntheticContext("LEADER"))).toEqual({ kind: "ready", partial: [], data: { calendar: null } });
  const down = api(() => { throw new PlanningError(503, "calendar down"); });
  expect(await readRoute(route, down.client, syntheticContext("LEADER"))).toEqual({ kind: "ready", partial: [{ resource: "勤務表", status: 503, detail: "calendar down" }], data: { calendar: null } });
  const expired = api(() => { throw new PlanningError(401, "ログインし直してください。"); });
  expect(await readRoute(route, expired.client, syntheticContext("LEADER"))).toMatchObject({ kind: "problem", status: 401 });
});

test("the showcase shows the published month, and the route's own words when it is empty", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const shown = render(<CognitiveWorkspaceShowcase screen="schedule" role="LEADER" />);
  expect(await screen.findByRole("heading", { level: 2, name: "2026年10月" })).toBeInTheDocument();
  expect(screen.getByText("公開版 v12 · 公開済み")).toBeInTheDocument();
  expect(screen.getByText("公開勤務 2件")).toBeInTheDocument();
  expect(screen.getByText("表示期間 10/1–10/31")).toBeInTheDocument();
  expect(people()).toEqual(["高高橋 葵", "鈴鈴木 悠斗本人"]);
  expect(within(table()).getAllByRole("columnheader")).toHaveLength(32);
  expect(within(filters()).getByRole("status")).toHaveTextContent("2名を表示");
  // The leader's duty is the one the calendar marks as changed from the previous version.
  expect(within(table()).getByRole("button", { name: /遅番/ })).toHaveTextContent("遅番10:30–19:30変更");
  // The mark is an element in the corner of the cell, read out as 「変更」 and taking no line
  // of text; what it means is said once under the table, in the server's comparison.
  const mark = within(table()).getByRole("button", { name: /遅番/ }).querySelector("em.ideal-v3-schedule-mark")!;
  expect(mark.textContent).toBe("変更");
  expect(mark.firstElementChild).toHaveClass("sr-only");
  expect(within(table()).getByRole("button", { name: "遅番 10:30 – 19:30 変更" })).toBe(mark.parentElement);
  expect(shown.container.querySelector(".ideal-v3-schedule-legend")).toHaveTextContent("変更の印：同じ期間の直前の公開版（v11）と比べて、追加された勤務か、内容が変わった勤務です。");
  // Each day's head carries the short name the line before the table uses for a cut day.
  expect(within(table()).getAllByRole("columnheader").slice(1, 3).map((item) => item.getAttribute("data-cue"))).toEqual(["1日", "2日"]);
  expect(table().previousElementSibling).toHaveClass("ideal-v3-scroll-cue");
  // The agenda says a duty's hours beside its name, and marks the same duty.
  const row = within(agenda()).getByRole("button", { name: /鈴木 悠斗/ });
  expect(row).toHaveTextContent("鈴鈴木 悠斗本人遅番10:30–19:30変更");
  // Only what someone typed is marked as such: the name and the duty's name, each on the
  // element that holds it alone. 「本人」, the hours and the mark are the product's.
  expect(row).not.toHaveAttribute("data-verbatim");
  expect(Array.from(row.querySelectorAll("[data-verbatim]")).map((item) => item.textContent)).toEqual(["鈴木 悠斗", "遅番"]);
  expect(Array.from(within(agenda()).getByRole("button", { name: /高橋 葵/ }).querySelectorAll("[data-verbatim]")).map((item) => item.textContent)).toEqual(["高橋 葵", "日勤"]);
  const chosen = screen.getByText("選択中の勤務").parentElement!.parentElement!;
  expect(Array.from(chosen.querySelectorAll("[data-verbatim]")).map((item) => item.textContent)).toEqual(["鈴木 悠斗", "遅番", "薬剤部"]);
  expect(screen.getByRole("region", { name: "公開版の登録済み出力" })).toHaveTextContent('{"scope":"synthetic/clinical-pharmacy","publication":"synthetic-publication-12","version":12}');
  shown.unmount();
  render(<CognitiveWorkspaceShowcase screen="schedule" role="LEADER" state="empty" />);
  expect(await within(await screen.findByRole("region", { name: "月間勤務表" })).findByText("表示期間に、公開済みの勤務はありません。")).toBeInTheDocument();
  expect(within(agenda()).getByText("表示期間に、公開済みの勤務はありません。")).toBeInTheDocument();
  expect(screen.getByText("公開勤務 0件")).toBeInTheDocument();
  expect(within(filters()).getByRole("status")).toHaveTextContent("0名を表示");
  // Nothing to select, so no selection hint.
  expect(screen.queryByText("選択中の勤務")).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a pharmacist gets their own print and calendar links, and no department export", () => {
  const own = calendar({ visibility: "self", can_export_department: false, assignments: [duty("d1", "synthetic-pharmacist", 1)], changes: [] });
  render(tree({ calendar: own }, "PHARMACIST"));
  const content = "/planning/personal-schedule/synthetic-publication-12/content?scope_id=synthetic%2Fclinical-pharmacy&format=";
  // The address ends with the content path and the format: compared as text, not as a pattern.
  const printHref = screen.getByRole("link", { name: "自分の予定を印刷" }).getAttribute("href") ?? "";
  expect(printHref.endsWith(`${content}print`)).toBe(true);
  expect(screen.getByRole("link", { name: /^カレンダーに追加\s?（\.ics）$/ }).getAttribute("href")).toContain(`${content}ical`);
  expect(screen.getByRole("link", { name: /^カレンダーに追加/ })).toHaveAttribute("download");
  expect(screen.getByText("自分の公開勤務 1件")).toBeInTheDocument();
  expect(people()).toEqual(["ああなた本人"]);
  expect(screen.queryByText("部署の公開版を出力")).toBeNull();
  expect(screen.queryByRole("region", { name: "公開版の登録済み出力" })).toBeNull();
});

test("without a publication the page says so and offers no export", () => {
  render(tree({ calendar: null }, "PHARMACIST", { publication: null, publications: [] }));
  expect(screen.getByText("公開版なし")).toBeInTheDocument();
  expect(screen.getByText("公開版がありません")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "自分の予定を印刷" })).toBeNull();
  expect(within(table()).getByText("表示期間に、あなたの公開済みの勤務はありません。")).toBeInTheDocument();
});

test("the filters narrow the people shown in the table and in the day agenda", () => {
  render(tree({ calendar: calendar() }));
  expect(people()).toEqual(["佐佐藤 美咲", "高高橋 葵", "鈴鈴木 悠斗本人"].sort((a, b) => a.slice(1).localeCompare(b.slice(1), "ja")));
  fireEvent.change(within(filters()).getByLabelText("職員名"), { target: { value: " 高橋 " } });
  expect(within(filters()).getByRole("status")).toHaveTextContent("1名を表示");
  expect(people()).toEqual(["高高橋 葵"]);
  // The agenda shows today (10/12): nobody has a duty then, and nobody else's is selected.
  expect(within(agenda()).getAllByRole("button").filter((item) => item.hasAttribute("aria-pressed")).map((item) => item.textContent)).toEqual(["高高橋 葵勤務なし"]);
  fireEvent.change(within(filters()).getByLabelText("職員名"), { target: { value: "いない" } });
  expect(within(table()).getByText("条件に一致する職員はいません。")).toBeInTheDocument();
  expect(within(agenda()).getByText("条件に一致する職員はいません。")).toBeInTheDocument();
  fireEvent.change(within(filters()).getByLabelText("職員名"), { target: { value: "" } });
  fireEvent.click(within(filters()).getByRole("checkbox", { name: "直前版から変更された職員だけ" }));
  expect(people()).toEqual(["鈴鈴木 悠斗本人"]);
  fireEvent.click(within(filters()).getByRole("checkbox", { name: "直前版から変更された職員だけ" }));
  expect(Array.from(within(filters()).getByLabelText("資格・担当").querySelectorAll("option")).map((item) => item.textContent)).toEqual(["すべて", "本人"]);
  fireEvent.change(within(filters()).getByLabelText("資格・担当"), { target: { value: "本人" } });
  expect(people()).toEqual(["鈴鈴木 悠斗本人"]);
});

test("a duty is selected from the table or the agenda, and the day shown can be changed", () => {
  // Read on 10/1 at 07:00: the leader's own next duty is the late one of 10/2.
  render(tree({ calendar: calendar() }, "LEADER", { observedAt: "2026-10-01T07:00:00+09:00", day: "2026-10-01" }));
  const selected = () => screen.getByText("選択中の勤務").parentElement!.parentElement!;
  // The viewer's own next duty is the one selected to begin with, and the card says why.
  expect(selected()).toHaveTextContent("鈴木 悠斗 · 10月2日あなたの次の勤務です。");
  expect(selected()).toHaveTextContent("遅番 08:30–17:15中央公開版 v12");
  expect(within(table()).getByRole("button", { name: /遅番/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(within(table()).getByRole("row", { name: /高橋 葵/ })).getByRole("button", { name: /日勤/ }));
  expect(selected()).toHaveTextContent("高橋 葵 · 10月1日");
  // Another person's duty is not "your next duty".
  expect(selected()).not.toHaveTextContent("あなたの次の勤務です。");
  expect(within(table()).getByRole("button", { name: /遅番/ })).toHaveAttribute("aria-pressed", "false");
  // The agenda opens on the day of the duty selected to begin with.
  expect(within(agenda()).getByRole("heading", { level: 2 })).toHaveTextContent("10月2日（金）");
  fireEvent.click(within(agenda()).getByRole("button", { name: "前の日" }));
  expect(within(agenda()).getByRole("heading", { level: 2 })).toHaveTextContent("10月1日（木）");
  expect(within(agenda()).getByRole("button", { name: "前の日" })).toBeDisabled();
  fireEvent.click(within(agenda()).getByRole("button", { name: "次の日" }));
  fireEvent.click(within(agenda()).getByRole("button", { name: /佐藤 美咲/ }));
  expect(selected()).toHaveTextContent("佐藤 美咲 · 10月2日");
  fireEvent.change(within(agenda()).getByLabelText("表示する日"), { target: { value: "30" } });
  expect(within(agenda()).getByRole("heading", { level: 2 })).toHaveTextContent("10月31日（土）");
  expect(within(agenda()).getByRole("button", { name: "次の日" })).toBeDisabled();
});

test("without a duty of the viewer's own still to come nothing is selected, and the table and the agenda open on today", () => {
  // Read on 10/12: the leader's duty of 10/2 has ended. Nobody else's duty is picked for them.
  render(tree({ calendar: calendar() }));
  const selected = () => screen.getByText("選択中の勤務").parentElement!.parentElement!;
  expect(selected()).toHaveTextContent("勤務を選んでいません表の勤務を選ぶと、ここに時間と場所を表示します。");
  // The default heading is the product's own sentence, and a day without a duty is too.
  expect(selected().querySelector("[data-verbatim]")).toBeNull();
  expect(Array.from(agenda().querySelectorAll("[data-verbatim]")).map((item) => item.textContent)).not.toContain("勤務なし");
  expect(within(table()).queryByRole("button", { pressed: true })).toBeNull();
  expect(screen.queryByRole("button", { name: "この日を表示" })).toBeNull();
  expect(within(agenda()).getByRole("heading", { level: 2 })).toHaveTextContent("10月12日（月）");
  // Today is marked in the head of its column, in words.
  expect(within(table()).getAllByRole("columnheader").filter((item) => item.textContent?.includes("今日")).map((item) => item.textContent)).toEqual(["10/12 月 今日"]);
});

test("the agenda opens on the day of the duty selected to begin with, and a day is named once", () => {
  render(tree({ calendar: calendar({ assignments: [duty("d9", "synthetic-leader", 9)], changes: [] }) }, "LEADER", { observedAt: "2026-10-08T12:00:00+09:00", day: "2026-10-08" }));
  expect(screen.getByText("選択中の勤務").parentElement!.parentElement!).toHaveTextContent("鈴木 悠斗 · 10月9日");
  expect(within(agenda()).getByRole("heading", { level: 2 })).toHaveTextContent("10月9日（金）");
  expect(within(agenda()).getAllByRole("button", { pressed: true }).map((item) => item.textContent)).toEqual(["鈴鈴木 悠斗本人日勤08:30–17:15"]);
  // The day is drawn once, in the list that chooses it; its heading is for a screen reader.
  expect(within(agenda()).getByRole("heading", { level: 2 })).toHaveClass("sr-only");
  expect(within(agenda()).getByLabelText("表示する日").parentElement).toBe(within(agenda()).getByRole("button", { name: "前の日" }).parentElement);
  // No duty shown is among the server's changes: the mark is not explained.
  expect(screen.queryByText("変更", { selector: "strong" })).not.toBeInTheDocument();
  // That the duties are published is said by the heading of the route, not by every day.
  expect(within(table()).getAllByRole("columnheader").some((item) => item.textContent?.includes("公開済み"))).toBe(false);
  // A day's head reads as its whole date and weekday; the month is drawn only where one begins.
  expect(within(table()).getAllByRole("columnheader").slice(0, 3).map((item) => item.textContent)).toEqual(["職員・資格", "10/1 木", "10/2 金"]);
  expect(within(table()).getAllByRole("columnheader").slice(1, 3).map((item) => item.querySelector("strong > span")?.className)).toEqual(["", "sr-only"]);
  // A duty's two times are read with the dash between them; the dash is not drawn.
  expect(within(table()).getByRole("button", { name: /日勤/ })).toHaveTextContent("日勤08:30–17:15");
  expect(within(table()).getByRole("button", { name: /日勤/ }).querySelector(".sr-only")).toHaveTextContent("–");
  // After another day was looked at, the control brings the day of the selected duty back.
  fireEvent.click(within(agenda()).getByRole("button", { name: "次の日" }));
  expect(within(agenda()).getByRole("heading", { level: 2 })).toHaveTextContent("10月10日（土）");
  fireEvent.click(screen.getByRole("button", { name: "この日を表示" }));
  expect(within(agenda()).getByRole("heading", { level: 2 })).toHaveTextContent("10月9日（金）");
  expect(screen.getByText("選択中の勤務").parentElement!.parentElement!).toHaveTextContent("鈴木 悠斗 · 10月9日");
});

test("the duties are drawn from what the route reads next, and the choices made are kept", () => {
  const view = render(tree({ calendar: calendar() }));
  fireEvent.change(within(filters()).getByLabelText("職員名"), { target: { value: "鈴木" } });
  view.rerender(tree({ calendar: calendar({ assignments: [duty("d2", "synthetic-leader", 2, "夜勤")], changes: [] }) }));
  expect(within(filters()).getByLabelText("職員名")).toHaveValue("鈴木");
  expect(within(table()).getByRole("button", { name: /夜勤/ })).toHaveTextContent("夜勤08:30–17:15");
  expect(screen.getByText("公開勤務 1件")).toBeInTheDocument();
});

test("the head leads to the month before and after: the same route with another period", () => {
  render(tree({ calendar: calendar() }));
  const months = within(screen.getByRole("navigation", { name: "表示する月" })).getAllByRole("link");
  expect(months.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["前の月", "/workspace/schedule?period=2026-09"], ["次の月", "/workspace/schedule?period=2026-11"]]);
});

test("a name typed before React attached narrows the list once it has", async () => {
  const page = tree({ calendar: calendar() });
  const container = document.createElement("div");
  document.body.append(container);
  container.innerHTML = renderToString(page);
  expect(within(container).getByRole("status")).toHaveTextContent("3名を表示");
  (within(container).getByLabelText("職員名") as HTMLInputElement).value = "佐藤";
  await act(async () => { hydrateRoot(container, page); });
  expect(within(container).getByRole("status")).toHaveTextContent("1名を表示");
  expect(within(container).getByLabelText("職員名")).toHaveValue("佐藤");
  // The next change renders again without putting the earlier text back to empty.
  fireEvent.click(within(container).getByRole("checkbox"));
  expect(within(container).getByLabelText("職員名")).toHaveValue("佐藤");
  expect(within(container).getByRole("status")).toHaveTextContent("0名を表示");
});
