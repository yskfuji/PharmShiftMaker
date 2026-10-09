import { render, screen } from "@testing-library/react";
import { PlanningError } from "@/lib/planningTransport";
import { createServerTransport } from "../server/transport";
import WorkspaceRoutePage from "../WorkspaceRoutePage";

// The real server transport, context and route definitions; only the network and the
// cookie store are replaced. What is asserted here is what leaves the server for the API.
const mockCookies = jest.fn();
jest.mock("next/headers", () => ({ cookies: () => mockCookies() }));
jest.mock("@/lib/httpsDispatcher", () => ({ ensureHttpsDispatcher: jest.fn() }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }), usePathname: () => "/workspace/schedule", useSearchParams: () => new URLSearchParams() }));
// The refresh action is server code; these tests render the route once and never call it.
jest.mock("next/cache", () => ({ refresh: jest.fn() }));
jest.mock("@/components/IdentityProvider", () => ({ useIdentity: () => ({ identity: { user_id: "admin" } }) }));

const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
const identity = { user_id: "admin", display_name: "合成 管理者", global_role: "ADMIN", identifier_kind: "login_id" };
const scope = { scope_id: "hospital/pharmacy", display_name: "合成病院 薬剤部", person_id: "p-admin", role: "ADMIN", input_revision: 1 };
const publications = [
  { publication_id: "pub-old", version: 2, period: "2026-09-01T00:00:00+09:00|2026-10-01T00:00:00+09:00", assignments: [], validation_status: "valid" },
  { publication_id: "pub-current", version: 3, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00", assignments: [], validation_status: "valid" },
];
const calendar = { scope_id: scope.scope_id, requested_period: "2026-09", visibility: "department", publication: { publication_id: "pub-old", version: 2, period: publications[0].period, input_hash: "input", created_at: "2026-08-20T00:00:00Z" }, previous_publication: null, assignments: [], changes: [], can_export_department: true, limitations: [] };

type Call = { url: string; init?: RequestInit };
function network(answer: (path: string) => Response | undefined): Call[] {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (value: RequestInfo | URL, init?: RequestInit) => {
    const url = String(value);
    calls.push({ url, init });
    const path = new URL(url).pathname + new URL(url).search;
    return answer(path) ?? response({ detail: "not prepared" }, 404);
  }) as never;
  return calls;
}
const ordinary = (path: string) => {
  if (path === "/auth/me") return response(identity);
  if (path === "/planning/scopes") return response([scope]);
  if (path.startsWith("/planning/publications?")) return response(publications);
  if (path.startsWith("/planning/inputs/latest?")) return response({ snapshot: { people: [{ person_id: "p-admin", name: "合成 管理者" }] } });
  if (path.startsWith("/planning/notifications?")) return response([]);
  if (path.startsWith("/planning/schedule-calendar?")) return response(calendar);
  return undefined;
};
const pathsOf = (calls: Call[]) => calls.map(({ url }) => new URL(url).pathname + new URL(url).search).sort();

beforeEach(() => { mockCookies.mockReset(); mockCookies.mockResolvedValue({ get: () => ({ value: "signed-token" }) }); });
afterEach(() => jest.restoreAllMocks());

test("every server read of a route is private: never cached, with the viewer's bearer token, each path once", async () => {
  const calls = network(ordinary);
  render(await WorkspaceRoutePage({ screen: "schedule", search: { scope: scope.scope_id, period: "2026-09", publication: "pub-old" } }));
  expect(await screen.findByRole("heading", { level: 1, name: "勤務表" })).toBeInTheDocument();
  // The context (who, which scope, what the URL selects, names, notifications) and the
  // route's own read, with the period and the publication the URL names. Nothing else.
  const query = "scope_id=hospital%2Fpharmacy";
  expect(pathsOf(calls)).toEqual([
    "/auth/me",
    `/planning/inputs/latest?${query}`,
    `/planning/notifications?${query}`,
    `/planning/publications?${query}`,
    `/planning/schedule-calendar?${query}&period=2026-09`,
    "/planning/scopes",
  ]);
  expect(calls.every(({ init }) => init?.cache === "no-store")).toBe(true);
  expect(calls.every(({ init }) => (init?.headers as Record<string, string>).Authorization === "Bearer signed-token")).toBe(true);
  expect(calls.every(({ init }) => (init?.method ?? "GET") === "GET")).toBe(true);
  // The session cookie is read once per rendered request, and is not in what is rendered.
  expect(mockCookies).toHaveBeenCalledTimes(1);
  expect(document.body.innerHTML).not.toContain("signed-token");
});

