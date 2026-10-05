import { PlanningError } from "@/lib/planningTransport";
import { defineRoute, readRoute, type RouteContext } from "../routeTypes";
import { loadWorkspaceContext } from "../server/context";
import { oncePerRequest } from "../server/oncePerRequest";
import type { ServerTransport } from "../server/transport";

const identity = { user_id: "admin", display_name: "合成 管理者", global_role: "ADMIN", identifier_kind: "login_id" };
const scope = { scope_id: "hospital/pharmacy", display_name: "合成病院 薬剤部", person_id: "p-admin", role: "ADMIN", input_revision: 1 };
const publication = { publication_id: "pub-1", version: 3, period: "2026-01-01T00:00:00+09:00|2026-02-01T00:00:00+09:00", assignments: [], validation_status: "valid" };

/** A transport answering from a table of path prefixes; every path read is recorded. */
function transport(answers: Record<string, unknown | ((path: string) => unknown)>): ServerTransport & { paths: string[] } {
  const paths: string[] = [];
  const read = async <T,>(path: string): Promise<T> => {
    paths.push(path);
    const key = Object.keys(answers).find((prefix) => path.split("?")[0] === prefix);
    if (!key) throw new PlanningError(404, "not prepared");
    const value = answers[key];
    return (typeof value === "function" ? (value as (path: string) => unknown)(path) : value) as T;
  };
  return { paths, read, request: <T,>(path: string) => read<T>(`/planning${path}`) };
}
const base = { "/auth/me": identity, "/planning/scopes": [scope], "/planning/publications": [publication], "/planning/notifications": [] };
const pathsOf = (t: { paths: string[] }) => t.paths.map((path) => path.split("?")[0]).sort();

test("a route that needs no roster reads only the mandatory context", async () => {
  const t = transport(base);
  const result = await loadWorkspaceContext(t, undefined, { period: "2026-01" }, () => "none");
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") return;
  expect(result.ctx.scope.scope_id).toBe("hospital/pharmacy");
  expect(result.ctx.publication?.publication_id).toBe("pub-1");
  expect(result.ctx.names).toEqual({});
  expect(pathsOf(t)).toEqual(["/auth/me", "/planning/notifications", "/planning/publications", "/planning/scopes"]);
  // The context is plain data: nothing in it is a credential.
  expect(JSON.stringify(result)).not.toMatch(/token|authorization|bearer/i);
});

test("several memberships and no scope in the URL: nothing person-specific is read", async () => {
  const t = transport({ ...base, "/planning/scopes": [scope, { ...scope, scope_id: "hospital/ward" }] });
  const result = await loadWorkspaceContext(t, undefined, {}, () => "roster");
  expect(result.kind).toBe("select-scope");
  expect(result.scopes).toHaveLength(2);
  expect(pathsOf(t)).toEqual(["/auth/me", "/planning/scopes"]);
});

test("a scope the viewer does not belong to is refused, never replaced by another", async () => {
  const t = transport(base);
  const result = await loadWorkspaceContext(t, "hospital/other", {}, () => "none");
  expect(result).toMatchObject({ kind: "problem", status: 403 });
  expect(pathsOf(t)).toEqual(["/auth/me", "/planning/scopes"]);
});

test("the roster is read by need and by role", async () => {
  const input = { input_hash: "h1", snapshot: { people: [{ person_id: "p-admin", name: "合成 管理者" }, { person_id: "p1", name: "合成 一郎" }] } };
  const planning = transport({ ...base, "/planning/inputs/latest": input });
  const planned = await loadWorkspaceContext(planning, undefined, { period: "2026-01" }, () => "planning");
  expect(planned.kind === "ready" && planned.ctx.names).toEqual({ "p-admin": "合成 管理者", p1: "合成 一郎" });
  expect(pathsOf(planning)).toContain("/planning/inputs/latest");
  expect(pathsOf(planning)).not.toContain("/planning/inputs");

  // A pharmacist is never given the roster, whatever the route asks for.
  const pharmacist = transport({ ...base, "/planning/scopes": [{ ...scope, role: "PHARMACIST" }], "/planning/inputs/latest": input });
  const own = await loadWorkspaceContext(pharmacist, undefined, { period: "2026-01" }, () => "roster");
  expect(own.kind === "ready" && own.ctx.names).toEqual({});
  expect(pathsOf(pharmacist).some((path) => path.startsWith("/planning/inputs"))).toBe(false);
});

