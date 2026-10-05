import { webcrypto } from "node:crypto";
import { PlanningError } from "@/lib/planningTransport";
import { loginPath } from "@/lib/loginPath";
import { browserFiles, exportApi, signIn, UnreadableFileError, type FileClient, type HandedOver } from "../api";
import { advanceExport, attemptFor, fileNameOf, sameTarget, saveFile, sha256Hex, type ExportAttempt, type ExportTarget } from "../publicationExport";

const CONTENT = new Uint8Array(Buffer.from('{"publication":"pub-1"}'));
const bytesOf = (value: Uint8Array) => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
let contentHash = "";
const TARGET: ExportTarget = { scopeId: "hospital/pharmacy", publicationId: "pub-1", version: 3, format: "json" };

type Sent = { via: "client" | "file"; path: string; method: string; body: unknown };
type Answer = unknown | (() => never);
/** A typed client and a file transport answering in order; a function throws instead. */
function wire(...answers: Answer[]) {
  const sent: Sent[] = [];
  const next = (item: Sent) => {
    sent.push(item);
    if (!answers.length) throw new Error("unexpected request");
    const answer = answers.shift();
    return typeof answer === "function" ? (answer as () => never)() : answer;
  };
  const client = { request: async <T,>(path: string, method = "GET", body?: unknown) => next({ via: "client", path, method, body }) as T };
  const file: FileClient = { request: async (path, body) => next({ via: "file", path, method: "POST", body }) as HandedOver };
  return { sent, client, file };
}
const lost = () => { throw new TypeError("Failed to fetch"); };
const status = (code: number) => () => { throw new PlanningError(code, "refused"); };
const artifact = (over: Record<string, unknown> = {}) => ({ copy_id: "copy-1", revision: 1, content_hash: contentHash, ...over });
const handedOver = (transferId: string | null, content: Uint8Array = CONTENT): HandedOver => ({ bytes: bytesOf(content), mediaType: "application/json", transferId });
let serial = 0;
const keys = () => `key-${++serial}`;
const start = (target: ExportTarget = TARGET) => attemptFor(null, target, keys);

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  contentHash = Buffer.from(await webcrypto.subtle.digest("SHA-256", CONTENT)).toString("hex");
});
beforeEach(() => { serial = 0; });
afterEach(() => jest.restoreAllMocks());

test("the two requests, in the server's order, with one key each and the registered revision", async () => {
  const { sent, client, file } = wire(artifact({ revision: 4 }), handedOver("transfer-9"));
  const step = await advanceExport(client, start(), file);
  expect(sent).toEqual([
    { via: "client", path: "/publications/pub-1/artifacts?scope_id=hospital%2Fpharmacy", method: "POST", body: { expected_revision: 3, idempotency_key: "key-1", format: "json" } },
    { via: "file", path: "/artifacts/copy-1/download?scope_id=hospital%2Fpharmacy", method: "POST", body: { expected_revision: 4, idempotency_key: "key-2", destination: "browser-download" } },
  ]);
  // The bodies are serialised in this order of keys.
  expect(sent.map((item) => JSON.stringify(item.body))).toEqual([
    '{"expected_revision":3,"idempotency_key":"key-1","format":"json"}',
    '{"expected_revision":4,"idempotency_key":"key-2","destination":"browser-download"}',
  ]);
  expect(step).toEqual({ kind: "verified", pending: null, file: { name: "schedule-pub-1.json", bytes: bytesOf(CONTENT), mediaType: "application/json", transferId: "transfer-9" } });
});

test("an identifier is one path segment, whatever it contains", async () => {
  const { sent, client, file } = wire(artifact({ copy_id: "copy/../1" }), handedOver("t"));
  await advanceExport(client, start({ ...TARGET, publicationId: "pub 1/x" }), file);
  expect(sent.map((item) => item.path)).toEqual([
    "/publications/pub%201%2Fx/artifacts?scope_id=hospital%2Fpharmacy",
    "/artifacts/copy%2F..%2F1/download?scope_id=hospital%2Fpharmacy",
  ]);
});

