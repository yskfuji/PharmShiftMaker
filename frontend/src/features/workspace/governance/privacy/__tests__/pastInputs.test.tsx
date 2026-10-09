import { within } from "@testing-library/react";
import { PlanningError } from "@/lib/planningTransport";
import type { ErasureCandidate, ErasureCandidates } from "../../api";
import { INPUT_EXECUTION, INPUT_HASH, INPUT_PLAN, INPUT_PREVIEW } from "../__fixtures__/bodies";
import { NOBODY, SCOPE, changes, done, keyed, line, listed, listing, mount, open, posts, press, set, surface, task, tick, type Call } from "../__fixtures__/harness";
import { TASKS } from "../PrivacyTasks";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
afterEach(() => jest.restoreAllMocks());

const TASK = TASKS.inputs;
const READ = `/compliance/erasure-candidates?${SCOPE}`;
const PREVIEW = `/compliance/erasure-preview?${SCOPE}`;
const EXECUTE = `/compliance/erasure-execute?${SCOPE}`;
const CURRENT_HASH = "b".repeat(64);
const KEPT_HASH = "d".repeat(64);
const RETENTION = "保存期限未満または起算条件が未対応です";
const HEAD = "現行入力として参照されています";
const CONSENT = "消去される記録と残る記録を確認し、取り消せない消去に同意した";
const input = (over: Partial<ErasureCandidate>): ErasureCandidate => ({ input_hash: INPUT_HASH, input_revision: 1, period: { start: "2020-01-06T00:00:00+09:00", end: "2020-01-13T00:00:00+09:00" }, registered_at: "2020-01-02T09:00:00+09:00", erasable: true, blockers: [], target_count: 4, ...over });
const EXPIRED = input({});
const CURRENT = input({ input_hash: CURRENT_HASH, input_revision: 3, period: { start: "2026-01-05T00:00:00+09:00", end: "2026-01-12T00:00:00+09:00" }, erasable: false, blockers: [HEAD], target_count: 7 });
const KEPT = input({ input_hash: KEPT_HASH, input_revision: 2, period: { start: "2036-01-07T00:00:00+09:00", end: "2036-01-08T00:00:00+09:00" }, erasable: false, blockers: [RETENTION], target_count: 2 });
const candidates = (inputs: ErasureCandidate[] = [CURRENT, KEPT, EXPIRED]): ErasureCandidates => ({ observed_at: "2026-10-05T09:00:00+09:00", inputs });
const conflict = () => new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" }));
const executed = { plan_id: "erasure-plan", status: "EXECUTED", deleted: 4, duplicate: false };
/** Answers the listing, the preview and the execution; `over` replaces one of them. */
const answers = (over: (call: Call) => unknown = () => undefined, list: () => ErasureCandidates = candidates) => (call: Call) => over(call)
  ?? (call.method === "GET" ? list() : call.path === PREVIEW ? { ...INPUT_PLAN, input_hash: (call.body as { payload: { input_hash: string } }).payload.input_hash } : executed);
async function previewOf(hash: string) { await open(TASK); set(TASK, "確認する勤務入力", hash); await press(TASK, "確認版の作成内容を確認する"); await press(TASK, "確認版を作成する"); }

test("the inputs are read when the task is opened, and listed with the server's answer on each: erasable, or why not", async () => {
  const { calls } = await mount(answers());
  expect(calls).toEqual([]);
  await open(TASK);
  expect(calls).toEqual([{ method: "GET", path: READ, body: undefined }]);
  expect(within(within(task(TASK)).getByRole("region", { name: "サーバーが消去できると答えた勤務入力" })).getAllByRole("row").map((row) => row.textContent)).toEqual([
    "対象期間（日本時間）入力の版登録日時（日本時間）消去される記録", "2020-01-06 00:00 〜 2020-01-13 00:00第1版2020-01-02 09:004件",
  ]);
  expect(listed(TASK, "サーバーが消去できないと答えた勤務入力と理由")).toEqual([
    `2026-01-05 00:00 〜 2026-01-12 00:00・入力 第3版：${HEAD}`, `2036-01-07 00:00 〜 2036-01-08 00:00・入力 第2版：${RETENTION}`,
  ]);
  expect(within(within(task(TASK)).getByLabelText("確認する勤務入力")).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "選んでください", "2026-01-05 00:00 〜 2026-01-12 00:00・入力 第3版（サーバーの回答：消去できない）", "2036-01-07 00:00 〜 2036-01-08 00:00・入力 第2版（サーバーの回答：消去できない）",
    "2020-01-06 00:00 〜 2020-01-13 00:00・入力 第1版（サーバーの回答：消去できる）",
  ]);
  expect(task(TASK)).toHaveTextContent("下の一覧は 2026-10-05 09:00（日本時間）時点のサーバーの回答です。");
  // Hashes are not what is read.
  expect(within(task(TASK)).getByRole("region", { name: "サーバーが消去できると答えた勤務入力" })).not.toHaveTextContent(INPUT_HASH);
});