test("the privacy-purpose route avoids ordinary planning reads", async () => {
  const t = transport({ "/auth/me": identity, "/planning/scopes": [scope] });
  const result = await loadWorkspaceContext(t, undefined, { publicationId: "pub-1" }, () => "privacy");
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") return;
  expect(result.ctx.publications).toEqual([]);
  expect(result.ctx.names).toEqual({ "p-admin": "合成 管理者" });
  expect(pathsOf(t)).toEqual(["/auth/me", "/planning/scopes"]);
});

test("the privacy-purpose route confirms another person through its own roster, without ordinary planning reads", async () => {
  // Ordinary planning reads may be refused (423) while a use restriction is in force: none is made.
  const t = transport({ "/auth/me": identity, "/planning/scopes": [scope], "/planning/compliance/privacy": { people: [{ person_id: "p-other", name: "合成 対象者" }], cases: [], rules: [], holds: [] } });
  const result = await loadWorkspaceContext(t, scope.scope_id, { publicationId: "pub-from-schedule", personId: "p-other" }, () => "privacy");
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") return;
  expect([result.ctx.scope.scope_id, result.ctx.selectedPersonId, result.ctx.publications, result.ctx.publication]).toEqual([scope.scope_id, "p-other", [], null]);
  expect(result.ctx.names).toEqual({ "p-other": "合成 対象者" });
  expect(pathsOf(t)).toEqual(["/auth/me", "/planning/compliance/privacy", "/planning/scopes"]);
  // A person that roster does not have is refused, never used by a form.
  const absent = await loadWorkspaceContext(transport({ "/auth/me": identity, "/planning/scopes": [scope], "/planning/compliance/privacy": { people: [] } }), scope.scope_id, { personId: "p-other" }, () => "privacy");
  expect(absent).toMatchObject({ kind: "problem", status: 404 });
});

test("the viewer's notifications are read once, by the context, and given to every route", async () => {
  const notice = { event_id: "n1", category: "schedule", kind: "schedule.published", publication_id: "pub-1", version: 3, read: false, created_at: "2026-01-05T09:00:00+09:00" };
  const t = transport({ ...base, "/planning/notifications": [notice] });
  const result = await loadWorkspaceContext(t, undefined, { period: "2026-01" }, () => "none");
  expect(result.kind === "ready" && [result.ctx.notifications, result.ctx.notificationsRead, result.partial]).toEqual([[notice], true, []]);
  expect(pathsOf(t).filter((path) => path === "/planning/notifications")).toHaveLength(1);
  // The privacy-purpose route reads none: an empty list there is not "no notifications".
  const privacy = await loadWorkspaceContext(transport({ "/auth/me": identity, "/planning/scopes": [scope] }), undefined, {}, () => "privacy");
  expect(privacy.kind === "ready" && [privacy.ctx.notifications, privacy.ctx.notificationsRead]).toEqual([[], false]);
});

test("a failed notification read is reported beside the context; an unknown publication is refused", async () => {
  const t = transport({ ...base, "/planning/notifications": () => { throw new PlanningError(503, "restore gate"); } });
  const result = await loadWorkspaceContext(t, undefined, { period: "2026-01" }, () => "none");
  expect(result.kind).toBe("ready");
  if (result.kind === "ready") {
    expect(result.partial).toEqual([{ resource: "通知", status: 503, detail: "restore gate" }]);
    // The routes are told that the list is unknown, not empty.
    expect([result.ctx.notifications, result.ctx.notificationsRead]).toEqual([[], false]);
  }

  const missing = await loadWorkspaceContext(transport(base), undefined, { publicationId: "pub-unknown" }, () => "none");
  expect(missing).toMatchObject({ kind: "problem", status: 404 });
});

test("an explicit period and publication select exactly that publication; neither is ever replaced", async () => {
  const old = { ...publication, publication_id: "pub-old", version: 2, period: "2026-09-01T00:00:00+09:00|2026-10-01T00:00:00+09:00" };
  const current = { ...publication, publication_id: "pub-current", version: 3, period: "2026-10-01T00:00:00+09:00|2026-11-01T00:00:00+09:00" };
  const answers = { ...base, "/planning/publications": [old, current] };
  const chosen = await loadWorkspaceContext(transport(answers), scope.scope_id, { period: "2026-09", publicationId: "pub-old" }, () => "none");
  // The route reads with this period and this publication (see the schedule route's read).
  expect(chosen.kind === "ready" && [chosen.period, chosen.ctx.period, chosen.ctx.publication?.publication_id]).toEqual(["2026-09", "2026-09", "pub-old"]);
  // A publication of another scope is not found; nothing is read after the list that proves it.
  const absent = transport(answers);
  expect(await loadWorkspaceContext(absent, scope.scope_id, { publicationId: "other-scope-publication" }, () => "roster")).toMatchObject({ kind: "problem", status: 404 });
  expect(pathsOf(absent)).toEqual(["/auth/me", "/planning/publications", "/planning/scopes"]);
  // A period that is not the publication's is a conflict, not a silent choice of either.
  const mismatch = transport(answers);
  expect(await loadWorkspaceContext(mismatch, scope.scope_id, { period: "2026-09", publicationId: "pub-current" }, () => "roster")).toMatchObject({ kind: "problem", status: 409 });
  expect(pathsOf(mismatch)).toEqual(["/auth/me", "/planning/publications", "/planning/scopes"]);
});