test("a lost registration is sent again unchanged; a lost hand-over repeats only the hand-over", async () => {
  const { sent, client, file } = wire(lost, artifact(), lost, status(503), handedOver("transfer-1"));
  const first = await advanceExport(client, start(), file);
  expect(first).toMatchObject({ kind: "unknown", pending: { artifact: null, registerKey: "key-1", handOverKey: "key-2" } });
  const second = await advanceExport(client, first.pending!, file);
  // Registered now; the answer of the hand-over was lost.
  expect(second).toMatchObject({ kind: "unknown", pending: { artifact: artifact() } });
  expect(sent[1]).toEqual(sent[0]);
  // 503 does not say whether the transfer was recorded either: the same request again.
  const third = await advanceExport(client, second.pending!, file);
  expect(third.kind).toBe("unknown");
  const fourth = await advanceExport(client, third.pending!, file);
  expect(fourth.kind).toBe("verified");
  expect(sent.map((item) => item.via)).toEqual(["client", "client", "file", "file", "file"]);
  expect(sent[3]).toEqual(sent[2]);
  expect(sent[4]).toEqual(sent[2]);
});

test("bytes without a transfer record or with another hash are refused, and asked for again with the same request", async () => {
  const { sent, client, file } = wire(artifact(), handedOver(null), handedOver("transfer-3", new Uint8Array(Buffer.from("tampered"))), handedOver("transfer-3"));
  const first = await advanceExport(client, start(), file);
  expect(first).toMatchObject({ kind: "unverified", reason: "no-transfer-record" });
  const second = await advanceExport(client, first.pending!, file);
  expect(second).toMatchObject({ kind: "unverified", reason: "hash-mismatch" });
  expect("file" in second).toBe(false);
  const third = await advanceExport(client, second.pending!, file);
  expect(third.kind).toBe("verified");
  expect(sent).toHaveLength(4);
  expect(sent[2]).toEqual(sent[1]);
  expect(sent[3]).toEqual(sent[1]);
});

/** Runs with a browser that has no `crypto.subtle` (a page that is not a secure context). */
async function withoutSubtle<T>(run: () => Promise<T>): Promise<T> {
  const subtle = globalThis.crypto.subtle;
  Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: undefined });
  try { return await run(); } finally { Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: subtle }); }
}

test("an answered hand-over whose file cannot be read here is not a missing answer; the same attempt asks again", async () => {
  const unreadable = () => { throw new UnreadableFileError(new TypeError("body stream already read")); };
  const { sent, client, file } = wire(artifact(), unreadable, handedOver("transfer-4"));
  const first = await advanceExport(client, start(), file);
  expect(first).toMatchObject({ kind: "unusable", reason: "unreadable", pending: { artifact: artifact(), registerKey: "key-1", handOverKey: "key-2" } });
  expect((first as { error: unknown }).error).toEqual(new TypeError("body stream already read"));
  expect("file" in first).toBe(false);
  // Registered once; only the hand-over is repeated, unchanged.
  const second = await advanceExport(client, first.pending!, file);
  expect(second).toMatchObject({ kind: "verified", file: { transferId: "transfer-4" } });
  expect(sent.map((item) => item.via)).toEqual(["client", "file", "file"]);
  expect(sent[2]).toEqual(sent[1]);
});

test("without crypto.subtle the received file cannot be checked: nothing is saved, and it is not a missing answer", async () => {
  const { sent, client, file } = wire(artifact(), handedOver("transfer-6"), handedOver("transfer-6"));
  const first = await withoutSubtle(() => advanceExport(client, start(), file));
  expect(first).toMatchObject({ kind: "unusable", reason: "cannot-hash", pending: { artifact: artifact(), handOverKey: "key-2" } });
  expect((first as { error: unknown }).error).toBeInstanceOf(TypeError);
  expect("file" in first).toBe(false);
  // A transfer record alone is still not enough: the missing record is reported first.
  const unrecorded = wire(artifact(), handedOver(null));
  expect(await withoutSubtle(() => advanceExport(unrecorded.client, start(), unrecorded.file))).toMatchObject({ kind: "unverified", reason: "no-transfer-record" });
  // Where the hash can be worked out, the same request is answered and verified.
  const second = await advanceExport(client, first.pending!, file);
  expect(second.kind).toBe("verified");
  expect(sent[2]).toEqual(sent[1]);
});

