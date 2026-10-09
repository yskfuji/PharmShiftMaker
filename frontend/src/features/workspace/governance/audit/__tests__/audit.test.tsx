import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { AuditEntry, AuditTimelinePage } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import { eventLabel } from "../labels";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const ctx = syntheticContext("ADMIN");
const entry = (kind: string, over: Partial<AuditEntry> = {}): AuditEntry =>
  ({ at: "2026-10-12T07:42:00+09:00", kind, category: kind.split(".")[0], actor_role: "ADMIN", subject_count: 2, version: 3, ...over });
const page = (entries: AuditEntry[], next_cursor: string | null = null): AuditTimelinePage =>
  ({ entries, next_cursor, sources: [], limits: ["氏名・職員IDは表示しません。"] });

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

async function mount(data: AuditTimelinePage, answer: (call: Call) => unknown) {
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const View = route.View;
  await act(async () => { render(<LiveProvider live={liveFrom(ctx, { client, mutate: createMutator("test"), refresh })}><View data={data} ctx={ctx} /></LiveProvider>); });
  return { calls, refresh };
}

test("the route reads the newest page of every category and nothing else, without a roster", async () => {
  const { calls, client } = api(() => page([]));
  const state = await readRoute(route, client, ctx);
  expect(state).toMatchObject({ kind: "ready", partial: [] });
  expect(calls).toEqual([{ method: "GET", path: `/audit-timeline?${SCOPE}&limit=20`, body: undefined }]);
  expect(route.names).toBe("none");
});

test("the showcase shows the timeline, and the route's own words when nothing is recorded", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="governance" view="audit" role="ADMIN" />);
  const timeline = await screen.findByRole("region", { name: "監査タイムライン" });
  expect(timeline).toHaveTextContent("勤務表を公開");
  expect(timeline).toHaveTextContent("記録種別 schedule.published");
  expect(timeline).toHaveTextContent("氏名・職員IDは表示しません。");
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="governance" view="audit" role="ADMIN" state="empty" />);
  expect(await screen.findByText("記録はありません。")).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("the view is the timeline alone: the other governance routes are the shell's tabs and are not repeated", async () => {
  await mount(page([]), () => page([]));
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["監査タイムライン"]);
  expect(screen.queryAllByRole("link")).toEqual([]);
});

test("the first page is shown from the route's read, with no request from the browser", async () => {
  const { calls } = await mount(page([entry("compliance.scope_setting", { subject_count: null, version: null, actor_role: null })]), () => page([]));
  const timeline = screen.getByRole("region", { name: "監査タイムライン" });
  expect(timeline).toHaveTextContent("欠勤同意設定を変更");
  expect(timeline).toHaveTextContent("管理記録 · 役割不明 · 関係した人 —");
  expect(timeline).toHaveTextContent("記録種別 compliance.scope_setting");
  expect(within(timeline).queryByRole("button")).toBeNull();
  expect(calls).toEqual([]);
});

test("a category and older pages are read on demand and added to what is shown", async () => {
  const { calls } = await mount(page([entry("schedule.published")], "cursor-1"), (call) =>
    call.path.includes("before=") ? page([entry("change.approved", { at: "2026-10-11T07:00:00+09:00" })]) : page([entry("change.rejected")], "cursor-2"));
  const timeline = screen.getByRole("region", { name: "監査タイムライン" });
  fireEvent.change(screen.getByLabelText("種類"), { target: { value: "change" } });
  await waitFor(() => expect(timeline).toHaveTextContent("変更ケースを却下"));
  expect(timeline).not.toHaveTextContent("勤務表を公開");
  fireEvent.click(within(timeline).getByRole("button", { name: "さらに読み込む" }));
  await waitFor(() => expect(timeline).toHaveTextContent("変更ケースを承認"));
  expect(timeline).toHaveTextContent("変更ケースを却下");
  expect(within(timeline).queryByRole("button", { name: "さらに読み込む" })).toBeNull();
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    `GET /audit-timeline?${SCOPE}&limit=20&category=change`,
    `GET /audit-timeline?${SCOPE}&limit=20&before=cursor-2&category=change`,
  ]);
  // Back to every category: the route's own page again, without asking the server.
  await act(async () => { fireEvent.change(screen.getByLabelText("種類"), { target: { value: "" } }); });
  expect(timeline).toHaveTextContent("勤務表を公開");
  expect(calls).toHaveLength(2);
});

test("an older page that cannot be read is reported in place and keeps what is shown", async () => {
  await mount(page([entry("schedule.published")], "cursor-1"), () => { throw new PlanningError(409, "stale"); });
  const timeline = screen.getByRole("region", { name: "監査タイムライン" });
  fireEvent.click(within(timeline).getByRole("button", { name: "さらに読み込む" }));
  expect(await within(timeline).findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(timeline).toHaveTextContent("勤務表を公開");
});

test("the role that acted, the category and the version are shown in words, never as a code", async () => {
  await mount(page([
    entry("schedule.published", { actor_role: "LEADER", version: 12 }),
    entry("change.approved", { actor_role: "PHARMACIST" }),
    entry("membership.linked", { actor_role: "AUDITOR" as never, category: "billing" }),
  ]), () => page([]));
  const lines = within(screen.getByRole("region", { name: "監査タイムライン" })).getAllByRole("listitem").slice(0, 3).map((item) => item.querySelector("p")?.textContent);
  expect(lines).toEqual([
    "計画・公開 · 薬剤部責任者 · 関係した人 2名 · 第12版",
    "欠勤・交換 · 薬剤師 · 関係した人 2名 · 第3版",
    "未対応の値 · 未対応の値 · 関係した人 2名 · 第3版",
  ]);
  expect(screen.getByRole("region", { name: "監査タイムライン" })).not.toHaveTextContent(/LEADER|PHARMACIST|AUDITOR|billing/);
});

test("an event kind without its own wording is named by area and action", () => {
  expect(eventLabel("membership.linked")).toBe("本人アカウントを紐付け");
  expect(eventLabel("privacy.erased")).toBe("個人情報を消去");
  expect(eventLabel("lifecycle.onboard.created")).toBe("入職の手続きを開始");
  expect(eventLabel("compliance.thing")).toBe("管理記録を記録");
  // An area this code does not know is not named as a record of another area.
  expect(eventLabel("unknown.thing")).toBe("未対応の値");
  expect(eventLabel("constructor.created")).toBe("未対応の値");
  // A first part the server sorts into one of its areas has its own word (shared/labels.ts);
  // one this code does not name is named by the area the server returned with the entry.
  expect(eventLabel("erasure.executed", "privacy")).toBe("消去を記録");
  expect(eventLabel("draft.created", "schedule")).toBe("勤務案を作成");
  expect(eventLabel("leave.request", "request")).toBe("休暇を記録");
  expect(eventLabel("actual.imported", "compliance")).toBe("勤務実績を取込");
  expect(eventLabel("thing.done", "other")).toBe("その他");
  // The kind's own wording and its own prefix come first; an unknown category changes nothing.
  expect(eventLabel("schedule.published", "privacy")).toBe("勤務表を公開");
  expect(eventLabel("privacy.erased", "nonsense")).toBe("個人情報を消去");
  expect(eventLabel("unknown.thing", "nonsense")).toBe("未対応の値");
  expect(eventLabel("unknown.thing", "constructor")).toBe("未対応の値");
  expect(eventLabel("unknown.thing", null)).toBe("未対応の値");
});
