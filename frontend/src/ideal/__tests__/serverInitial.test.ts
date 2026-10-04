import { getAuthToken } from "@/lib/auth";
import { loadInitialWorkspace } from "../api/serverInitial";

jest.mock("@/lib/auth", () => ({ getAuthToken: jest.fn(async () => "signed-token") }));
jest.mock("@/lib/httpsDispatcher", () => ({ ensureHttpsDispatcher: jest.fn() }));

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
}) as Response;

const identity = { user_id: "admin", display_name: "合成 管理者", global_role: "ADMIN", identifier_kind: "login_id" };
const scope = { scope_id: "hospital/pharmacy", display_name: "合成病院 薬剤部", person_id: "p-admin", role: "ADMIN", input_revision: 1 };

afterEach(() => jest.restoreAllMocks());

test("the server read is private, parallel-ready data and never cached", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = jest.fn(async (value: RequestInfo | URL, init?: RequestInit) => {
    const url = String(value);
    calls.push({ url, init });
    if (url.endsWith("/auth/me")) return response(identity);
    if (url.endsWith("/planning/scopes")) return response([scope]);
    if (url.includes("/planning/publications")) return response([]);
    if (url.includes("/planning/inputs/latest")) return response({ snapshot: { people: [{ person_id: "p-admin", name: "合成 管理者" }] } });
    if (url.includes("/planning/notifications")) return response([]);
    return response({ detail: "not prepared" }, 404);
  }) as never;

  const result = await loadInitialWorkspace();
  expect(result.problem).toBeNull();
  expect(result.scope?.scope_id).toBe("hospital/pharmacy");
  expect(result.names).toEqual({ "p-admin": "合成 管理者" });
  expect(calls).toHaveLength(9);
  expect(calls.every(({ init }) => init?.cache === "no-store")).toBe(true);
  expect(calls.every(({ init }) => (init?.headers as Record<string, string>).Authorization === "Bearer signed-token")).toBe(true);
  expect(getAuthToken).toHaveBeenCalledTimes(1);
});

test("multiple memberships require an explicit scope before any schedule is read", async () => {
  const other = { ...scope, scope_id: "hospital/ward", display_name: "合成病院 病棟" };
  const calls: string[] = [];
  global.fetch = jest.fn(async (value: RequestInfo | URL) => {
    const url = String(value);
    calls.push(url);
    return url.endsWith("/auth/me") ? response(identity) : response([scope, other]);
  }) as never;

  const result = await loadInitialWorkspace();
  expect(result.selectionRequired).toBe(true);
  expect(result.scope).toBeNull();
  expect(result.scopes).toHaveLength(2);
  expect(calls).toHaveLength(2);
});

test("a route reads only the initial resources needed by that screen", async () => {
  const calls: string[] = [];
  global.fetch = jest.fn(async (value: RequestInfo | URL) => {
    const url = String(value);
    calls.push(url);
    if (url.endsWith("/auth/me")) return response(identity);
    if (url.endsWith("/planning/scopes")) return response([scope]);
    if (url.includes("/planning/publications")) return response([]);
    if (url.includes("/planning/notifications")) return response([]);
    return response({ detail: "unexpected route-specific read" }, 500);
  }) as never;

  const result = await loadInitialWorkspace(undefined, "governance");
  expect(result.problem).toBeNull();
  expect(calls).toHaveLength(4);
  expect(calls.some((url) => url.includes("schedule-calendar"))).toBe(false);
  expect(calls.some((url) => url.includes("daily-operations"))).toBe(false);
  expect(calls.some((url) => url.includes("inputs/latest"))).toBe(false);
});