test("the file transport tells an unreadable file of a successful answer from a missing answer", async () => {
  const body = { expected_revision: 1, idempotency_key: "key-1", destination: "browser-download" } as const;
  const broken = new TypeError("Failed to read the response body");
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => { throw broken; }, headers: new Headers({ "X-Transfer-ID": "transfer-5" }) }) as unknown as Response) as never;
  const refused = await browserFiles.request("/artifacts/copy-1/download", body).then(() => null, (error: unknown) => error);
  expect(refused).toBeInstanceOf(UnreadableFileError);
  expect((refused as UnreadableFileError).reason).toBe(broken);
  // No answer at all stays the network's own error.
  global.fetch = jest.fn(async () => { throw new TypeError("Failed to fetch"); }) as never;
  await expect(browserFiles.request("/artifacts/copy-1/download", body)).rejects.toEqual(new TypeError("Failed to fetch"));
});

test("an expired session on the hand-over leaves for sign-in with the address on screen, as the typed client does", async () => {
  const leave = jest.spyOn(signIn, "leaveFor").mockImplementation(() => undefined);
  window.history.replaceState(null, "", "/workspace/schedule?scope=hospital%2Fpharmacy&period=2026-01");
  try {
    const text = jest.fn(async () => "{\"detail\":\"Not authenticated\"}");
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, text, headers: new Headers() }) as unknown as Response) as never;
    const body = { expected_revision: 1, idempotency_key: "key-1", destination: "browser-download" } as const;
    await expect(browserFiles.request("/artifacts/copy-1/download", body)).rejects.toEqual(new PlanningError(401, "ログインし直してください。"));
    expect(leave.mock.calls).toEqual([[loginPath("/workspace/schedule?scope=hospital%2Fpharmacy&period=2026-01")]]);
    expect(leave.mock.calls[0][0]).toBe("/login?redirectTo=%2Fworkspace%2Fschedule%3Fscope%3Dhospital%252Fpharmacy%26period%3D2026-01");
    // Any other refusal stays on the page.
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, text: async () => "forbidden", headers: new Headers() }) as unknown as Response) as never;
    await expect(browserFiles.request("/artifacts/copy-1/download", body)).rejects.toEqual(new PlanningError(403, "forbidden"));
    expect(leave).toHaveBeenCalledTimes(1);
    // The attempt is over: the server said no.
    const { client, file } = wire(artifact(), status(401));
    expect(await advanceExport(client, start(), file)).toMatchObject({ kind: "refused", pending: null, error: { status: 401 } });
  } finally { window.history.replaceState(null, "", "/"); }
});

test.each([409, 403, 404, 422, 423])("a definite refusal (%i) ends the attempt, at either request", async (code) => {
  const atRegistration = wire(status(code));
  expect(await advanceExport(atRegistration.client, start(), atRegistration.file)).toMatchObject({ kind: "refused", pending: null, error: { status: code } });
  const atHandOver = wire(artifact(), status(code));
  expect(await advanceExport(atHandOver.client, start(), atHandOver.file)).toMatchObject({ kind: "refused", pending: null, error: { status: code } });
});

