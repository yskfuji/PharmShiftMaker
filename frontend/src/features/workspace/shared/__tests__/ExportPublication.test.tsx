import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { loginPath } from "@/lib/loginPath";
import { LiveProvider, liveFrom } from "../../shell/WorkspaceRuntime";
import { syntheticContext } from "../../showcase/synthetic/context";
import { syntheticRequest } from "../../showcase/synthetic/transport";
import { signIn } from "../api";
import ExportPublication from "../ExportPublication";

// The island over the real typed client and the real file transport: what is asserted is
// what leaves the browser. Only the network and the browser's save are replaced.
const CONTENT = new Uint8Array(Buffer.from('{"publication":"pub-1"}'));
let contentHash = "";
type Sent = { url: string; body: Record<string, unknown>; init: RequestInit };
let sent: Sent[] = [];
let clicked: Array<{ download: string; href: string }> = [];
const json = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() }) as unknown as Response;
const file = (transfer: string | null, bytes: Uint8Array = CONTENT) => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), headers: new Headers(transfer ? { "X-Transfer-ID": transfer, "content-type": "application/json" } : {}) }) as unknown as Response;
/** Answers in order; a function throws like a lost connection. */
function network(...answers: Array<Response | (() => never)>) {
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)), init: init! });
    const answer = answers.shift();
    if (!answer) throw new Error("unexpected request");
    return typeof answer === "function" ? answer() : answer;
  }) as never;
}
const lost = () => { throw new TypeError("Failed to fetch"); };
const artifact = (copy = "copy-1") => json({ copy_id: copy, revision: 1, content_hash: contentHash });
const press = () => fireEvent.click(screen.getByRole("button", { name: "この公開版を出力" }));
const said = () => screen.getByRole("status").textContent;
const paths = () => sent.map((item) => item.url.replace(/^https?:\/\/[^/]+/, ""));

const ctx = syntheticContext("ADMIN");
const production = liveFrom(ctx, { client: createIdealClient("test"), mutate: createMutator("test"), refresh: async () => undefined });
const control = (publication = "pub-1", version = 3) => <LiveProvider live={production}><ExportPublication scope="hospital/pharmacy" publication={publication} version={version} /></LiveProvider>;
const view = () => render(control());

beforeAll(async () => {
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  contentHash = Buffer.from(await webcrypto.subtle.digest("SHA-256", CONTENT)).toString("hex");
  URL.createObjectURL = jest.fn(() => "blob:saved");
  URL.revokeObjectURL = jest.fn();
});
beforeEach(() => {
  sent = [];
  clicked = [];
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push({ download: this.download, href: this.href }); });
});
afterEach(() => jest.restoreAllMocks());

test("one press registers the export, has it handed over and saves the verified file", async () => {
  network(artifact(), file("transfer-9"));
  view();
  const region = screen.getByRole("region", { name: "公開版の登録済み出力" });
  expect(within(region).getByLabelText("出力形式")).toHaveAccessibleDescription(/JSONは、ほかのシステムに読み込ませるための形式です/);
  expect(within(region).getAllByRole("option").map((option) => (option as HTMLOptionElement).value)).toEqual(["json", "csv", "csv-wide"]);
  // The live region is there before anything is said, and says nothing yet.
  expect(said()).toBe("");
  press();
  await waitFor(() => expect(said()).toBe("schedule-pub-1.json を保存しました。受渡し記録：transfer-9。この受渡し先での消去は、未確認として記録されています。"));
  expect(paths()).toEqual([
    "/planning/publications/pub-1/artifacts?scope_id=hospital%2Fpharmacy",
    "/planning/artifacts/copy-1/download?scope_id=hospital%2Fpharmacy",
  ]);
  expect(sent[0].body).toEqual({ expected_revision: 3, idempotency_key: expect.any(String), format: "json" });
  expect(sent[1].body).toEqual({ expected_revision: 1, idempotency_key: expect.any(String), destination: "browser-download" });
  expect(sent[0].body.idempotency_key).not.toBe(sent[1].body.idempotency_key);
  for (const item of sent) expect(item.init).toEqual({ method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item.body) });
  expect(clicked).toEqual([{ download: "schedule-pub-1.json", href: "blob:saved" }]);
});

test("after a lost answer the next press sends the identical request; a finished export is followed by a new one", async () => {
  network(artifact(), lost, file("transfer-1"), artifact(), file("transfer-2"));
  view();
  press();
  await waitFor(() => expect(said()).toContain("通信断のときは、形式を変えずにもう一度押してください。"));
  expect(clicked).toEqual([]);
  press();
  await waitFor(() => expect(clicked).toHaveLength(1));
  // Registered once; the hand-over was repeated byte for byte.
  expect(paths().map((path) => path.includes("/download"))).toEqual([false, true, true]);
  expect(sent[2].init.body).toBe(sent[1].init.body);
  press();
  await waitFor(() => expect(clicked).toHaveLength(2));
  expect(sent).toHaveLength(5);
  expect(sent[3].body.idempotency_key).not.toBe(sent[0].body.idempotency_key);
  expect(sent[4].body.idempotency_key).not.toBe(sent[1].body.idempotency_key);
});