test("which input is erasable is the server's flag alone: an old period it refuses is refused, a recent one it allows is offered", async () => {
  await mount(answers(undefined, () => candidates([{ ...EXPIRED, erasable: false, blockers: ["法的保全が有効です: hold-1"] }, { ...CURRENT, erasable: true, blockers: [] }])));
  await open(TASK);
  expect(within(within(task(TASK)).getByRole("region", { name: "サーバーが消去できると答えた勤務入力" })).getAllByRole("row")[1]).toHaveTextContent("2026-01-05 00:00 〜 2026-01-12 00:00第3版");
  expect(listed(TASK, "サーバーが消去できないと答えた勤務入力と理由")).toEqual(["2020-01-06 00:00 〜 2020-01-13 00:00・入力 第1版：法的保全が有効です: hold-1"]);
});

test("without inputs the task says so and offers nothing", async () => {
  await mount(answers(undefined, () => candidates([])));
  await open(TASK);
  expect(task(TASK)).toHaveTextContent("サーバーが消去できると答えた勤務入力はありません。");
  expect(within(task(TASK)).queryByLabelText("確認する勤務入力")).toBeNull();
});

test("preview, the dedicated confirmation with the server's targets, the consent, the erasure and the server's result", async () => {
  let list = candidates();
  const { calls, refresh } = await mount(answers((call) => { if (call.path === EXECUTE) { list = candidates([CURRENT, KEPT]); return executed; } return undefined; }, () => list));
  await open(TASK);
  set(TASK, "確認する勤務入力", INPUT_HASH);
  await press(TASK, "確認版の作成内容を確認する");
  expect(within(surface(TASK)!).getByRole("heading", { name: "2. 確認版の作成前の確認" })).toHaveFocus();
  expect(line(TASK, "作成される版")).toHaveTextContent("消去の確認版（消去計画）を1件作成します。確認版を作成しても、何も消去されません。");
  expect(line(TASK, "通知")).toHaveTextContent(`${NOBODY}確認版の作成の記録（操作者・時刻）は監査の履歴に残ります。`);
  expect(posts(calls)).toEqual([]);
  await press(TASK, "確認版を作成する");
  expect(posts(calls)).toEqual([{ method: "POST", path: PREVIEW, body: keyed(INPUT_PREVIEW) }]);
  const confirmation = surface(TASK)!;
  expect(within(confirmation).getByRole("heading", { name: "3. 取り消せない操作の確認：旧勤務入力の消去" })).toHaveFocus();
  expect(changes(TASK)).toEqual(["監査・通知の記録 1件：保存中 → 消去", "計画案 2件：保存中 → 消去", "勤務入力 1件：保存中 → 消去"]);
  expect(line(TASK, "作成される版")).toHaveTextContent("確認版は実行済みになります。消去した記録ごとに、消去済みの記録（表・識別子・消去前の照合値）が1件ずつ、計4件作成されます。");
  expect(line(TASK, "通知")).toHaveTextContent(`${NOBODY}消去の実行の記録（確認版・件数・操作者・時刻）は監査の履歴に残ります。`);
  expect(line(TASK, "競合・部分失敗")).toHaveTextContent("変わっていれば1件も消去せず、競合として知らせます。全対象を1回の処理で消去するため、一部だけが消去されることはありません。");
  expect(listed(TASK, "消去されるもの")).toEqual([
    "2020-01-06 00:00 〜 2020-01-13 00:00・入力 第1版の監査・通知の記録：1件", "2020-01-06 00:00 〜 2020-01-13 00:00・入力 第1版の計画案：2件", "2020-01-06 00:00 〜 2020-01-13 00:00・入力 第1版の勤務入力：1件",
  ]);
  expect(listed(TASK, "残るものと理由")).toEqual([
    "消去済みの記録 4件（表・識別子・消去前の照合値だけを持ち、内容は持ちません）。", "実行済みの確認版と、消去の実行の監査記録。",
    "サーバーが返した制限事項：保全台帳・バックアップ内の識別子は別の保存規則で管理します。", "サーバーが返した制限事項：匿名加工情報を生成する操作ではありません。",
  ]);
  expect(confirmation).toHaveTextContent("この操作は取り消せません。消去した勤務入力と、それを参照する計画案・公開版・生成処理・受付記録・通知の記録は復元できません。消去した後は、この期間のこの版の勤務表を再現できません。サーバーの回答でも、この消去は不可逆です。");
  const erase = within(confirmation).getByRole("button", { name: "この旧勤務入力を消去する" });
  expect(erase).toBeDisabled();
  expect(erase).toHaveAccessibleDescription("上の同意にチェックを入れると押せます。");
  tick(TASK, CONSENT);
  expect(erase).not.toHaveAttribute("aria-describedby");
  await press(TASK, "この旧勤務入力を消去する");
  expect(posts(calls)[1]).toEqual({ method: "POST", path: EXECUTE, body: keyed(INPUT_EXECUTION, 2) });
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(done(TASK)).toHaveTextContent("サーバーの結果：4件を消去しました（確認版の状態：実行済み）。消去した入力は、一覧から読み込めなくなりました。");
  expect(surface(TASK)).toBeNull();
  // The list is read again: the server no longer names the input.
  expect(calls[calls.length - 1]).toEqual({ method: "GET", path: READ, body: undefined });
  expect(await within(task(TASK)).findByText("サーバーが消去できると答えた勤務入力はありません。")).toBeInTheDocument();
});