test("a person named in the URL is refused when the roster cannot confirm them", async () => {
  const outside = transport({ ...base, "/planning/inputs": [], "/planning/compliance/records": [] });
  expect(await loadWorkspaceContext(outside, undefined, { period: "2026-01", personId: "p-elsewhere" }, () => "none"))
    .toMatchObject({ kind: "problem", status: 404 });
  // The whole roster of the scope was asked before refusing.
  expect(pathsOf(outside)).toEqual(expect.arrayContaining(["/planning/inputs", "/planning/compliance/records"]));
  const unreadable = transport(base);
  const failed = await loadWorkspaceContext(unreadable, undefined, { period: "2026-01", personId: "p1" }, () => "none");
  expect(failed.kind).toBe("problem");
});

test("a person with a contract record who is not yet in the latest planning input can be selected", async () => {
  const t = transport({
    ...base,
    "/planning/inputs": [{ input_hash: "input-current" }, { input_hash: "input-old" }],
    "/planning/inputs/latest": (path: string) => ({ snapshot: { people: [{ person_id: "p-admin", name: path.includes("input_hash=input-old") ? "旧名 管理者" : "合成 管理者" }] } }),
    "/planning/compliance/records": [{ kind: "person", entity_id: "p-new", payload: { person_id: "p-new", name: "合成 新任" } }],
  });
  const result = await loadWorkspaceContext(t, scope.scope_id, { period: "2026-01", personId: "p-new" }, () => "roster");
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") return;
  expect(result.ctx.selectedPersonId).toBe("p-new");
  // The newest input names a person first; the contract record supplies who is not in any input.
  expect(result.ctx.names).toEqual({ "p-admin": "合成 管理者", "p-new": "合成 新任" });
});

test("the plan and the input of a planning URL are syntax-checked selections of the context", async () => {
  const none = await loadWorkspaceContext(transport(base), undefined, { period: "2026-01" }, () => "none");
  expect(none.kind === "ready" && [none.ctx.selectedDraftIds, none.ctx.selectedInputHash]).toEqual([[], null]);
  // One value, or the repeated values of the comparison in the order of the URL.
  const one = await loadWorkspaceContext(transport(base), undefined, { period: "2026-01", draft: "draft-1", input: "a".repeat(64) }, () => "none");
  expect(one.kind === "ready" && [one.ctx.selectedDraftIds, one.ctx.selectedInputHash]).toEqual([["draft-1"], "a".repeat(64)]);
  const many = await loadWorkspaceContext(transport(base), undefined, { period: "2026-01", draft: ["d3", "", "d1", "d2", "d4", "d5", "d6", "d7"], input: "" }, () => "none");
  // An empty value names nothing; the comparison takes at most six plans.
  expect(many.kind === "ready" && [many.ctx.selectedDraftIds, many.ctx.selectedInputHash]).toEqual([["d3", "d1", "d2", "d4", "d5", "d6"], null]);
  const longest = "x".repeat(256);
  const edge = await loadWorkspaceContext(transport(base), undefined, { draft: longest, input: "A.b_c:d-9" }, () => "none");
  expect(edge.kind === "ready" && [edge.ctx.selectedDraftIds, edge.ctx.selectedInputHash]).toEqual([[longest], "A.b_c:d-9"]);
});