test("a changed publication is the server's refusal, shown as the workspace shows one; unverified bytes are never saved", async () => {
  network(json({ detail: "stale" }, 409), artifact(), file(null), file("transfer-3", new Uint8Array(Buffer.from("tampered"))), json({}, 503));
  view();
  press();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("409");
  expect(alert).toHaveTextContent("新しい変更があります");
  expect(said()).toBe("");
  press();
  await waitFor(() => expect(sent).toHaveLength(3));
  await waitFor(() => expect(said()).toContain("保存を止めました。受渡し記録が無いか、受け取った内容が、サーバーに残した内容と一致しません。"));
  expect(screen.queryByRole("alert")).toBeNull();
  // After the refusal the export was a new one.
  expect(sent[1].body.idempotency_key).not.toBe(sent[0].body.idempotency_key);
  press();
  await waitFor(() => expect(sent).toHaveLength(4));
  await waitFor(() => expect(said()).toContain("保存を止めました。"));
  expect(sent[3].init.body).toBe(sent[2].init.body);
  press();
  await waitFor(() => expect(sent).toHaveLength(5));
  await waitFor(() => expect(said()).toContain("応答を受け取れませんでした。"));
  expect(clicked).toEqual([]);
});

describe("an answer that arrived but cannot be used in this browser", () => {
  const NOT_USABLE = "ファイルは保存していません。サーバーの応答は届きましたが、このブラウザーでは受け取ったファイルを検証または保存できませんでした。受渡しは既に記録されている可能性があります。形式を変えずにもう一度押すと、同じ出力として受け取り直します（二重には登録されません）。";
  const unreadable = () => ({ ok: true, status: 200, arrayBuffer: async () => { throw new TypeError("Failed to read the response body"); }, headers: new Headers({ "X-Transfer-ID": "transfer-1" }) }) as unknown as Response;

  test("a file that cannot be read is said as that, never as a missing answer; the next press repeats the same hand-over", async () => {
    network(artifact(), unreadable(), file("transfer-1"));
    view();
    press();
    await waitFor(() => expect(said()).toBe(NOT_USABLE));
    expect(said()).not.toContain("応答を受け取れませんでした");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(clicked).toEqual([]);
    press();
    await waitFor(() => expect(clicked).toEqual([{ download: "schedule-pub-1.json", href: "blob:saved" }]));
    // Registered once; the hand-over went out again byte for byte.
    expect(paths().map((path) => path.includes("/download"))).toEqual([false, true, true]);
    expect(sent[2].init.body).toBe(sent[1].init.body);
    expect(said()).toContain("受渡し記録：transfer-1");
  });

  test("a browser without crypto.subtle cannot check the file: nothing is saved, and it is said as that", async () => {
    const subtle = globalThis.crypto.subtle;
    network(artifact(), file("transfer-2"), file("transfer-2"));
    view();
    Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: undefined });
    try {
      press();
      await waitFor(() => expect(said()).toBe(NOT_USABLE));
    } finally { Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: subtle }); }
    expect(clicked).toEqual([]);
    press();
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(sent).toHaveLength(3);
    expect(sent[2].init.body).toBe(sent[1].init.body);
  });

  test("a verified file the browser cannot save is not reported as saved; the same attempt is sent again", async () => {
    network(artifact(), file("transfer-3"), artifact(), file("transfer-3"));
    view();
    (URL.createObjectURL as jest.Mock).mockImplementationOnce(() => { throw new Error("no object URLs here"); });
    press();
    await waitFor(() => expect(said()).toBe(NOT_USABLE));
    expect(clicked).toEqual([]);
    press();
    await waitFor(() => expect(clicked).toHaveLength(1));
    // The same two requests with the same two keys: the server answers them from its records.
    expect(sent).toHaveLength(4);
    expect([sent[2].init.body, sent[3].init.body]).toEqual([sent[0].init.body, sent[1].init.body]);
    expect(said()).toContain("schedule-pub-1.json を保存しました。");
  });
});