test("an input the server refuses is shown with the server's reasons, and no erasure is offered", async () => {
  const { calls } = await mount(answers((call) => (call.path === PREVIEW ? { ...INPUT_PLAN, input_hash: KEPT_HASH, erasable: false, blockers: [RETENTION], targets: [INPUT_PLAN.targets[3]] } : undefined)));
  await previewOf(KEPT_HASH);
  expect(posts(calls)).toEqual([{ method: "POST", path: PREVIEW, body: keyed({ ...INPUT_PREVIEW, payload: { input_hash: KEPT_HASH } }) }]);
  expect(within(task(TASK)).getByRole("heading", { name: "3. サーバーの確認結果：この入力は消去できません" })).toHaveFocus();
  expect(listed(TASK, "サーバーが返した消去できない理由")).toEqual([RETENTION]);
  expect(surface(TASK)).toBeNull();
  expect(within(task(TASK)).queryByRole("button", { name: "この旧勤務入力を消去する" })).toBeNull();
  expect(within(task(TASK)).queryByLabelText(CONSENT)).toBeNull();
  await press(TASK, "入力の選択に戻る");
  expect(within(task(TASK)).getByRole("button", { name: "確認版の作成内容を確認する" })).toBeInTheDocument();
});

test("the plan's own flag decides, not the list read earlier", async () => {
  // The list said erasable; by the time of the preview the server says otherwise.
  await mount(answers((call) => (call.path === PREVIEW ? { ...INPUT_PLAN, erasable: false, blockers: ["法的保全が有効です: hold-9"] } : undefined)));
  await previewOf(INPUT_HASH);
  expect(listed(TASK, "サーバーが返した消去できない理由")).toEqual(["法的保全が有効です: hold-9"]);
  expect(surface(TASK)).toBeNull();
});