test("a failed notification read is said beside the schedule and does not replace it", async () => {
  network((path) => (path.startsWith("/planning/notifications?") ? response({ detail: "temporary" }, 503) : ordinary(path)));
  render(await WorkspaceRoutePage({ screen: "schedule", search: { scope: scope.scope_id, period: "2026-09" } }));
  expect(await screen.findByRole("heading", { level: 1, name: "勤務表" })).toBeInTheDocument();
  const notice = (await screen.findByText("一部の情報を更新できませんでした")).closest("section")!;
  expect(notice).toHaveTextContent("通知");
  expect(notice).toHaveTextContent("503");
  // The schedule of the period is on screen; the route was not replaced by a problem.
  expect(screen.queryByRole("heading", { name: "読み込めませんでした" })).toBeNull();
  expect(screen.getByText(/公開版 v2/)).toBeInTheDocument();
});

test("a publication the scope does not have and a period that is not the publication's are refused, and the route is not read", async () => {
  for (const [search, status] of [[{ publication: "other-scope-publication" }, 404], [{ period: "2026-09", publication: "pub-current" }, 409]] as const) {
    const calls = network(ordinary);
    const view = render(await WorkspaceRoutePage({ screen: "schedule", search: { scope: scope.scope_id, ...search } }));
    expect(screen.getByRole("alert")).toHaveTextContent(String(status));
    expect(pathsOf(calls).some((path) => path.includes("schedule-calendar"))).toBe(false);
    view.unmount();
  }
});

// The role gate comes before anything a route would read: its roster, the person its URL
// names and its own data. Every path a refused route could have asked for is prepared here,
// so a read that was made would be answered and recorded, not hidden by a 404.
test.each([
  ["a leader opening the contract records", "LEADER", "people", "contracts", {}],
  ["a leader opening the privacy-purpose route for another person", "LEADER", "governance", "privacy", { person: "p-other" }],
  ["a pharmacist opening the planning input", "PHARMACIST", "plan", "input", {}],
] as const)("%s: only the mandatory context is read, and the route is refused", async (_name, role, name, view, search) => {
  const calls = network((path) => {
    if (path === "/planning/scopes") return response([{ ...scope, role }]);
    if (path.startsWith("/planning/inputs?")) return response([{ input_hash: "h1" }]);
    if (path.startsWith("/planning/inputs/latest?")) return response({ input_hash: "h1", snapshot: { people: [{ person_id: "p-other", name: "合成 対象者" }] } });
    if (path.startsWith("/planning/compliance/records?")) return response([{ kind: "person", entity_id: "p-other", payload: { name: "合成 対象者" } }]);
    if (path.startsWith("/planning/compliance/privacy?")) return response({ people: [{ person_id: "p-other", name: "合成 対象者" }], cases: [], rules: [], holds: [] });
    return ordinary(path) ?? response({});
  });
  render(await WorkspaceRoutePage({ screen: name, view, search: { scope: scope.scope_id, ...search } }));
  expect(screen.getByRole("heading", { name: "この画面は、あなたの役割では開けません" })).toBeInTheDocument();
  const query = "scope_id=hospital%2Fpharmacy";
  expect(pathsOf(calls)).toEqual(["/auth/me", `/planning/notifications?${query}`, `/planning/publications?${query}`, "/planning/scopes"]);
  expect(document.body.textContent).not.toContain("合成 対象者");
});

test("the server transport refuses every change, reports the API's own detail and sends no header without a session", async () => {
  mockCookies.mockResolvedValue({ get: () => undefined });
  const calls = network((path) => (path === "/planning/locked" ? response({ detail: "利用を制限しています" }, 423) : response({ ok: true })));
  const transport = await createServerTransport();
  await expect(transport.request("/drafts/d1/publish", "POST", {})).rejects.toMatchObject({ status: 405 });
  expect(calls).toEqual([]);
  await expect(transport.request("/locked")).rejects.toEqual(new PlanningError(423, "利用を制限しています"));
  expect(await transport.read("/auth/me")).toEqual({ ok: true });
  expect(calls.map(({ init }) => [init?.cache, init?.headers])).toEqual([["no-store", undefined], ["no-store", undefined]]);
});
