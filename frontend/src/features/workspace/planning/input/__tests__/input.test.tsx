import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createIdealClient, type InputLatest } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import type { IdealRole } from "@/ideal/types";
import { PlanningError } from "@/lib/planningTransport";
import { readRoute } from "../../../shell/routeTypes";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import CognitiveWorkspaceShowcase from "../../../showcase/CognitiveWorkspaceShowcase";
import { syntheticContext } from "../../../showcase/synthetic/context";
import type { DemandContext } from "../../api";
import { demandState } from "../demand/model";
import type { InputData } from "../InputView";
import route from "../route";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

afterEach(() => jest.restoreAllMocks());

type Call = { method: string; path: string; body: unknown };
const SCOPE = "scope_id=synthetic%2Fclinical-pharmacy";
const input = (over: Partial<InputLatest> = {}): InputLatest => ({
  input_hash: "hash-12", input_revision: 12, publication_version: 7, stale: false,
  snapshot: { people: [{ person_id: "p1", name: "合成 一" }, { person_id: "p2", name: "合成 二" }], candidates: [], contracts: [{}], capabilities: [{}, {}, {}], demands: [{}, {}], period: { start: "2026-10-01T00:00:00+09:00", end: "2026-11-01T00:00:00+09:00" } },
  ...over,
});

const context: DemandContext & { people: unknown[] } = {
  role: "ADMIN", input_hash: "hash-12", staging_valid: true, validation_issues: [], duty_options: [{ kind: "日勤", task: "調剤", location: "薬剤部" }],
  demands: [], records: [], people: [{ person_id: "p1", name: "合成 一" }],
};
const data = (over: Partial<InputLatest> = {}): InputData => ({ input: input(over), demand: demandState(context, "hash-12") });

/** The real typed client over a recording transport, so paths and bodies are the real ones. */
function api(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const client = createIdealClient("test", async <T,>(path: string, method = "GET", body?: unknown) => {
    const call = { method, path, body };
    calls.push(call);
    return answer(call) as T;
  });
  return { calls, client };
}

function tree(answer: (call: Call) => unknown, role: IdealRole) {
  const ctx = syntheticContext(role);
  const { calls, client } = api(answer);
  const refresh = jest.fn(async () => undefined);
  const live = liveFrom(ctx, { client, mutate: createMutator("test"), refresh });
  const View = route.View;
  return { calls, refresh, node: (value: InputData) => <LiveProvider live={live}><View data={value} ctx={ctx} /></LiveProvider> };
}
async function mount(data: InputData, answer: (call: Call) => unknown = () => ({ input_hash: "hash-13" }), role: IdealRole = "ADMIN") {
  const { node, ...rest } = tree(answer, role);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(node(data)); });
  return { ...rest, show: (value: InputData) => view.rerender(node(value)) };
}
const panel = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section")!;
function fillEvidence(scope: HTMLElement) {
  fireEvent.change(within(scope).getByLabelText(/^理由/), { target: { value: "承認済みの原本" } });
  fireEvent.change(within(scope).getByLabelText(/^参照/), { target: { value: "REF-1012" } });
}
function jsonFile(name: string, text: string, size?: number) {
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  if (size) Object.defineProperty(file, "size", { value: size });
  return file;
}

test("the route reads the latest input, then the staffing registered for that input version", async () => {
  const { calls, client } = api((call) => call.path.startsWith("/inputs/latest") ? input() : context);
  const state = await readRoute(route, client, syntheticContext("ADMIN"));
  expect(state).toEqual({ kind: "ready", partial: [], data: { input: input(), demand: demandState(context, "hash-12") } });
  expect(calls).toEqual([
    { method: "GET", path: `/inputs/latest?${SCOPE}`, body: undefined },
    { method: "GET", path: `/compliance/workflow-context?${SCOPE}&input_hash=hash-12`, body: undefined },
  ]);
  expect(route.names).toBe("none");
  // Of the context only what the staffing editor needs is kept: the roster is not.
  expect(JSON.stringify((state as { data: InputData }).data.demand)).not.toContain("合成 一");
});

test("staffing that cannot be read is reported beside the premises", async () => {
  const { client } = api((call) => { if (call.path.startsWith("/inputs/latest")) return input(); throw new PlanningError(409, "版2の確認済み入力が必要です。"); });
  const state = await readRoute(route, client, syntheticContext("LEADER"));
  expect(state).toEqual({ kind: "ready", partial: [{ resource: "必要配置", status: 409, detail: "版2の確認済み入力が必要です。" }], data: { input: input(), demand: null } });
  await mount({ input: input(), demand: null }, undefined, "LEADER");
  expect(screen.getByText("必要配置を確認できません。取得できた前提は上に表示しています。")).toBeInTheDocument();
  expect(screen.queryByText("必要配置を登録・変更する")).toBeNull();
  expect(panel("この入力版に含まれる数")).toHaveTextContent("職員2名");
});