test("an explicit period and publication select the same server data instead of only changing the heading", async () => {
  const publications = [
    { publication_id: "pub-old", version: 2, period: "2026-09-01T00:00:00+09:00|2026-10-01T00:00:00+09:00", assignments: [] },
    { publication_id: "pub-current", version: 3, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00", assignments: [] },
  ];
  const calls: string[] = [];
  global.fetch = jest.fn(async (value: RequestInfo | URL) => {
    const url = String(value); calls.push(url);
    if (url.endsWith("/auth/me")) return response(identity);
    if (url.endsWith("/planning/scopes")) return response([scope]);
    if (url.includes("/planning/publications")) return response(publications);
    if (url.includes("/planning/schedule-calendar")) return response({ scope_id: scope.scope_id, requested_period: "2026-09", visibility: "department", publication: { publication_id: "pub-old", version: 2, period: publications[0].period, input_hash: "input", created_at: "2026-08-20T00:00:00Z" }, previous_publication: null, assignments: [], changes: [], can_export_department: true, limitations: [] });
    if (url.includes("/planning/inputs/latest")) return response({ snapshot: { people: [] } });
    if (url.includes("/planning/notifications")) return response([]);
    return response({ detail: "not prepared" }, 404);
  }) as never;

  const result = await loadInitialWorkspace(scope.scope_id, "schedule", { period: "2026-09", publicationId: "pub-old" });
  expect(result.problem).toBeNull();
  expect(result.requestedPeriod).toBe("2026-09");
  expect(result.selectedPublicationId).toBe("pub-old");
  expect(calls.some((url) => url.includes("schedule-calendar") && url.includes("period=2026-09"))).toBe(true);
});

test("a publication outside the authorized scope and a mismatched period never fall back", async () => {
  const publication = { publication_id: "pub-current", version: 3, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00", assignments: [] };
  global.fetch = jest.fn(async (value: RequestInfo | URL) => {
    const url = String(value);
    if (url.endsWith("/auth/me")) return response(identity);
    if (url.endsWith("/planning/scopes")) return response([scope]);
    if (url.includes("/planning/publications")) return response([publication]);
    return response([]);
  }) as never;

  const absent = await loadInitialWorkspace(scope.scope_id, "schedule", { publicationId: "other-scope-publication" });
  expect(absent.problem).toEqual(expect.objectContaining({ status: 404 }));
  const mismatch = await loadInitialWorkspace(scope.scope_id, "schedule", { period: "2026-09", publicationId: "pub-current" });
  expect(mismatch.problem).toEqual(expect.objectContaining({ status: 409 }));
});

test("a person outside the authorized scope is refused rather than used by a form", async () => {
  const calls: string[] = [];
  global.fetch = jest.fn(async (value: RequestInfo | URL) => {
    const url = String(value); calls.push(url);
    if (url.endsWith("/auth/me")) return response(identity);
    if (url.endsWith("/planning/scopes")) return response([scope]);
    if (url.includes("/planning/publications")) return response([]);
    if (url.includes("/planning/inputs?")) return response([{ input_hash: "input-current" }]);
    if (url.includes("/planning/inputs/latest")) return response({ snapshot: { people: [{ person_id: "p-admin", name: "合成 管理者" }] } });
    if (url.includes("/planning/compliance/records")) return response([]);
    if (url.includes("/planning/notifications")) return response([]);
    return response({ detail: "not prepared" }, 404);
  }) as never;

  const result = await loadInitialWorkspace(scope.scope_id, "governance", { personId: "outside-this-scope" });
  expect(result.problem).toEqual(expect.objectContaining({ status: 404 }));
  expect(result.selectedPersonId).toBeNull();
  expect(calls.some((url) => url.includes("/planning/inputs?"))).toBe(true);
});

test("a contract person not yet present in the latest planning input remains selectable", async () => {
  global.fetch = jest.fn(async (value: RequestInfo | URL) => {
    const url = String(value);
    if (url.endsWith("/auth/me")) return response(identity);
    if (url.endsWith("/planning/scopes")) return response([scope]);
    if (url.includes("/planning/publications")) return response([]);
    if (url.includes("/planning/inputs?")) return response([{ input_hash: "input-current" }, { input_hash: "input-old" }]);
    if (url.includes("input_hash=input-old")) return response({ snapshot: { people: [{ person_id: "p-admin", name: "旧名 管理者" }] } });
    if (url.includes("/planning/inputs/latest")) return response({ snapshot: { people: [{ person_id: "p-admin", name: "合成 管理者" }] } });
    if (url.includes("/planning/compliance/records")) return response([{ kind: "person", entity_id: "p-new", payload: { person_id: "p-new", name: "合成 新任" } }]);
    if (url.includes("/planning/notifications")) return response([]);
    return response({ detail: "not prepared" }, 404);
  }) as never;

  const result = await loadInitialWorkspace(scope.scope_id, "people", { personId: "p-new" });
  expect(result.problem).toBeNull();
  expect(result.selectedPersonId).toBe("p-new");
  expect(result.names["p-new"]).toBe("合成 新任");
  expect(result.names["p-admin"]).toBe("合成 管理者");
});

test("a supplementary notification failure does not erase the schedule", async () => {
  const publication = { publication_id: "pub-current", version: 3, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00", assignments: [] };
  global.fetch = jest.fn(async (value: RequestInfo | URL) => {
    const url = String(value);
    if (url.endsWith("/auth/me")) return response(identity);
    if (url.endsWith("/planning/scopes")) return response([scope]);
    if (url.includes("/planning/publications")) return response([publication]);
    if (url.includes("/planning/schedule-calendar")) return response({ scope_id: scope.scope_id, requested_period: "2026-10", visibility: "department", publication: null, previous_publication: null, assignments: [], changes: [], can_export_department: true, limitations: [] });
    if (url.includes("/planning/inputs/latest")) return response({ snapshot: { people: [] } });
    if (url.includes("/planning/notifications")) return response({ detail: "temporary" }, 503);
    return response({ detail: "not prepared" }, 404);
  }) as never;

  const result = await loadInitialWorkspace(scope.scope_id, "schedule", { period: "2026-10" });
  expect(result.problem).toBeNull();
  expect(result.calendar).not.toBeNull();
  expect(result.partialProblems).toEqual([expect.objectContaining({ resource: "通知", status: 503 })]);
});

test("the privacy-purpose route validates another scope person without ordinary planning reads", async () => {
  const calls: string[] = [];
  global.fetch = jest.fn(async (value: RequestInfo | URL) => {
    const url = String(value); calls.push(url);
    if (url.endsWith("/auth/me")) return response(identity);
    if (url.endsWith("/planning/scopes")) return response([scope]);
    if (url.includes("/planning/compliance/privacy")) return response({ people: [{ person_id: "p-other", name: "合成 対象者" }], cases: [], rules: [], holds: [] });
    return response({ detail: "利用を制限しています" }, 423);
  }) as never;

  const result = await loadInitialWorkspace(scope.scope_id, "governance", { publicationId: "pub-from-schedule", personId: "p-other" }, "privacy");
  expect(result.problem).toBeNull();
  expect(result.scope?.scope_id).toBe(scope.scope_id);
  expect(result.selectedPersonId).toBe("p-other");
  expect(result.publications).toEqual([]);
  expect(calls.some((url) => url.includes("/planning/publications"))).toBe(false);
  expect(calls.some((url) => url.includes("/planning/notifications"))).toBe(false);
  expect(calls.some((url) => url.includes("/planning/inputs"))).toBe(false);
  expect(calls.some((url) => url.includes("/planning/compliance/records"))).toBe(false);
});
