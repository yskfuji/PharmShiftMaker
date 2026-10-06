import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createIdealClient, type DirectoryRecords } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { LifecycleCase, MembershipRevision } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute, type RouteContext } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { DirectoryData } from "../DirectoryPanel";
import { directoryOf } from "../model";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const member = (over: Partial<MembershipRevision>): MembershipRevision => ({
  membership_id: "m-admin", issuer: "mock", subject: "admin-account", person_id: "synthetic-admin", scope_id: "synthetic/clinical-pharmacy", role: "ADMIN", active: true, revision: 1,
  evidence: {}, created_by: "", created_at: "2026-10-01T09:00:00+09:00", deactivated_at: null, ...over,
});
const lifecycle = { case_id: "c1", person_id: "synthetic-pharmacist", kind: "ONBOARD", status: "IN_PROGRESS", tasks: [] } as unknown as LifecycleCase;
/** The workflow context as the endpoint answers: the directory's part, and far more. */
const context = {
  people: [{ person_id: "p-unlinked", name: "合成 未紐付け", note: "面談記録" }],
  contracts: [{ person_id: "synthetic-pharmacist", revision_id: "contract-secret", contractual_week_seconds: 115200 }],
  capabilities: [],
  records: [
    { kind: "contract", entity_id: "e1", revision: 1, payload: { person_id: "synthetic-pharmacist", employer_id: "employer-secret" } },
    { kind: "capability", entity_id: "e2", revision: 1, payload: { person_id: "synthetic-pharmacist", task: "task-secret" } },
    { kind: "leave_account", entity_id: "e3", revision: 1, payload: { person_id: "synthetic-pharmacist", account_id: "leave-secret" } },
  ],
  employments: [{ person_id: "synthetic-pharmacist", revision_id: "employment-secret" }],
  leave_accounts: [{ account_id: "leave-secret" }],
  leave_records: [{ event_id: "leave-event-secret" }],
  actuals: [{ actual_id: "actual-secret" }],
  publications: [{ publication_id: "publication-secret" }],
} as unknown as DirectoryRecords;
const records = directoryOf(context);
const data: DirectoryData = { memberships: [member({}), member({ membership_id: "m-ph", person_id: "synthetic-pharmacist", role: "PHARMACIST", revision: 4 })], records, cases: [lifecycle] };

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

async function mount(value: DirectoryData, answer: (call: Call) => unknown = () => [], over: Partial<RouteContext> = {}) {
  const ctx = { ...syntheticContext("ADMIN"), ...over };
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const View = route.View;
  await act(async () => { render(<LiveProvider live={liveFrom(ctx, { client, mutate: createMutator("test"), refresh })}><View data={value} ctx={ctx} /></LiveProvider>); });
  return { calls, refresh };
}
const detail = () => document.querySelector<HTMLElement>(".ideal-v3-master-detail .ideal-v3-detail")!;

test("the route reads what the directory shows: active links, people records and cases", async () => {
  const { calls, client } = api((call) => call.path.startsWith("/compliance/workflow-context") ? context : []);
  const state = await readRoute(route, client, syntheticContext("ADMIN"));
  expect(state).toMatchObject({ kind: "ready", partial: [], data: { memberships: [], records, cases: [] } });
  expect(calls.map((call) => `${call.method} ${call.path}`).sort()).toEqual([
    `GET /compliance/workflow-context?${SCOPE}`,
    `GET /lifecycle-cases?${SCOPE}`,
    `GET /memberships?${SCOPE}&include_inactive=false`,
  ]);
  expect(route.names).toBe("roster");
});

test("of the workflow context only the people and two counts per person are handed to the view", async () => {
  const { client } = api((call) => call.path.startsWith("/compliance/workflow-context") ? context : []);
  const state = await readRoute(route, client, syntheticContext("ADMIN"));
  if (state.kind !== "ready") throw new Error("the route was not read");
  // Exactly this, and nothing of the employment, contract, leave, actual-work or publication payloads.
  expect(state.data.records).toEqual({
    people: [{ person_id: "p-unlinked", name: "合成 未紐付け" }],
    counts: [{ person_id: "synthetic-pharmacist", contracts: 2, capabilities: 1 }],
  });
  expect(Object.keys(state.data).sort()).toEqual(["cases", "memberships", "records"]);
  const sent = JSON.stringify(state.data);
  expect(sent).not.toMatch(/secret|面談記録|contractual_week_seconds|employments|leave_|actuals|publications|payload/);
});

test("a context without the directory's lists is an empty directory, never an error", () => {
  expect(directoryOf({} as DirectoryRecords)).toEqual({ people: [], counts: [] });
  // A record that names no person is not counted for anyone.
  expect(directoryOf({ people: [], contracts: [{}], capabilities: [{ person_id: "" }], records: [] })).toEqual({ people: [], counts: [] });
});