test("without an input the route is a problem", async () => {
  const { client } = api(() => { throw new PlanningError(404, "Not Found"); });
  expect(await readRoute(route, client, syntheticContext("ADMIN"))).toEqual({ kind: "problem", status: 404, detail: "Not Found" });
});

test("the showcase shows the premises and the registered staffing of the synthetic input, ready and empty", async () => {
  const fetchSpy = jest.fn(() => { throw new Error("no network"); });
  global.fetch = fetchSpy as never;
  const ready = render(<CognitiveWorkspaceShowcase screen="plan" view="input" role="ADMIN" />);
  expect(await screen.findByRole("heading", { level: 2, name: "生成前提を確定" })).toBeInTheDocument();
  // What the synthetic input holds agrees with the records laid over it: it is current.
  expect(panel("この入力版に含まれる数")).toHaveTextContent("対象期間2026年10月1日（木）〜10月31日（土）職員3名契約2件資格2件必要配置2件勤務候補2件");
  expect(panel("この入力版に含まれる数")).toHaveTextContent("この入力版を作ったあとに、申請・実績・契約などの記録は変わっていません（システムが確かめた結果です）。");
  expect(screen.getByText("前提は最新")).toBeInTheDocument();
  // The required staffing is a part of the premises: in sight without being opened.
  expect(screen.getByRole("heading", { level: 2, name: "必要配置・資格要件を確認・編集" }).closest("details")).toBeNull();
  expect(screen.getByRole("link", { name: /前提を確認して候補生成へ/ })).toHaveAttribute("href", "/workspace/plan/generate");
  const rows = within(screen.getByRole("region", { name: "登録されている必要配置" })).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toEqual([
    "業務・場所時間帯（日本時間）必須希望原本確認版",
    "病棟・本館2026-10-12 08:30 〜 2026-10-12 17:301名2名確認済み第2版",
    "調剤・薬剤部2026-10-12 10:30 〜 2026-10-12 19:302名2名未確認保存なし（入力版にある値）",
  ]);
  expect(screen.getByText("必要配置を登録・変更する")).toBeInTheDocument();
  ready.unmount();
  render(<CognitiveWorkspaceShowcase screen="plan" view="input" role="ADMIN" state="empty" />);
  expect(await screen.findByRole("heading", { level: 2, name: "この入力版に含まれる数" })).toBeInTheDocument();
  expect(panel("この入力版に含まれる数")).toHaveTextContent("職員0名契約0件資格0件必要配置0件勤務候補0件");
  expect(screen.getByText("この入力版に登録された必要配置はありません。")).toBeInTheDocument();
  expect(screen.getByText("必要配置を登録・変更する")).toBeInTheDocument();
  // Nothing of the route reaches a server: the established form, which fetched by itself, is gone.
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("a stale input is said aloud; a leader sees the premises without the administrator's changes", async () => {
  const { calls } = await mount(data({ stale: true }), undefined, "LEADER");
  expect(screen.getByText("再導出が必要")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("この入力版のまま生成しないでください。");
  // The server's word is said once: a stale input is not also said to be unchanged.
  expect(screen.queryByText(/記録は変わっていません/)).toBeNull();
  expect(panel("この入力版に含まれる数")).toHaveTextContent("職員2名契約1件資格3件必要配置2件勤務候補0件");
  expect(screen.queryByRole("button", { name: "申請・実績を計画に反映" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "契約・資格から勤務候補を再導出" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "入力ファイルの取込" })).toBeNull();
  expect(screen.getByText("必要配置・資格要件を確認・編集")).toBeInTheDocument();
  expect(calls).toEqual([]);
});

test("applying requests and actuals is sent against the version on screen, then the route is read again", async () => {
  let refuse = true;
  const { calls, refresh, show } = await mount(data(), () => { if (refuse) { refuse = false; throw new PlanningError(409, "moved"); } return { input_hash: "hash-13" }; });
  const check = panel("この入力版に含まれる数");
  fireEvent.click(within(check).getByRole("button", { name: "申請・実績を計画に反映" }));
  expect(await within(check).findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(within(check).getByRole("button", { name: "申請・実績を計画に反映" }));
  await waitFor(() => expect(within(check).getByRole("status")).toHaveTextContent("最新の申請・実績を反映した入力版を作りました。"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(Array(2).fill({ method: "POST", path: `/inputs/refresh?${SCOPE}`, body: { expected_revision: 12 } }));
  // The confirmation does not depend on the next read; the version shown does.
  show(data({ input_revision: 13 }));
  expect(panel("生成前提を確定")).toHaveTextContent("入力版 第13版");
  expect(within(check).getByRole("status")).toHaveTextContent("最新の申請・実績を反映した入力版を作りました。");
});

test("deriving candidates needs evidence; an unknown outcome keeps its key; a refusal is shown", async () => {
  let attempts = 0;
  const { calls, refresh } = await mount(data(), () => {
    attempts += 1;
    if (attempts === 1) throw new PlanningError(503, "down");
    if (attempts === 3) throw new PlanningError(422, "承認済みの契約がありません。");
    return { input_hash: "hash-13" };
  });
  const derive = panel("契約・資格から勤務候補を再導出");
  const button = within(derive).getByRole("button", { name: "新しい入力版を作る" });
  expect(within(derive).getByRole("group", { name: "再導出の根拠" })).toBeInTheDocument();
  expect(button).toBeDisabled();
  fillEvidence(derive);
  fireEvent.click(button);
  expect(await within(derive).findByRole("alert")).toHaveTextContent("結果を確認できません");
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(within(derive).getByRole("status")).toHaveTextContent("新しい不変の入力版を作りました。"));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(Array(2).fill(`POST /candidates/derive?${SCOPE}`));
  expect(calls[0].body).toEqual({ expected_version: 12, evidence: { reason: "承認済みの原本", reference: "REF-1012" }, idempotency_key: expect.any(String) });
  expect(calls[1].body).toEqual(calls[0].body);
  // The evidence belonged to that change.
  expect(within(derive).getByLabelText(/^理由/)).toHaveValue("");
  expect(button).toBeDisabled();
  fillEvidence(derive);
  fireEvent.click(button);
  expect(await within(derive).findByRole("alert")).toHaveTextContent("サーバーの検証で止まりました承認済みの契約がありません。");
  expect(within(derive).getByLabelText(/^理由/)).toHaveValue("承認済みの原本");
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("an input file is read in the browser and registered only after the confirmation", async () => {
  const { calls, refresh } = await mount(data());
  const section = panel("入力ファイルの取込");
  const picker = within(section).getByLabelText("JSONを選ぶ");
  // A file the browser turns away was never sent: the refusal says so, and is not shown as
  // a change whose outcome is unknown.
  fireEvent.change(picker, { target: { files: [jsonFile("big.json", "{}", 5 * 1024 * 1024 + 1)] } });
  expect(await within(section).findByRole("alert")).toHaveTextContent("このファイルは登録していません。取込ファイルは5MB以内にしてください。");
  expect(section).not.toHaveTextContent("結果を確認できません");
  expect(section.querySelector(".ideal-confirm")).toBeNull();
  fireEvent.change(picker, { target: { files: [jsonFile("broken.json", "{not json")] } });
  await waitFor(() => expect(within(section).getByRole("alert")).toHaveTextContent("このファイルは登録していません。JSONとして読めませんでした。"));
  expect(section).not.toHaveTextContent("結果を確認できません");
  expect(section.querySelector(".ideal-confirm")).toBeNull();
  fireEvent.change(picker, { target: { files: [jsonFile("october.json", JSON.stringify({ period: "2026-10" }))] } });
  await waitFor(() => expect(section.querySelector(".ideal-confirm")).not.toBeNull());
  expect(within(section).queryByRole("alert")).toBeNull();
  // A refused file ends the confirmation of the file chosen before it.
  fireEvent.change(picker, { target: { files: [jsonFile("broken.json", "{not json")] } });
  await waitFor(() => expect(section.querySelector(".ideal-confirm")).toBeNull());
  expect(calls).toEqual([]);
  fireEvent.change(picker, { target: { files: [jsonFile("october.json", JSON.stringify({ period: "2026-10" }))] } });
  await waitFor(() => expect(section.querySelector(".ideal-confirm")).not.toBeNull());
  const surface = section.querySelector(".ideal-confirm") as HTMLElement;
  expect(within(surface).getByRole("heading", { level: 3, name: "october.json" })).toBeInTheDocument();
  expect(surface).toHaveTextContent("登録前の確認です。既存入力は上書きせず、新しい入力版を作ります。");
  expect(calls).toEqual([]);
  fireEvent.click(within(surface).getByRole("button", { name: "取り消す" }));
  expect(section.querySelector(".ideal-confirm")).toBeNull();
  fireEvent.change(picker, { target: { files: [jsonFile("october.json", JSON.stringify({ period: "2026-10" }))] } });
  await waitFor(() => expect(section.querySelector(".ideal-confirm")).not.toBeNull());
  fireEvent.click(within(section).getByRole("button", { name: "この内容で登録" }));
  await waitFor(() => expect(within(section).getByRole("status")).toHaveTextContent("入力を登録しました。"));
  expect(calls).toEqual([{ method: "POST", path: `/inputs?${SCOPE}`, body: { snapshot: { period: "2026-10" }, expected_revision: 12 } }]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(section.querySelector(".ideal-confirm")).toBeNull();
});

test("a file still being read when another is chosen is dropped: the confirmation and the refusal are of the last choice", async () => {
  await mount(data());
  const section = panel("入力ファイルの取込");
  const picker = within(section).getByLabelText("JSONを選ぶ");
  // A is read slowly; B, chosen meanwhile, is too large.
  let finishA: (text: string) => void = () => undefined;
  const slow = new File(["{}"], "slow-a.json", { type: "application/json" });
  Object.defineProperty(slow, "text", { value: () => new Promise<string>((resolve) => { finishA = resolve; }) });
  fireEvent.change(picker, { target: { files: [slow] } });
  fireEvent.change(picker, { target: { files: [jsonFile("big.json", "{}", 5 * 1024 * 1024 + 1)] } });
  expect(await within(section).findByRole("alert")).toHaveTextContent("取込ファイルは5MB以内にしてください。");
  await act(async () => { finishA("{}"); });
  expect(section.querySelector(".ideal-confirm")).toBeNull();
  expect(within(section).getByRole("alert")).toHaveTextContent("取込ファイルは5MB以内にしてください。");
  // The other order: a broken A read slowly, then a good B. B's confirmation stays.
  let failA: (text: string) => void = () => undefined;
  const broken = new File(["{"], "broken-a.json", { type: "application/json" });
  Object.defineProperty(broken, "text", { value: () => new Promise<string>((resolve) => { failA = resolve; }) });
  fireEvent.change(picker, { target: { files: [broken] } });
  fireEvent.change(picker, { target: { files: [jsonFile("good-b.json", "{}")] } });
  await waitFor(() => expect(section.querySelector(".ideal-confirm")).not.toBeNull());
  await act(async () => { failA("{not json"); });
  expect(within(section.querySelector(".ideal-confirm") as HTMLElement).getByRole("heading", { level: 3, name: "good-b.json" })).toBeInTheDocument();
  expect(within(section).queryByRole("alert")).toBeNull();
});

test("a registration the server refuses keeps the file for another attempt", async () => {
  const { refresh } = await mount(data(), () => { throw new PlanningError(409, "moved"); });
  const section = panel("入力ファイルの取込");
  fireEvent.change(within(section).getByLabelText("JSONを選ぶ"), { target: { files: [jsonFile("october.json", "{}")] } });
  await waitFor(() => expect(section.querySelector(".ideal-confirm")).not.toBeNull());
  fireEvent.click(within(section).getByRole("button", { name: "この内容で登録" }));
  expect(await within(section).findByRole("alert")).toHaveTextContent("新しい変更があります");
  expect(section.querySelector(".ideal-confirm")).not.toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

// The route arrives as server HTML. These cases use that HTML before React attaches to it.
describe("before React attaches", () => {
  let root: Root | null = null;
  let container: HTMLElement;
  afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

  async function arrive(before: (html: HTMLElement) => void) {
    const { node, calls } = tree(() => ({ input_hash: "hash-13" }), "ADMIN");
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(node(data()));
    const html = container.innerHTML;
    before(container);
    await act(async () => { root = hydrateRoot(container, node(data())); });
    return { html, calls };
  }

  test("a button that could not answer yet is not in the server HTML", async () => {
    const { html } = await arrive(() => undefined);
    expect(html).not.toContain("申請・実績を計画に反映");
    expect(html).toContain("新しい入力版を作る");
    expect(screen.getByRole("button", { name: "申請・実績を計画に反映" })).toBeEnabled();
  });

  test("evidence typed into the server HTML is kept and used", async () => {
    const { calls } = await arrive((html) => {
      (within(html).getByLabelText(/^理由/) as HTMLInputElement).value = "承認済みの原本";
      (within(html).getByLabelText(/^参照/) as HTMLInputElement).value = "REF-1012";
    });
    const derive = panel("契約・資格から勤務候補を再導出");
    expect(within(derive).getByLabelText(/^理由/)).toHaveValue("承認済みの原本");
    const button = within(derive).getByRole("button", { name: "新しい入力版を作る" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ expected_version: 12, evidence: { reason: "承認済みの原本", reference: "REF-1012" } });
  });

  test("a file chosen in the server HTML is read once React attaches", async () => {
    await arrive((html) => {
      Object.defineProperty(within(html).getByLabelText("JSONを選ぶ"), "files", { configurable: true, value: [jsonFile("early.json", "{}")] });
    });
    expect(await screen.findByRole("heading", { level: 3, name: "early.json" })).toBeInTheDocument();
  });
});