test("an expired session on the hand-over goes to sign-in with the address on screen, like any other request of the workspace", async () => {
  const leave = jest.spyOn(signIn, "leaveFor").mockImplementation(() => undefined);
  window.history.replaceState(null, "", "/workspace/schedule?scope=hospital%2Fpharmacy");
  try {
    network(artifact(), json({ detail: "Not authenticated" }, 401));
    view();
    press();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ログインし直してください");
    expect(leave.mock.calls).toEqual([[loginPath("/workspace/schedule?scope=hospital%2Fpharmacy")]]);
    expect(said()).toBe("");
    expect(clicked).toEqual([]);
  } finally { window.history.replaceState(null, "", "/"); }
});

test("another format is another export: the earlier outcome is not shown for it, and it is saved as its own kind", async () => {
  network(artifact(), lost, artifact("copy-2"), file("transfer-4"));
  const shown = view();
  press();
  await waitFor(() => expect(said()).toContain("通信断"));
  fireEvent.change(screen.getByLabelText("出力形式"), { target: { value: "csv-wide" } });
  expect(said()).toBe("");
  press();
  await waitFor(() => expect(clicked).toEqual([{ download: "schedule-pub-1.csv", href: "blob:saved" }]));
  expect(sent[2].body).toMatchObject({ format: "csv-wide" });
  expect(sent[2].body.idempotency_key).not.toBe(sent[0].body.idempotency_key);
  expect(paths()[3]).toBe("/planning/artifacts/copy-2/download?scope_id=hospital%2Fpharmacy");
  expect(sent[3].body.idempotency_key).not.toBe(sent[1].body.idempotency_key);
  expect(Array.from(shown.container.querySelectorAll("[class]")).flatMap((node) => Array.from(node.classList)).filter((name) => !name.startsWith("ideal-"))).toEqual([]);
});

test("after a failed hand-over, another publication is never given the earlier artifact or its outcome", async () => {
  network(artifact("copy-1"), lost, artifact("copy-2"), file("transfer-7"));
  const shown = view();
  press();
  await waitFor(() => expect(said()).toContain("通信断"));
  // The same island now shows another publication (the schedule of another period).
  shown.rerender(control("pub-2", 8));
  expect(said()).toBe("");
  press();
  await waitFor(() => expect(clicked).toHaveLength(1));
  expect(paths().slice(2)).toEqual([
    "/planning/publications/pub-2/artifacts?scope_id=hospital%2Fpharmacy",
    "/planning/artifacts/copy-2/download?scope_id=hospital%2Fpharmacy",
  ]);
  expect(sent[2].body).toEqual({ expected_revision: 8, idempotency_key: expect.any(String), format: "json" });
  expect(new Set(sent.map((item) => item.body.idempotency_key)).size).toBe(4);
  expect(clicked).toEqual([{ download: "schedule-pub-2.json", href: "blob:saved" }]);
  expect(said()).toContain("schedule-pub-2.json を保存しました。受渡し記録：transfer-7。");
});

test("in the showcase nothing reaches the network: the synthetic client refuses the change", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const synthetic = liveFrom(ctx, { client: createIdealClient("showcase", syntheticRequest()), mutate: createMutator("showcase"), refresh: async () => undefined, isSynthetic: true });
  render(<LiveProvider live={synthetic}><ExportPublication scope="hospital/pharmacy" publication="pub-1" version={3} /></LiveProvider>);
  press();
  expect(await screen.findByRole("alert")).toHaveTextContent("合成データの表示では変更を行いません。");
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(clicked).toEqual([]);
});

test("what the formats are and how the transfer is recorded is a closed reveal after the action; the owner chooses the button's weight", () => {
  const shown = view();
  const region = screen.getByRole("region", { name: "公開版の登録済み出力" });
  // Format, action, reveal, outcome: nothing is read before the control that it explains.
  expect(Array.from(region.children).map((child) => child.tagName === "DIV" ? child.className : child.tagName)).toEqual(["LABEL", "SELECT", "ideal-actions", "DETAILS", "P"]);
  const reveal = screen.getByText("出力形式と受渡しの記録について", { selector: "summary" }).closest("details")!;
  expect(reveal).toHaveClass("ideal-v3-disclosure", "ideal-v3-disclosure--info");
  expect(reveal.open).toBe(false);
  expect(reveal).toHaveTextContent("JSONは、ほかのシステムに読み込ませるための形式です。職員や勤務を見分ける記号（ID）も、そのまま入ります。");
  expect(reveal).toHaveTextContent("受け取ったファイルは、残した内容と同じだと確かめられたときだけ保存します。");
  expect(screen.getByRole("button", { name: "この公開版を出力" })).toHaveClass("ideal-button", "ideal-button--secondary");
  shown.unmount();
  render(<LiveProvider live={production}><ExportPublication scope="hospital/pharmacy" publication="pub-1" version={3} actionTone="primary" /></LiveProvider>);
  expect(screen.getByRole("button", { name: "この公開版を出力" })).toHaveClass("ideal-button", "ideal-button--primary");
});