test.each([
  ["a plan with a space", { draft: "has space" }, "勤務案の識別子が不正です。"],
  ["one malformed plan among valid ones", { draft: ["d1", "../d2", "d3"] }, "勤務案の識別子が不正です。"],
  ["a plan longer than 256 characters", { draft: "x".repeat(257) }, "勤務案の識別子が不正です。"],
  ["a plan with a query in it", { draft: "d1?scope_id=other" }, "勤務案の識別子が不正です。"],
  ["a plan that is the parent directory", { draft: ".." }, "勤務案の識別子が不正です。"],
  ["a plan that is the current directory", { draft: ["d1", "."] }, "勤務案の識別子が不正です。"],
  ["a plan of dots only", { draft: "...." }, "勤務案の識別子が不正です。"],
  ["a plan that begins with a dot", { draft: ".d1" }, "勤務案の識別子が不正です。"],
  ["an input that is the parent directory", { input: ".." }, "入力版の識別子が不正です。"],
  ["an input that is the current directory", { input: "." }, "入力版の識別子が不正です。"],
  ["an input with a slash", { input: "abc/def" }, "入力版の識別子が不正です。"],
  ["two inputs", { input: ["abc", "def"] }, "入力版の識別子が不正です。"],
])("%s is refused with 422 before anything is read for the route", async (_name, selection, detail) => {
  const t = transport(base);
  const result = await loadWorkspaceContext(t, undefined, { period: "2026-01", ...selection }, () => "roster");
  expect(result).toMatchObject({ kind: "problem", status: 422, detail, scopes: [scope] });
  expect(pathsOf(t)).toEqual(["/auth/me", "/planning/scopes"]);
});

test.each([
  ["a publication that is the parent directory", { publicationId: ".." }, "公開版の識別子が不正です。"],
  ["a case that is the parent directory", { caseId: ".." }, "ケースの識別子が不正です。"],
  ["a person that is the current directory", { personId: "." }, "職員の識別子が不正です。"],
  ["a person of dots only", { personId: "..." }, "職員の識別子が不正です。"],
])("%s is refused with 422 once the publications are known, before the roster or the route is read", async (_name, selection, detail) => {
  const t = transport({ ...base, "/planning/inputs": [], "/planning/compliance/records": [], "/planning/inputs/latest": { snapshot: { people: [] } } });
  const result = await loadWorkspaceContext(t, undefined, { period: "2026-01", ...selection }, () => "roster");
  expect(result).toMatchObject({ kind: "problem", status: 422, detail });
  // The list of publications names no identifier of the URL; nothing else was asked.
  expect(pathsOf(t)).toEqual(["/auth/me", "/planning/publications", "/planning/scopes"]);
  expect(t.paths.join(" ")).not.toContain("..");
});

test("a path is read once per request, and its answer or its failure is shared", async () => {
  let reads = 0;
  const read = oncePerRequest(async <T,>(path: string): Promise<T> => {
    reads += 1;
    if (path.startsWith("/down")) throw new PlanningError(503, "down");
    return { path, reads } as T;
  });
  const [first, second, other] = await Promise.all([read("/planning/inputs/latest?scope_id=a"), read("/planning/inputs/latest?scope_id=a"), read("/planning/inputs/latest?scope_id=b")]);
  expect(first).toBe(second);
  expect(other).not.toBe(first);
  expect(reads).toBe(2);
  await expect(read("/down")).rejects.toMatchObject({ status: 503 });
  await expect(read("/down")).rejects.toMatchObject({ status: 503 });
  expect(reads).toBe(3);
  // Another request has its own transport, and reads again.
  await oncePerRequest(async <T,>() => { reads += 1; return null as T; })("/planning/inputs/latest?scope_id=a");
  expect(reads).toBe(4);
});

const ctx = { scope, role: "ADMIN", names: {} } as unknown as RouteContext;
const route = (read: Parameters<typeof defineRoute<number>>[0]["read"]) =>
  defineRoute<number>({ key: "operations/today", names: "none", read, View: () => null });

test("a route read keeps what it loaded when an optional read fails", async () => {
  const state = await readRoute(route(async (_api, _ctx, optional) =>
    (await optional("補足", Promise.reject(new PlanningError(503, "down")))) ?? 7), {} as never, ctx);
  expect(state).toEqual({ kind: "ready", data: 7, partial: [{ resource: "補足", status: 503, detail: "down" }] });
});

test("a failed primary read is the route's problem; an expired session is never partial", async () => {
  expect(await readRoute(route(async () => { throw new PlanningError(409, "stale"); }), {} as never, ctx))
    .toEqual({ kind: "problem", status: 409, detail: "stale" });
  expect(await readRoute(route(async (_api, _ctx, optional) =>
    (await optional("補足", Promise.reject(new PlanningError(401, "expired")))) ?? 1), {} as never, ctx))
    .toEqual({ kind: "problem", status: 401, detail: "expired" });
});