test("an unknown outcome of the erasure sends the identical body again with the same key", async () => {
  let sends = 0;
  const { calls } = await mount(answers((call) => { if (call.path !== EXECUTE) return undefined; if (++sends === 1) throw new TypeError("Failed to fetch"); return { ...executed, duplicate: true, deleted: undefined }; }));
  await previewOf(INPUT_HASH);
  tick(TASK, CONSENT);
  await press(TASK, "この旧勤務入力を消去する");
  expect(line(TASK, "競合・部分失敗")).toHaveTextContent("結果を確認できません。");
  expect(surface(TASK)).toHaveTextContent("実行されたかどうかは不明です。同じ内容を再送すると、サーバーは同じ受付として扱うため、二重には実行されません。");
  await press(TASK, "同じ内容を再送する");
  expect(posts(calls).slice(1)).toEqual([{ method: "POST", path: EXECUTE, body: keyed(INPUT_EXECUTION, 2) }, { method: "POST", path: EXECUTE, body: keyed(INPUT_EXECUTION, 2) }]);
  // The server says the plan had already been executed: nothing more is claimed.
  expect(done(TASK)).toHaveTextContent("この確認版は既に実行済みでした（サーバーの回答）。新たに消去したものはありません。");
});

test("a conflict shows the server's current answer beside the plan; the plan is dropped and the list read again", async () => {
  let list = candidates();
  const { calls } = await mount(answers((call) => { if (call.path !== EXECUTE) return undefined; list = candidates([CURRENT, KEPT, { ...EXPIRED, erasable: false, blockers: ["法的保全が有効です: hold-1"], target_count: 5 }]); throw conflict(); }, () => list));
  await previewOf(INPUT_HASH);
  tick(TASK, CONSENT);
  await press(TASK, "この旧勤務入力を消去する");
  expect(within(surface(TASK)!).getAllByRole("alert")[0]).toHaveTextContent("保存規則・法的保全・消去される記録が、確認版の作成後に変わりました。サーバーが現在返している回答を「現在」に示します。");
  expect(within(within(surface(TASK)!).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
    "サーバーの回答消去できる消去できない（法的保全が有効です: hold-1）消去するあり", "消去される記録の件数4件5件4件あり",
  ]);
  expect(within(surface(TASK)!).getByRole("button", { name: "この旧勤務入力を消去する" })).toBeDisabled();
  await press(TASK, "三つの内容を確認し、現在の版に対して確認し直す");
  expect(surface(TASK)).toBeNull();
  expect(task(TASK)).toHaveTextContent("この確認版は実行していません。保存規則・法的保全・対象が変わったため、一覧を読み直しました。確認版を作り直してください。");
  expect(posts(calls)).toHaveLength(2);
  expect(await within(task(TASK)).findByText(/入力 第1版：法的保全が有効です: hold-1/)).toBeInTheDocument();
});

test.each([[403, "Administrator membership required", "この操作は担当外です"], [423, "Approved use restriction is active", "いまは操作できません"], [422, "String should match pattern", "サーバーの検証で止まりました"]])(
  "a %i on the erasure is the server's message", async (status, detail, title) => {
    await mount(answers((call) => { if (call.path === EXECUTE) throw new PlanningError(status, JSON.stringify({ detail })); return undefined; }));
    await previewOf(INPUT_HASH);
    tick(TASK, CONSENT);
    await press(TASK, "この旧勤務入力を消去する");
    expect(within(surface(TASK)!).getByRole("alert")).toHaveTextContent(title);
    expect(within(surface(TASK)!).getByRole("alert")).toHaveTextContent(detail);
    expect(done(TASK)).toHaveTextContent("");
  });

test("a list the server refuses to give is the task's own problem; a pharmacist is not offered the task", async () => {
  await mount(() => { throw new PlanningError(403, JSON.stringify({ detail: "Administrator membership required" })); });
  await open(TASK);
  expect(within(task(TASK)).getByRole("alert")).toHaveTextContent("この画面は表示できません");
  expect(within(task(TASK)).getByRole("button", { name: "もう一度読み込む" })).toBeInTheDocument();
  const { calls } = await mount(undefined, listing({ cases: [], rules: [], holds: [], people: [{ person_id: "synthetic-pharmacist", name: "高橋 葵" }] }), "PHARMACIST");
  expect(document.body.textContent?.split(TASK).length).toBe(2);
  expect(calls).toEqual([]);
});