test("an attempt is continued only for the target it was started for", () => {
  const pending: ExportAttempt = { ...start(), artifact: artifact() };
  expect(attemptFor(pending, { ...TARGET }, keys)).toBe(pending);
  for (const other of [{ publicationId: "pub-2" }, { format: "csv" as const }, { version: 4 }, { scopeId: "hospital/ward" }]) {
    const target = { ...TARGET, ...other };
    const fresh = attemptFor(pending, target, keys);
    expect(sameTarget(fresh.target, target)).toBe(true);
    // Nothing of the earlier attempt: no artifact, and two keys of its own.
    expect(fresh.artifact).toBeNull();
    expect(new Set([pending.registerKey, pending.handOverKey, fresh.registerKey, fresh.handOverKey]).size).toBe(4);
    expect(fileNameOf(fresh.target)).toBe(`schedule-${target.publicationId}.${target.format === "json" ? "json" : "csv"}`);
  }
  expect(fileNameOf({ ...TARGET, format: "csv-wide" })).toBe("schedule-pub-1.csv");
});

test("after a failed hand-over, another publication is registered and saved as itself", async () => {
  const { sent, client, file } = wire(artifact(), lost, artifact({ copy_id: "copy-2" }), handedOver("transfer-2"));
  const failed = await advanceExport(client, start(), file);
  expect(failed.kind).toBe("unknown");
  const other = { ...TARGET, publicationId: "pub-2", version: 7 };
  const step = await advanceExport(client, attemptFor(failed.pending, other, keys), file);
  expect(sent.slice(2).map((item) => [item.path, (item.body as { expected_revision: number }).expected_revision])).toEqual([
    ["/publications/pub-2/artifacts?scope_id=hospital%2Fpharmacy", 7],
    ["/artifacts/copy-2/download?scope_id=hospital%2Fpharmacy", 1],
  ]);
  expect(step).toMatchObject({ kind: "verified", file: { name: "schedule-pub-2.json", transferId: "transfer-2" } });
});

test("the file transport sends the viewer's cookie, never caches, and rejects like the typed client", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const answers = [
    { ok: true, status: 200, arrayBuffer: async () => bytesOf(CONTENT), headers: new Headers({ "X-Transfer-ID": "transfer-5", "content-type": "text/csv" }) },
    { ok: true, status: 200, arrayBuffer: async () => bytesOf(CONTENT), headers: new Headers() },
    { ok: false, status: 409, text: async () => "stale", headers: new Headers() },
  ];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return answers.shift() as unknown as Response; }) as never;
  const api = exportApi({ request: jest.fn() });
  const body = { expected_revision: 1, idempotency_key: "key-1", destination: "browser-download" } as const;
  expect(await api.handOver("hospital/pharmacy", "copy-1", body)).toEqual({ bytes: bytesOf(CONTENT), mediaType: "text/csv", transferId: "transfer-5" });
  expect(calls[0].url.replace(/^https?:\/\/[^/]+/, "")).toBe("/planning/artifacts/copy-1/download?scope_id=hospital%2Fpharmacy");
  expect(calls[0].init).toEqual({ method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect(await browserFiles.request("/artifacts/copy-1/download", body)).toMatchObject({ mediaType: "application/octet-stream", transferId: null });
  await expect(browserFiles.request("/artifacts/copy-1/download", body)).rejects.toEqual(new PlanningError(409, "stale"));
});

test("a verified file is saved under its own name, and the hash is the SHA-256 in hex", async () => {
  expect(await sha256Hex(bytesOf(CONTENT))).toBe(contentHash);
  URL.createObjectURL = jest.fn(() => "blob:saved");
  URL.revokeObjectURL = jest.fn();
  const clicked: Array<{ download: string; href: string }> = [];
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ download: this.download, href: this.href }); });
  saveFile({ name: "schedule-pub-1.csv", bytes: bytesOf(CONTENT), mediaType: "text/csv", transferId: "t" });
  expect(clicked).toEqual([{ download: "schedule-pub-1.csv", href: "blob:saved" }]);
  const blob = (URL.createObjectURL as jest.Mock).mock.calls[0][0] as Blob;
  expect([blob.type, blob.size]).toEqual(["text/csv", CONTENT.byteLength]);
});