test("cases that cannot be read are reported beside a directory that is still shown", async () => {
  const { client } = api((call) => {
    if (call.path.startsWith("/lifecycle-cases")) throw new PlanningError(503, "restore gate");
    return call.path.startsWith("/compliance/workflow-context") ? context : [];
  });
  expect(await readRoute(route, client, syntheticContext("ADMIN"))).toEqual({
    kind: "ready",
    data: { memberships: [], records, cases: [] },
    partial: [{ resource: "入職・退職", status: 503, detail: "restore gate" }],
  });
  const refused = api((call) => { if (call.path.startsWith("/memberships")) throw new PlanningError(403, "admin only"); return context; });
  expect(await readRoute(route, refused.client, syntheticContext("ADMIN"))).toEqual({ kind: "problem", status: 403, detail: "admin only" });
});

test("the showcase shows the directory; with no records every person still has a detail", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="people" view="directory" role="ADMIN" />);
  const list = await screen.findByRole("list", { name: "職員一覧" });
  expect(within(list).getAllByRole("button").map((button) => button.textContent)).toEqual(["佐佐藤 美咲システム管理者 · 有効", "鈴鈴木 悠斗本人アカウント未紐付け", "高高橋 葵薬剤師 · 有効", "ヴヴァンデンバーグ 絵里香クリスティーナ薬剤師 · 有効"]);
  expect(detail()).toHaveTextContent("システム管理者・有効（第1版）");
  ready.unmount();
  // Nothing yet: no roster in the context and no records, so the directory says so itself.
  render(<CognitiveWorkspaceShowcase screen="people" view="directory" role="ADMIN" state="empty" />);
  expect(await screen.findByText("表示できる職員はいません。")).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "職員一覧" })).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("with a roster and no records every person still has a detail", async () => {
  // The roster of the context, and every list of the route's own read empty.
  await mount({ memberships: [], records: { people: [], counts: [] }, cases: [] });
  expect(await screen.findByRole("status")).toHaveTextContent("4名を表示");
  expect(detail()).toHaveTextContent("本人アカウント未紐付け契約登録なし資格登録なし入職・退職進行中の手続きなし");
});

test("the first person is selected; choosing another shows that person's records and links", async () => {
  await mount(data);
  expect(within(detail()).getByRole("heading", { level: 3, name: "佐藤 美咲" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("list", { name: "職員一覧" })).getByRole("button", { name: /高橋 葵/ }));
  expect(detail()).toHaveTextContent("薬剤師・有効（第4版）");
  expect(detail()).toHaveTextContent("契約2件（原本記録あり）");
  expect(detail()).toHaveTextContent("資格1件（原本記録あり）");
  expect(detail()).toHaveTextContent("入職・進行中");
  expect(within(within(detail()).getByRole("navigation", { name: "選択職員の詳細" })).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["本人アカウント", "/workspace/people/memberships?person=synthetic-pharmacist"],
    ["契約・資格", "/workspace/people/contracts?person=synthetic-pharmacist"],
    ["入職・退職", "/workspace/people/lifecycle?person=synthetic-pharmacist"],
    // The direct way to file a privacy request on the person's behalf: the person travels in
    // the URL, and the server selects them only after checking them against the roster.
    ["個人情報の請求", "/workspace/governance/privacy?person=synthetic-pharmacist"],
  ]);
});

test("the search narrows by name or id, and a person known only from the records is listed", async () => {
  await mount(data);
  fireEvent.change(screen.getByLabelText("職員を検索"), { target: { value: "p-unlinked" } });
  expect(screen.getByRole("status")).toHaveTextContent("1名を表示");
  const unlinked = within(screen.getByRole("list", { name: "職員一覧" })).getByRole("button", { name: /合成 未紐付け/ });
  expect(unlinked).toHaveTextContent("本人アカウント未紐付け");
  fireEvent.click(unlinked);
  expect(unlinked).toHaveAttribute("aria-pressed", "true");
  expect(within(detail()).getByRole("link", { name: "本人アカウント" })).toHaveAttribute("href", "/workspace/people/memberships?person=p-unlinked");
});

test("the person the URL names is the one selected", async () => {
  await mount(data, () => [], { selectedPersonId: "synthetic-pharmacist" });
  expect(within(detail()).getByRole("heading", { level: 3, name: "高橋 葵" })).toBeInTheDocument();
});

test("a person that is no longer listed can be replaced from the list", async () => {
  await mount(data, () => [], { selectedPersonId: "p-gone" });
  expect(screen.getByRole("alert")).toHaveTextContent("指定された職員を表示できません");
  fireEvent.click(screen.getByRole("button", { name: "職員一覧から選び直す" }));
  expect(within(detail()).getByRole("heading", { level: 3, name: "佐藤 美咲" })).toBeInTheDocument();
});

test("inactive links are read only when asked for, and the active ones stay until they arrive", async () => {
  const { calls } = await mount(data, () => [...data.memberships, member({ membership_id: "m-old", person_id: "synthetic-leader", role: "LEADER", active: false, revision: 2 })]);
  expect(calls).toEqual([]);
  fireEvent.click(within(screen.getByRole("list", { name: "職員一覧" })).getByRole("button", { name: /鈴木 悠斗/ }));
  expect(detail()).toHaveTextContent("本人アカウント未紐付け");
  fireEvent.click(screen.getByRole("checkbox", { name: "無効も表示" }));
  await waitFor(() => expect(detail()).toHaveTextContent("薬剤部責任者・無効（第2版）"));
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET /memberships?${SCOPE}&include_inactive=true`]);
});
