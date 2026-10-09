import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { PlanningError } from "@/lib/planningTransport";
import type { CopyInventory, SubjectControl } from "../../api";
import {
  BACKFILL, BACKFILL_PREVIEW, CONTROL, COPY_EXECUTION, COPY_PLAN, COPY_PREVIEW, EXTERNAL_CONFIRMATION, JOINT, JOINT_SOURCE, PLAN, PLAN_ANSWER, PLAN_EXECUTION, PRESERVATION, PROJECTION, REGISTRATION, UUID,
  VERIFIED_REGISTRATION,
} from "../__fixtures__/bodies";
import { NOBODY, SCOPE, changes, choose, done, field, keyed, line, listed, mount, open, posts, press, set, surface, task, tick, type Call } from "../__fixtures__/harness";
import { TASKS } from "../PrivacyTasks";

jest.mock("next/link", () => ({ __esModule: true, default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
beforeEach(() => {
  Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => UUID) });
  Object.defineProperty(global.crypto, "subtle", { configurable: true, value: { digest: jest.fn(async () => new Uint8Array(32).fill(7).buffer) } });
});
afterEach(() => jest.restoreAllMocks());

const conflict = () => new PlanningError(409, JSON.stringify({ detail: "Input, version or ledger conflict; refresh and review again" }));
const CONTROL_READ = `/compliance/subject-controls/p1?${SCOPE}`;
const INVENTORY: CopyInventory = { person_id: "p1", targets: COPY_PLAN.targets, unverified_copies: COPY_PLAN.unverified_copies, database_records_remaining: COPY_PLAN.database_records_remaining, database_inventory: COPY_PLAN.database_inventory };
const control = (over: Partial<SubjectControl> = {}): SubjectControl => ({
  person_id: "p1", revision: 0, state: "NOT_APPLIED", all_copies_erased: false, identity_boundary: "stable person ID only; unknown aliases require identity review", inventory: INVENTORY,
  applicable_cases: [{ case_id: "case-1", revision: 1, reason: "本人確認済みの消去判断" }], ...over,
});
const APPLIED = control({ revision: 1, state: "CONTROL_APPLIED_REMAINS", applicable_cases: [] });
const CONSENT = "対象と残存理由を確認し、実行可能分だけの処理に同意した";
const TARGET_LINES = [
  "保存物 1（DB記録）：残存理由 なし／保存期限 2026-01-01 09:00",
  "保存物 2（外部コピー）：残存理由 管理先の消去確認が必要",
  "保存物 3（管理ファイル）：残存理由 複数職員を含むため保全判断が必要",
];
const KEPT_COPIES = ["保存物 2（外部コピー）：残ります（サーバーの残存理由 管理先の消去確認が必要）", "保存物 3（管理ファイル）：残ります（サーバーの残存理由 複数職員を含むため保全判断が必要）"];
/** A read the test answers when it chooses to. */
function held<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const lines = (summary: string, name: string) => listed(summary, name).map((text) => text?.split("保存物")[1] ? `保存物${text.split("保存物")[1]}`.split("の共同消去判断")[0].split("：外部管理先")[0] : text);

describe("applying the person control", () => {
  const TASK = TASKS.control;
  const SEND = CONTROL_READ;
  const answered = { person_id: "p1", revision: 1, state: "CONTROL_APPLIED_REMAINS", all_copies_erased: false, case_id: "case-1" };
  async function enter() { await open(TASK); await choose(TASK, "人物制御の対象職員", "p1"); set(TASK, "承認済みの消去判断", "case-1"); set(TASK, "人物制御の実施理由", "承認を照合して制御する"); await press(TASK, "取り消せない操作の確認へ進む"); }

  test("the person's control is read only when the person is chosen; the state, what remains and the decisions offered are the server's", async () => {
    const { calls } = await mount(() => control());
    await open(TASK);
    expect(calls).toEqual([]);
    await choose(TASK, "人物制御の対象職員", "p1");
    expect(calls).toEqual([{ method: "GET", path: CONTROL_READ, body: undefined }]);
    expect(within(task(TASK)).getByRole("heading", { name: "2. 状態と残存を確かめ、適用する判断と理由を入力する" })).toHaveFocus();
    expect(task(TASK)).toHaveTextContent("合成 一の人物制御：未適用（サーバーの回答）。");
    // The inventory is a labelled list, not raw JSON.
    expect(listed(TASK, "残存コピーの照合情報")).toEqual(TARGET_LINES);
    expect(task(TASK)).toHaveTextContent("登録コピー3件");
    expect(task(TASK)).toHaveTextContent("サーバーが処理の対象と答えたコピー1件");
    expect(task(TASK)).toHaveTextContent("人物参照が未確認のコピー1件");
    expect(task(TASK)).toHaveTextContent("DBに残る本人記録2件");
    expect(task(TASK).innerHTML).not.toContain("{\"");
    expect(within(field(TASK, "承認済みの消去判断")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "承認済み判断 1：本人確認済みの消去判断（第1版）"]);
  });

  test("when the server lists no decision, nothing can be applied, whatever the requests look like", async () => {
    await mount(() => control({ applicable_cases: [] }));
    await open(TASK);
    await choose(TASK, "人物制御の対象職員", "p1");
    expect(task(TASK)).toHaveTextContent("サーバーは、この職員に人物制御を適用できる判断を返していません。");
    expect(within(task(TASK)).queryByLabelText("承認済みの消去判断")).toBeNull();
    expect(within(task(TASK)).queryByRole("button", { name: "取り消せない操作の確認へ進む" })).toBeNull();
  });

  test("the confirmation says what stays and that it cannot be undone, asks for the consent, and sends what the established screen sent", async () => {
    let state = control();
    const { calls, refresh } = await mount((call: Call) => { if (call.method === "GET") return state; state = APPLIED; return answered; });
    await enter();
    const confirmation = surface(TASK)!;
    expect(within(confirmation).getByRole("heading", { name: "3. 取り消せない操作の確認：人物制御の適用" })).toHaveFocus();
    // The destructive surface of the shared confirmation: its confirming button is the danger one.
    expect(confirmation).toHaveClass("ideal-confirm--danger");
    expect(Array.from(confirmation.querySelectorAll(":scope > .ideal-actions > button")).map((button) => button.className)).toEqual(["ideal-button ideal-button--danger", "ideal-button ideal-button--secondary"]);
    expect(changes(TASK)).toEqual(["合成 一の人物制御：未適用 → 適用済み（コピーの残存あり）", "適用する判断：（なし） → 本人確認済みの消去判断（第1版）", "人物制御の実施理由：（なし） → 承認を照合して制御する"]);
    expect(line(TASK, "作成される版")).toHaveTextContent("人物制御の記録を1件作成します（第1版）。作成した後は、変更も取消しもできません。");
    expect(line(TASK, "通知")).toHaveTextContent(`${NOBODY}独立した制御サービスに、この職員の制御が登録されます。操作者・実施理由・判断の版・保存規則の版は、制御記録としてサーバーに残ります。`);
    expect(confirmation).toHaveTextContent("この操作では、記録もコピーも消去されません。");
    expect(listed(TASK, "残るものと理由")).toEqual([
      "保存物 1（DB記録）：残ります（サーバーの残存理由 なし）", ...KEPT_COPIES,
      "人物参照が未確認のコピー 1件、DBに残る本人記録 2件は、この操作の後もすべて残ります。", "人物制御の記録そのもの（再作成の防止と復元時の照合に使われます）。",
    ]);
    expect(confirmation).toHaveTextContent("この操作は取り消せません。適用すると、サーバーは合成 一の職員IDを使う記録の再作成とコピーの新規登録を拒否し続けます。サーバーは人物制御を第1版で固定し、変更・解除の操作を持ちません。");
    const apply = within(confirmation).getByRole("button", { name: "人物制御を適用する" });
    expect(apply).toBeDisabled();
    fireEvent.click(apply);
    expect(posts(calls)).toEqual([]);
    tick(TASK, "対象の職員・適用する判断・残る記録を確認し、取り消せない人物制御の適用に同意した");
    await press(TASK, "人物制御を適用する");
    expect(posts(calls)).toEqual([{ method: "POST", path: SEND, body: keyed(CONTROL) }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(done(TASK)).toHaveTextContent("人物制御を適用しました（サーバーの状態：適用済み（コピーの残存あり））。記録とコピーの消去は完了していません（サーバーの回答：全コピーの消去は未完了）。");
    // The task shows the server's next answer: applied, and nothing more to apply.
    expect(task(TASK)).toHaveTextContent("合成 一の人物制御：適用済み（コピーの残存あり）（サーバーの回答）。");
    expect(within(task(TASK)).queryByLabelText("承認済みの消去判断")).toBeNull();
  });

  test("the revisions sent are the server's, not constants", async () => {
    const { calls } = await mount((call: Call) => (call.method === "GET" ? control({ revision: 4, applicable_cases: [{ case_id: "case-1", revision: 9, reason: "本人確認済みの消去判断" }] }) : answered));
    await enter();
    tick(TASK, /取り消せない人物制御の適用に同意した/);
    await press(TASK, "人物制御を適用する");
    expect(posts(calls)[0].body).toEqual(keyed({ ...CONTROL, expected_revision: 4, case_revision: 9 }));
  });

  test("an unknown outcome sends the identical body again with the same key", async () => {
    let sends = 0;
    const { calls } = await mount((call: Call) => { if (call.method === "GET") return control(); if (++sends === 1) throw new TypeError("Failed to fetch"); return answered; });
    await enter();
    tick(TASK, /取り消せない人物制御の適用に同意した/);
    await press(TASK, "人物制御を適用する");
    expect(surface(TASK)).toHaveTextContent("実行されたかどうかは不明です。同じ内容を再送すると、サーバーは同じ受付として扱うため、二重には実行されません。");
    await press(TASK, "同じ内容を再送する");
    expect(posts(calls).map((call) => call.body)).toEqual([keyed(CONTROL), keyed(CONTROL)]);
  });

  test("a conflict shows what the server holds now; nothing is sent again without a new choice and a new consent", async () => {
    let state = control();
    const { calls } = await mount((call: Call) => { if (call.method === "GET") return state; state = control({ applicable_cases: [{ case_id: "case-1", revision: 2, reason: "本人確認済みの消去判断" }] }); throw conflict(); });
    await enter();
    tick(TASK, /取り消せない人物制御の適用に同意した/);
    await press(TASK, "人物制御を適用する");
    const rows = within(within(surface(TASK)!).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").map((row) => row.textContent);
    expect(rows).toContain("選んだ判断をサーバーが受け付けるか受け付ける（第1版）受け付ける（第2版）第1版に対して適用あり");
    await press(TASK, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(TASK)).toBeNull();
    expect(done(TASK)).toHaveTextContent("人物制御は適用していません。");
    expect(field(TASK, "承認済みの消去判断")).toHaveValue("");
    set(TASK, "承認済みの消去判断", "case-1");
    await press(TASK, "取り消せない操作の確認へ進む");
    expect(within(surface(TASK)!).getByRole("button", { name: "人物制御を適用する" })).toBeDisabled();
    expect(posts(calls)).toHaveLength(1);
  });

  test("a read the server refuses is shown in its words", async () => {
    await mount(() => { throw new PlanningError(503, JSON.stringify({ detail: "復元の隔離・検証中です。通常アクセスは停止しています。" })); });
    await open(TASK);
    await choose(TASK, "人物制御の対象職員", "p1");
    expect(within(task(TASK)).getByRole("alert")).toHaveTextContent("読み込めませんでした");
  });

  test("after the control was applied, what was read before it offers nothing while the next answer is read", async () => {
    const next = held<SubjectControl>();
    let reads = 0;
    const { calls } = await mount((call: Call) => (call.method === "GET" ? (++reads === 1 ? control() : next.promise) : answered));
    await enter();
    tick(TASK, /取り消せない人物制御の適用に同意した/);
    await press(TASK, "人物制御を適用する");
    expect(done(TASK)).toHaveTextContent("人物制御を適用しました");
    // The read after the application has not answered: the earlier answer's decisions are gone.
    expect(reads).toBe(2);
    expect(within(task(TASK)).queryByLabelText("承認済みの消去判断")).toBeNull();
    expect(within(task(TASK)).queryByRole("button", { name: "取り消せない操作の確認へ進む" })).toBeNull();
    expect(field(TASK, "人物制御の対象職員")).toBeDisabled();
    await act(async () => { next.resolve(APPLIED); });
    expect(task(TASK)).toHaveTextContent("合成 一の人物制御：適用済み（コピーの残存あり）（サーバーの回答）。");
    expect(within(task(TASK)).queryByRole("button", { name: "取り消せない操作の確認へ進む" })).toBeNull();
    expect(posts(calls)).toHaveLength(1);
  });
});

describe("the erasure plan after the control", () => {
  const TASK = TASKS.plan;
  const PLAN_SEND = `/compliance/subject-controls/p1/plans?${SCOPE}`;
  const EXECUTE_SEND = `/compliance/subject-controls/p1/execute?${SCOPE}`;
  const executed = { plan_id: "plan", revision: 2, state: "ELIGIBLE_PROCESSED_REMAINS", queued_count: 0, erased_database_count: 1, preserved_archive_count: 0, all_copies_erased: false };
  const answers = (execute: () => unknown = () => executed, read: () => SubjectControl = () => APPLIED) => (call: Call) => (call.method === "GET" ? (call.path.includes("joint-review") ? JOINT_SOURCE : read()) : call.path === PLAN_SEND ? PLAN_ANSWER : call.path === EXECUTE_SEND ? execute() : {});
  async function plan() { await open(TASK); await choose(TASK, "消去計画の対象職員", "p1"); await press(TASK, "消去計画の作成内容を確認する"); await press(TASK, "消去計画を作成する"); }
  async function toExecution() { await plan(); await press(TASK, "取り消せない操作の確認へ進む"); }

  test("while the server says the control is not applied, no plan is offered", async () => {
    const { calls } = await mount(() => control());
    await open(TASK);
    await choose(TASK, "消去計画の対象職員", "p1");
    expect(task(TASK)).toHaveTextContent("合成 一の人物制御：未適用（サーバーの回答）。");
    expect(task(TASK)).toHaveTextContent("人物制御は未適用です。消去計画は、人物制御を適用した後に作成できます。");
    expect(within(task(TASK)).queryByRole("button", { name: "消去計画の作成内容を確認する" })).toBeNull();
    expect(posts(calls)).toEqual([]);
  });

  test("the plan is confirmed, made with the revision the server returned, and shown as the server's current list", async () => {
    const { calls } = await mount(answers());
    await open(TASK);
    await choose(TASK, "消去計画の対象職員", "p1");
    await press(TASK, "消去計画の作成内容を確認する");
    expect(within(surface(TASK)!).getByRole("heading", { name: "3. 消去計画の作成前の確認" })).toHaveFocus();
    expect(line(TASK, "作成される版")).toHaveTextContent("消去計画を1件作成します。計画を作成しても、何も消去されません。");
    expect(line(TASK, "通知")).toHaveTextContent(`${NOBODY}計画の作成の記録（操作者・時刻）は監査の履歴に残ります。`);
    expect(posts(calls)).toEqual([]);
    await press(TASK, "消去計画を作成する");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET ${CONTROL_READ}`, `POST ${PLAN_SEND}`, `GET ${CONTROL_READ}`]);
    expect(posts(calls)[0].body).toEqual(keyed(PLAN));
    expect(within(task(TASK)).getByRole("heading", { name: "4. 計画の内容を確かめる" })).toHaveFocus();
    expect(lines(TASK, "消去計画の対象と残存理由")).toEqual(TARGET_LINES);
    // A joint decision is offered for the file copy only.
    expect(within(task(TASK)).getAllByText(/の共同消去判断$/, { selector: "summary" }).map((item) => item.textContent)).toEqual(["保存物 3の共同消去判断"]);
  });

  test("a plan that was created stays on screen when the read after it fails; the read problem is shown beside it and can be repeated", async () => {
    let reads = 0;
    const { calls } = await mount((call: Call) => {
      if (call.method === "GET") { if (++reads === 2) throw new PlanningError(503, "restore gate"); return APPLIED; }
      return call.path === PLAN_SEND ? PLAN_ANSWER : executed;
    });
    await plan();
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET ${CONTROL_READ}`, `POST ${PLAN_SEND}`, `GET ${CONTROL_READ}`]);
    // The plan the server made is named; it was not dropped with the failed read.
    expect(within(task(TASK)).getByRole("heading", { name: "4. 計画の内容を確かめる" })).toHaveFocus();
    expect(task(TASK)).toHaveTextContent("消去計画（第1版）は作成済みで、サーバーに記録されています。作成後の残存を読み込めなかったため、計画の内容はまだ表示していません。");
    expect(within(task(TASK)).getByRole("alert")).toHaveTextContent("読み込めませんでした");
    // Nothing is offered for a plan whose content is not on screen, and no second plan either.
    expect(within(task(TASK)).queryByRole("button", { name: "取り消せない操作の確認へ進む" })).toBeNull();
    expect(within(task(TASK)).queryByRole("button", { name: "消去計画の作成内容を確認する" })).toBeNull();
    expect(within(task(TASK)).queryByRole("list", { name: "消去計画の対象と残存理由" })).toBeNull();
    expect(field(TASK, "消去計画の対象職員")).toBeDisabled();
    await press(TASK, "残存を読み込み直す");
    expect(within(task(TASK)).queryByRole("alert")).toBeNull();
    expect(lines(TASK, "消去計画の対象と残存理由")).toEqual(TARGET_LINES);
    // The plan executed is the one that was created before the failed read.
    await press(TASK, "取り消せない操作の確認へ進む");
    tick(TASK, CONSENT);
    await press(TASK, "この計画の実行可能分を消去する");
    expect(posts(calls)).toHaveLength(2);
    expect(posts(calls)[1]).toEqual({ method: "POST", path: EXECUTE_SEND, body: keyed(PLAN_EXECUTION, 2) });
  });

  test("a plan whose remains could not be read can be discarded; the next plan is a new one", async () => {
    let reads = 0;
    const { calls } = await mount((call: Call) => {
      if (call.method === "GET") { if (++reads === 2) throw new PlanningError(503, "restore gate"); return APPLIED; }
      return PLAN_ANSWER;
    });
    await plan();
    await press(TASK, "実行せずに計画を破棄する");
    expect(within(task(TASK)).queryByRole("alert")).toBeNull();
    expect(task(TASK)).toHaveTextContent("この計画は実行していません。");
    expect(within(task(TASK)).getByRole("button", { name: "消去計画の作成内容を確認する" })).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(1);
  });

  describe("the read of what remains after the plan was made", () => {
    const PROCEED = "取り消せない操作の確認へ進む";
    const offered = (name: string) => within(task(TASK)).queryByRole("button", { name });
    const NEWER = control({ revision: 2, state: "CONTROL_APPLIED_REMAINS", applicable_cases: [] });

    test("while it is in flight, the plan is named and neither the confirmation nor the erasure is offered", async () => {
      const remains = held<SubjectControl>();
      let reads = 0;
      const { calls } = await mount((call: Call) => (call.method === "GET" ? (++reads === 1 ? APPLIED : remains.promise) : call.path === PLAN_SEND ? PLAN_ANSWER : executed));
      await plan();
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET ${CONTROL_READ}`, `POST ${PLAN_SEND}`, `GET ${CONTROL_READ}`]);
      expect(task(TASK)).toHaveTextContent("消去計画（第1版）は作成済みで、サーバーに記録されています。作成後の残存を読み込んでいるため、計画の内容はまだ表示していません。読み込みが終わるまで、実行には進めません。");
      // What was read before the plan is not shown as the plan's content, and nothing is offered for it.
      expect(within(task(TASK)).queryByRole("list", { name: "消去計画の対象と残存理由" })).toBeNull();
      expect(offered(PROCEED)).toBeNull();
      expect(offered("この計画の実行可能分を消去する")).toBeNull();
      expect(surface(TASK)).toBeNull();
      expect(offered("残存を読み込み直す")).toBeDisabled();
      expect(offered("実行せずに計画を破棄する")).toBeDisabled();
      expect(posts(calls)).toHaveLength(1);
      // The answer arrives: the list shown and the revision sent are the ones read after the plan.
      await act(async () => { remains.resolve(NEWER); });
      expect(within(task(TASK)).getByRole("heading", { name: "4. 計画の内容を確かめる" })).toHaveFocus();
      expect(lines(TASK, "消去計画の対象と残存理由")).toEqual(TARGET_LINES);
      await press(TASK, PROCEED);
      tick(TASK, CONSENT);
      await press(TASK, "この計画の実行可能分を消去する");
      expect(posts(calls)[1]).toEqual({ method: "POST", path: EXECUTE_SEND, body: keyed({ ...PLAN_EXECUTION, expected_revision: 2 }, 2) });
    });

    test("after it failed, nothing is offered until a later read succeeds; no erasure is sent before that", async () => {
      let reads = 0;
      const { calls } = await mount((call: Call) => {
        if (call.method === "GET") { reads += 1; if (reads === 2 || reads === 3) throw new PlanningError(503, "restore gate"); return reads === 1 ? APPLIED : NEWER; }
        return call.path === PLAN_SEND ? PLAN_ANSWER : executed;
      });
      await plan();
      expect(task(TASK)).toHaveTextContent("作成後の残存を読み込めなかったため、計画の内容はまだ表示していません。残存を読み込み直すまで、実行には進めません。");
      expect(offered(PROCEED)).toBeNull();
      expect(surface(TASK)).toBeNull();
      // A second failed read changes nothing: the plan stays, with the problem and the way to read again.
      await press(TASK, "残存を読み込み直す");
      expect(reads).toBe(3);
      expect(task(TASK)).toHaveTextContent("消去計画（第1版）は作成済みで、サーバーに記録されています。");
      expect(within(task(TASK)).getByRole("alert")).toHaveTextContent("読み込めませんでした");
      expect(offered(PROCEED)).toBeNull();
      expect(offered("残存を読み込み直す")).toBeEnabled();
      expect(posts(calls).map((call) => call.path)).toEqual([PLAN_SEND]);
      await press(TASK, "残存を読み込み直す");
      expect(within(task(TASK)).queryByRole("alert")).toBeNull();
      await press(TASK, PROCEED);
      tick(TASK, CONSENT);
      await press(TASK, "この計画の実行可能分を消去する");
      expect(posts(calls).map((call) => call.path)).toEqual([PLAN_SEND, EXECUTE_SEND]);
      expect(posts(calls)[1].body).toEqual(keyed({ ...PLAN_EXECUTION, expected_revision: 2 }, 2));
    });

    test("a read that succeeded for an earlier plan does not count for the next plan", async () => {
      const remains = held<SubjectControl>();
      let reads = 0;
      let plans = 0;
      const { calls } = await mount((call: Call) => {
        if (call.method === "GET") return ++reads === 3 ? remains.promise : APPLIED;
        return call.path === PLAN_SEND ? { ...PLAN_ANSWER, plan_id: `plan-${++plans}` } : executed;
      });
      await plan();
      expect(offered(PROCEED)).toBeEnabled();
      await press(TASK, "実行せずに計画を破棄する");
      await press(TASK, "消去計画の作成内容を確認する");
      await press(TASK, "消去計画を作成する");
      expect(posts(calls)).toHaveLength(2);
      expect(task(TASK)).toHaveTextContent("作成後の残存を読み込んでいるため、計画の内容はまだ表示していません。");
      expect(offered(PROCEED)).toBeNull();
      // The read for the second plan fails: still nothing, and the first plan's read is not used.
      await act(async () => { remains.reject(new PlanningError(503, "restore gate")); });
      expect(offered(PROCEED)).toBeNull();
      expect(surface(TASK)).toBeNull();
      await press(TASK, "残存を読み込み直す");
      await press(TASK, PROCEED);
      tick(TASK, CONSENT);
      await press(TASK, "この計画の実行可能分を消去する");
      expect(posts(calls)[2].body).toEqual(keyed({ ...PLAN_EXECUTION, plan_id: "plan-2" }, 3));
    });
  });

  test("the erasure states what is erased, what stays and why, needs the consent, and reports the server's counts", async () => {
    const { calls, refresh } = await mount(answers());
    await toExecution();
    const confirmation = surface(TASK)!;
    expect(within(confirmation).getByRole("heading", { name: "5. 取り消せない操作の確認：消去計画の実行" })).toHaveFocus();
    expect(changes(TASK)).toEqual(["保存物 1（DB記録）：保存中 → この操作で消去します"]);
    expect(line(TASK, "作成される版")).toHaveTextContent("消去計画は第1版 → 第2版になります。消去したDB記録ごとに、消去済みの記録（識別子と照合値）が残ります。");
    expect(line(TASK, "通知")).toHaveTextContent(`${NOBODY}実行の記録（計画・件数・操作者・時刻）は監査の履歴に残ります。`);
    expect(line(TASK, "競合・部分失敗")).toHaveTextContent("変わっていれば1件も処理せず、競合として知らせます。");
    expect(line(TASK, "競合・部分失敗")).toHaveTextContent("管理ファイルの実物は、その後にワーカーが消去し、失敗した場合は再試行されます（その間、ファイルは残ります）。");
    expect(listed(TASK, "消去されるもの")).toEqual(["保存物 1（DB記録）：この操作で消去します"]);
    expect(listed(TASK, "残るものと理由")).toEqual([...KEPT_COPIES, "人物参照が未確認のコピー 1件と、DBに残る本人記録 2件は、この実行では消去済みになりません。", "人物制御の記録、消去計画、消去済みの記録（再作成の防止と復元時の照合に使われます）。"]);
    expect(confirmation).toHaveTextContent("この操作は取り消せません。消去したDB記録と、ワーカーが消去した管理ファイルは復元できません。");
    expect(within(confirmation).getByRole("button", { name: "この計画の実行可能分を消去する" })).toBeDisabled();
    tick(TASK, CONSENT);
    await press(TASK, "この計画の実行可能分を消去する");
    expect(posts(calls)[1]).toEqual({ method: "POST", path: EXECUTE_SEND, body: keyed(PLAN_EXECUTION, 2) });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(done(TASK)).toHaveTextContent("サーバーの結果：DB記録の消去 1件、部分履歴の保全 0件、管理ファイルの消去待ち 0件。全コピーの消去は完了していません（サーバーの回答）。残存を照合し直してください。");
    expect(surface(TASK)).toBeNull();
  });

  test("\"not all copies erased\" is said because the server says so, and not otherwise", async () => {
    await mount(answers(() => ({ ...executed, queued_count: 2, preserved_archive_count: 1, all_copies_erased: true })));
    await toExecution();
    tick(TASK, CONSENT);
    await press(TASK, "この計画の実行可能分を消去する");
    expect(done(TASK)).toHaveTextContent("サーバーの結果：DB記録の消去 1件、部分履歴の保全 1件、管理ファイルの消去待ち 2件。");
    expect(done(TASK)).not.toHaveTextContent("完了していません");
  });

  test("a plan in which the server keeps everything erases nothing, and says so", async () => {
    const kept = control({ revision: 1, state: "CONTROL_APPLIED_REMAINS", applicable_cases: [], inventory: { ...INVENTORY, targets: INVENTORY.targets.slice(1) } });
    await mount(answers(() => executed, () => kept));
    await toExecution();
    expect(line(TASK, "変更内容")).toHaveTextContent("現在の版との差分はありません。");
    expect(surface(TASK)).toHaveTextContent("サーバーが処理の対象と答えたコピーはありません。この計画を実行しても、何も消去されません。");
  });

  test("what will be erased is the server's statement, never derived here from the reasons a copy stays", async () => {
    // The server says it will not process the copy without a reason to stay, and will
    // process one that lists a reason: the confirmation follows the flags, not the reasons.
    const [first, second, third] = INVENTORY.targets;
    const stated = control({ revision: 1, state: "CONTROL_APPLIED_REMAINS", applicable_cases: [], inventory: { ...INVENTORY, targets: [{ ...first, will_process: false }, { ...second, will_process: true }, third] } });
    await mount(answers(() => executed, () => stated));
    await plan();
    expect(task(TASK)).toHaveTextContent("サーバーが処理の対象と答えたコピー1件");
    await press(TASK, "取り消せない操作の確認へ進む");
    expect(changes(TASK)).toEqual(["保存物 2（外部コピー）：保存中 → サーバーが処理の対象と答えています（外部の実物は、アプリでは消去できません）"]);
    expect(listed(TASK, "消去されるもの")).toEqual(["保存物 2（外部コピー）：サーバーが処理の対象と答えています（外部の実物は、アプリでは消去できません）"]);
    expect(listed(TASK, "残るものと理由").slice(0, 2)).toEqual(["保存物 1（DB記録）：残ります（サーバーの残存理由 なし）", KEPT_COPIES[1]]);
  });

  test("the flags of the plan that will be executed come before those of the list read after it", async () => {
    const flagged = { ...PLAN_ANSWER, targets: [{ copy_id: "db1", will_process: false }, { copy_id: "ext1", will_process: false }, { copy_id: "copy1", will_process: true }] };
    await mount((call: Call) => (call.method === "GET" ? APPLIED : call.path === PLAN_SEND ? flagged : executed));
    await toExecution();
    expect(listed(TASK, "消去されるもの")).toEqual(["保存物 3（管理ファイル）：消去待ちに登録します（実ファイルはワーカーが消去します）"]);
    expect(listed(TASK, "残るものと理由").slice(0, 2)).toEqual(["保存物 1（DB記録）：残ります（サーバーの残存理由 なし）", KEPT_COPIES[0]]);
  });

  test("an answer without the server's statement classifies nothing: every copy is listed with its reasons", async () => {
    const unstated = control({ revision: 1, state: "CONTROL_APPLIED_REMAINS", applicable_cases: [], inventory: { ...INVENTORY, targets: INVENTORY.targets.map(({ will_process: _flag, ...target }) => target) } });
    await mount(answers(() => executed, () => unstated));
    await plan();
    expect(task(TASK)).toHaveTextContent("サーバーが処理の対象と答えたコピーサーバーの回答にありません");
    await press(TASK, "取り消せない操作の確認へ進む");
    expect(changes(TASK)).toEqual(["コピーの処理：保存中 → 処理するコピーは、実行時にサーバーが決めます（この回答には、コピーごとの区別がありません）"]);
    expect(within(surface(TASK)!).queryByRole("list", { name: "消去されるもの" })).toBeNull();
    expect(surface(TASK)).toHaveTextContent("サーバーの回答に、コピーごとの処理の対象かどうかがありません。どのコピーが処理されるかは、ここでは示せません。");
    expect(listed(TASK, "残るものと理由").slice(0, 3)).toEqual([
      "保存物 1（DB記録）：サーバーの残存理由 なし（処理の対象かどうかは、サーバーの回答にありません）",
      "保存物 2（外部コピー）：サーバーの残存理由 管理先の消去確認が必要（処理の対象かどうかは、サーバーの回答にありません）",
      "保存物 3（管理ファイル）：サーバーの残存理由 複数職員を含むため保全判断が必要（処理の対象かどうかは、サーバーの回答にありません）",
    ]);
    // The consent is still asked, and the plan sent is the server's.
    expect(within(surface(TASK)!).getByRole("button", { name: "この計画の実行可能分を消去する" })).toBeDisabled();
  });

  test("an unknown outcome of the erasure sends the identical body again with the same key", async () => {
    let sends = 0;
    const { calls } = await mount(answers(() => { if (++sends === 1) throw new PlanningError(503, "unavailable"); return executed; }));
    await toExecution();
    tick(TASK, CONSENT);
    await press(TASK, "この計画の実行可能分を消去する");
    expect(line(TASK, "競合・部分失敗")).toHaveTextContent("結果を確認できません。");
    expect(surface(TASK)).toHaveTextContent("実行されたかどうかは不明です。");
    await press(TASK, "同じ内容を再送する");
    expect(posts(calls).slice(1).map((call) => call.body)).toEqual([keyed(PLAN_EXECUTION, 2), keyed(PLAN_EXECUTION, 2)]);
    expect(done(TASK)).toHaveTextContent("DB記録の消去 1件");
  });

  test("a conflict shows the server's current list beside the planned one, and the plan must be made again", async () => {
    let state = APPLIED;
    const { calls } = await mount(answers(() => { state = { ...APPLIED, inventory: { ...INVENTORY, targets: [{ ...INVENTORY.targets[0], blockers: ["legal_hold"] }, ...INVENTORY.targets.slice(1)] } }; throw conflict(); }, () => state));
    await toExecution();
    tick(TASK, CONSENT);
    await press(TASK, "この計画の実行可能分を消去する");
    expect(within(surface(TASK)!).getAllByRole("alert")[0]).toHaveTextContent("保全・保存規則・対象が、計画の作成後に変わりました。サーバーが現在返している残存を「現在」に示します。");
    expect(within(within(surface(TASK)!).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("保存物 1（DB記録）の残存理由なし法的保全中なしあり");
    await press(TASK, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(TASK)).toBeNull();
    expect(task(TASK)).toHaveTextContent("この計画は実行していません。保全・保存規則・対象が変わったため、消去計画を作り直して残存理由を確認し直してください。");
    expect(within(task(TASK)).getByRole("button", { name: "消去計画の作成内容を確認する" })).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(2);
  });

  test("a refusal of the plan is the server's message", async () => {
    await mount((call: Call) => { if (call.method === "GET") return APPLIED; throw new PlanningError(422, JSON.stringify({ detail: [{ loc: ["body", "expected_revision"], msg: "Input should be greater than or equal to 1" }] })); });
    await open(TASK);
    await choose(TASK, "消去計画の対象職員", "p1");
    await press(TASK, "消去計画の作成内容を確認する");
    await press(TASK, "消去計画を作成する");
    expect(surface(TASK)).toHaveTextContent("expected_revision：Input should be greater than or equal to 1");
  });

  describe("the joint decision on a shared file copy", () => {
    const JOINT_TASK = "保存物 3の共同消去判断";
    const JOINT_SEND = `/compliance/copies/copy1/joint-review?${SCOPE}`;
    const joint = () => within(task(TASK)).getByText(JOINT_TASK, { selector: "summary" }).closest("details")!;
    const inJoint = (label: string, value: string) => fireEvent.change(within(joint()).getByLabelText(label), { target: { value } });
    const pressJoint = async (name: string) => { await act(async () => { fireEvent.click(within(joint()).getByRole("button", { name })); }); };
    async function enter() {
      await plan();
      await pressJoint("全所有者と現在の判断を取得する");
      inJoint("共同消去の判断理由", "照合済みの判断"); inJoint("全所有者と原本を照合した資料", "原本資料"); inJoint("共同消去の確認者", "責任者");
    }

    test("every owner and the rule are read on demand; the decision is confirmed and sent as the established screen sent it; the plan is then made again", async () => {
      const { calls } = await mount(answers());
      await enter();
      expect(within(within(joint()).getByRole("list", { name: "全所有者と本人対応判断" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["合成 一：本人一の承認（判断 第3版）", "合成 二：本人二の承認（判断 第4版）"]);
      expect(joint()).toHaveTextContent("現在の保存規則：期限満了の共有記録（第5版）");
      expect(within(joint()).getByRole("button", { name: "共同判断の内容を確認する" })).toBeDisabled();
      fireEvent.click(within(joint()).getByLabelText("全所有者・現在の判断・保存規則・共同自由記述を原本と照合した"));
      await pressJoint("共同判断の内容を確認する");
      const confirmation = joint().querySelector(".ideal-confirm") as HTMLElement;
      expect(within(confirmation).getByRole("heading", { level: 4, name: "保存物 3の共同判断：記録前の確認" })).toHaveFocus();
      expect(confirmation).toHaveTextContent("保存物（第7版）に、共同消去の判断を1件記録します。保存物は消去されません。");
      expect(confirmation).toHaveTextContent(`${NOBODY}共同判断の記録（操作者・時刻）は監査の履歴に残ります。`);
      await pressJoint("この共同判断を記録する");
      expect(posts(calls)[1]).toEqual({ method: "POST", path: JOINT_SEND, body: keyed(JOINT, 2) });
      expect(task(TASK)).toHaveTextContent("共同判断を記録しました。残存が変わるため、消去計画を作り直してください。");
      expect(within(task(TASK)).queryByRole("heading", { name: "4. 計画の内容を確かめる" })).toBeNull();
    });

    test("a conflict shows the owners and the copy as the server holds them now, and the comparison must be confirmed again", async () => {
      let source = JOINT_SOURCE;
      const { calls } = await mount((call: Call) => { if (call.method === "GET") return call.path.includes("joint-review") ? source : APPLIED; if (call.path === PLAN_SEND) return PLAN_ANSWER; source = { ...JOINT_SOURCE, revision: 8, context_hash: "9".repeat(64) }; throw conflict(); });
      await enter();
      fireEvent.click(within(joint()).getByLabelText("全所有者・現在の判断・保存規則・共同自由記述を原本と照合した"));
      await pressJoint("共同判断の内容を確認する");
      await pressJoint("この共同判断を記録する");
      expect(within(within(joint()).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row").map((row) => row.textContent)).toContain("保存物の版第7版第8版第7版に対して記録あり");
      await pressJoint("三つの内容を確認し、現在の版に対して確認し直す");
      expect(within(joint()).getByLabelText("全所有者・現在の判断・保存規則・共同自由記述を原本と照合した")).not.toBeChecked();
      expect(within(joint()).getByLabelText("共同消去の判断理由")).toHaveValue("照合済みの判断");
      expect(posts(calls)).toHaveLength(2);
    });

    test("a copy the server does not accept for a joint decision says so in the server's words", async () => {
      await mount((call: Call) => { if (call.method === "GET" && call.path.includes("joint-review")) throw new PlanningError(422, JSON.stringify({ detail: "A complete shared subject set is required" })); return call.method === "GET" ? APPLIED : PLAN_ANSWER; });
      await plan();
      await pressJoint("全所有者と現在の判断を取得する");
      expect(within(joint()).getByRole("alert")).toHaveTextContent("A complete shared subject set is required");
    });
  });
});

describe("the copies of one person", () => {
  const TASK = TASKS.copies;
  const PREVIEW_SEND = `/compliance/copies/preview?${SCOPE}`;
  const EXECUTE_SEND = `/compliance/copies/execute?${SCOPE}`;
  const INVENTORY_READ = `/compliance/copies?${SCOPE}&person_id=p1`;
  const executed = { plan_id: "plan-1", revision: 2, state: "REMAINS", queued_copy_ids: ["f1"], erased_database_copy_ids: ["db1"], preserved_archive_ids: ["a1"], all_copies_complete: false };
  const confirmed = { copy_id: "ext1", revision: 5, state: "EXTERNAL_CONFIRMED", confirmation: { local_physical_erasure_verified: false }, all_copies_complete: false };
  const answers = (over: (call: Call) => unknown = () => undefined) => (call: Call) => over(call)
    ?? (call.path === PREVIEW_SEND ? COPY_PLAN : call.path === EXECUTE_SEND ? executed : call.path.includes("/projection") ? PROJECTION : call.path.includes("confirm-external") ? confirmed : call.path === INVENTORY_READ ? INVENTORY : { copy_id: "copy1", revision: 2, projection_hash: "hash2" });
  async function preview() { await open(TASK); set(TASK, "コピーを確認する職員", "p1"); await press(TASK, "確認版の作成内容を確認する"); await press(TASK, "確認版を作成する"); }
  const part = (summary: string) => within(task(TASK)).getByText(summary, { selector: "summary" }).closest("details")!;
  const inPart = (summary: string, label: string, value: string) => fireEvent.change(within(part(summary)).getByLabelText(label), { target: { value } });
  const pressPart = async (summary: string, name: string) => { await act(async () => { fireEvent.click(within(part(summary)).getByRole("button", { name })); }); };

  test("nothing is read or recorded until the plan is confirmed; the plan lists every copy with the server's reasons", async () => {
    const { calls } = await mount(answers());
    await open(TASK);
    set(TASK, "コピーを確認する職員", "p1");
    await press(TASK, "確認版の作成内容を確認する");
    expect(within(surface(TASK)!).getByRole("heading", { name: "2. 確認版の作成前の確認" })).toHaveFocus();
    expect(line(TASK, "作成される版")).toHaveTextContent("コピーの確認版（消去計画）を1件作成します。確認版を作成しても、何も消去されません。");
    expect(line(TASK, "通知")).toHaveTextContent(`${NOBODY}確認版の作成の記録（操作者・時刻）は監査の履歴に残ります。`);
    expect(calls).toEqual([]);
    await press(TASK, "確認版を作成する");
    expect(calls).toEqual([{ method: "POST", path: PREVIEW_SEND, body: keyed(COPY_PREVIEW) }]);
    expect(within(task(TASK)).getByRole("heading", { name: "3. 対象と残存理由を確かめる" })).toHaveFocus();
    expect(lines(TASK, "コピーの消去対象と残存理由")).toEqual(TARGET_LINES);
    expect(task(TASK)).toHaveTextContent("消去・保全・復元の制御記録1件（再作成の防止などに使う記録で、消去済みには数えません）");
    // The outside confirmation is offered for the outside copy, the preservation decision
    // for the copy the server gave a projection for.
    expect(part("保存物 2：外部管理先の処理確認を記録する")).toBeInTheDocument();
    expect(part("保存物 3：共有記録を再構成して他の職員の履歴を保全する")).toBeInTheDocument();
    expect(within(task(TASK)).queryByText(/^保存物 1：/, { selector: "summary" })).toBeNull();
  });

  test("the erasure is confirmed with the consent and sent as the established screen sent it; the result is the server's", async () => {
    const { calls, refresh } = await mount(answers());
    await preview();
    await press(TASK, "取り消せない操作の確認へ進む");
    const confirmation = surface(TASK)!;
    expect(within(confirmation).getByRole("heading", { name: "4. 取り消せない操作の確認：消去可能分の実行" })).toHaveFocus();
    expect(listed(TASK, "消去されるもの")).toEqual(["保存物 1（DB記録）：この操作で消去します"]);
    expect(listed(TASK, "残るものと理由")).toEqual([...KEPT_COPIES, "人物参照が未確認のコピー 1件と、DBに残る本人記録 2件は、この実行では消去済みになりません。", "確認版と、消去済みの記録（復元時の照合に使われます）。"]);
    expect(line(TASK, "作成される版")).toHaveTextContent("確認版は第1版 → 第2版になります。");
    expect(within(confirmation).getByRole("button", { name: "この確認版の消去可能分を実行する" })).toBeDisabled();
    tick(TASK, CONSENT);
    await press(TASK, "この確認版の消去可能分を実行する");
    expect(posts(calls)[1]).toEqual({ method: "POST", path: EXECUTE_SEND, body: keyed(COPY_EXECUTION, 2) });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(done(TASK)).toHaveTextContent("サーバーの結果：DB記録の消去 1件、部分履歴の保全 1件、管理ファイルの消去待ち 1件。全コピーの消去は完了していません（サーバーの回答）。残存を確認し直してください。");
  });

  test("the copies' confirmation follows the server's statement too, and classifies nothing without it", async () => {
    const [first, second, third] = COPY_PLAN.targets;
    const stated = { ...COPY_PLAN, targets: [{ ...first, will_process: false }, second, { ...third, will_process: true }] };
    const shown = await mount(answers((call) => (call.path === PREVIEW_SEND ? stated : undefined)));
    await preview();
    await press(TASK, "取り消せない操作の確認へ進む");
    expect(listed(TASK, "消去されるもの")).toEqual(["保存物 3（管理ファイル）：消去待ちに登録します（実ファイルはワーカーが消去します）"]);
    expect(listed(TASK, "残るものと理由").slice(0, 2)).toEqual(["保存物 1（DB記録）：残ります（サーバーの残存理由 なし）", KEPT_COPIES[0]]);
    expect(shown.calls.filter((call) => call.path === EXECUTE_SEND)).toEqual([]);
  });

  test("a preview without the server's statement lists every copy with its reasons and no classification", async () => {
    const unstated = { ...COPY_PLAN, targets: COPY_PLAN.targets.map(({ will_process: _flag, ...target }) => target) };
    await mount(answers((call) => (call.path === PREVIEW_SEND ? unstated : undefined)));
    await preview();
    expect(task(TASK)).toHaveTextContent("サーバーが処理の対象と答えたコピーサーバーの回答にありません");
    await press(TASK, "取り消せない操作の確認へ進む");
    expect(within(surface(TASK)!).queryByRole("list", { name: "消去されるもの" })).toBeNull();
    expect(surface(TASK)).toHaveTextContent("サーバーの回答に、コピーごとの処理の対象かどうかがありません。");
    expect(listed(TASK, "残るものと理由")[0]).toBe("保存物 1（DB記録）：サーバーの残存理由 なし（処理の対象かどうかは、サーバーの回答にありません）");
  });

  test("a conflict on the erasure compares the plan with the server's current list; an unknown outcome resends the same body", async () => {
    let sends = 0;
    const { calls } = await mount(answers((call) => { if (call.path !== EXECUTE_SEND) return undefined; sends += 1; if (sends === 1) throw new PlanningError(503, "unavailable"); if (sends === 2) throw conflict(); return executed; }));
    await preview();
    await press(TASK, "取り消せない操作の確認へ進む");
    tick(TASK, CONSENT);
    await press(TASK, "この確認版の消去可能分を実行する");
    await press(TASK, "同じ内容を再送する");
    expect(posts(calls).slice(1).map((call) => call.body)).toEqual([keyed(COPY_EXECUTION, 2), keyed(COPY_EXECUTION, 2)]);
    expect(calls[calls.length - 1]).toEqual({ method: "GET", path: INVENTORY_READ, body: undefined });
    expect(within(within(surface(TASK)!).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")).toHaveLength(6);
    await press(TASK, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(task(TASK)).toHaveTextContent("この確認版は実行していません。保全・保存規則・対象が変わったため、確認版を作り直して残存理由を確認し直してください。");
    expect(surface(TASK)).toBeNull();
  });

  test("an outside custodian's confirmation: nothing is erased here, it cannot be taken back, and the consent is asked", async () => {
    const SUMMARY = "保存物 2：外部管理先の処理確認を記録する";
    const { calls } = await mount(answers());
    await preview();
    inPart(SUMMARY, "外部管理先の処理確認資料", "処理確認書"); inPart(SUMMARY, "外部処理の確認担当者", "担当者");
    await pressPart(SUMMARY, "処理確認の記録内容を確認する");
    const confirmation = part(SUMMARY).querySelector(".ideal-confirm") as HTMLElement;
    expect(within(confirmation).getByRole("heading", { level: 4, name: "保存物 2：取り消せない操作の確認（外部管理先の処理確認）" })).toHaveFocus();
    expect(confirmation).toHaveTextContent("アプリは何も消去しません。外部の管理先が消去または処理したという確認を記録するだけで、端末や媒体の物理的な消去をアプリが検証したことにはなりません。");
    expect(within(within(confirmation).getByRole("list", { name: "残るものと理由" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["この外部コピーの登録記録（状態は「処理確認を記録済み」になります）と、確認の記録。", "外部の管理先にある実物。アプリからは消去も検証もできません。"]);
    expect(confirmation).toHaveTextContent("この操作は取り消せません。記録した確認は取り消せません。サーバーは、処理確認を記録済みの外部コピーに対する再確認・再登録を拒否します。");
    expect(confirmation).toHaveTextContent("第4版 → 第5版");
    expect(confirmation).toHaveTextContent(`${NOBODY}確認の記録（保存物・対象の職員・操作者・時刻）は監査の履歴に残ります。`);
    expect(within(confirmation).getByRole("button", { name: "外部管理先の処理確認を記録する" })).toBeDisabled();
    fireEvent.click(within(confirmation).getByLabelText("外部管理先の確認資料を確かめ、取り消せない確認の記録に同意した"));
    await pressPart(SUMMARY, "外部管理先の処理確認を記録する");
    expect(posts(calls)[1]).toEqual({ method: "POST", path: `/compliance/copies/confirm-external?${SCOPE}`, body: keyed(EXTERNAL_CONFIRMATION, 2) });
    // The plan is stale now: it is dropped, and the server's words are passed on.
    expect(task(TASK)).toHaveTextContent("保存物 2：外部管理先の処理確認を記録しました（第5版）。端末や媒体の物理的な消去は、アプリでは検証していません。全コピーの消去は完了していません（サーバーの回答）。残存を確認し直してください。");
    expect(within(task(TASK)).queryByRole("heading", { name: "3. 対象と残存理由を確かめる" })).toBeNull();
  });

  test("a refused outside confirmation is the server's message", async () => {
    const SUMMARY = "保存物 2：外部管理先の処理確認を記録する";
    await mount(answers((call) => { if (call.path.includes("confirm-external")) throw new PlanningError(422, JSON.stringify({ detail: "External copy retention rule is missing" })); return undefined; }));
    await preview();
    inPart(SUMMARY, "外部管理先の処理確認資料", "処理確認書"); inPart(SUMMARY, "外部処理の確認担当者", "担当者");
    await pressPart(SUMMARY, "処理確認の記録内容を確認する");
    fireEvent.click(within(part(SUMMARY)).getByLabelText("外部管理先の確認資料を確かめ、取り消せない確認の記録に同意した"));
    await pressPart(SUMMARY, "外部管理先の処理確認を記録する");
    expect(within(part(SUMMARY)).getByRole("alert")).toHaveTextContent("External copy retention rule is missing");
  });

  test("the preservation decision reads exactly what would be kept, and is sent as the established screen sent it", async () => {
    const SUMMARY = "保存物 3：共有記録を再構成して他の職員の履歴を保全する";
    const { calls } = await mount(answers());
    await preview();
    await pressPart(SUMMARY, "保全する内容を読み込む");
    expect(calls[1]).toEqual({ method: "GET", path: `/compliance/copies/copy1/projection?${SCOPE}&person_id=p1`, body: undefined });
    expect(part(SUMMARY)).toHaveTextContent("保全する職員合成 二");
    expect(part(SUMMARY)).toHaveTextContent("除去される内容people：1件");
    // The whole retained content is shown as labelled lines.
    expect(within(part(SUMMARY)).getByRole("region", { name: "再構成後に保存する全内容" })).toHaveTextContent("people：person_id：p2name：合成 二note：共通の注記");
    inPart(SUMMARY, "保全・消去判断の根拠", "保全根拠"); inPart(SUMMARY, "確認者", "確認者");
    expect(within(part(SUMMARY)).getByRole("button", { name: "保全判断の内容を確認する" })).toBeDisabled();
    fireEvent.click(within(part(SUMMARY)).getByLabelText(/自由記述・共通情報にも消去対象者の情報が残らないことを、この内容で確認した/));
    await pressPart(SUMMARY, "保全判断の内容を確認する");
    const confirmation = part(SUMMARY).querySelector(".ideal-confirm") as HTMLElement;
    expect(confirmation).toHaveTextContent("第1版 → 第2版");
    expect(confirmation).toHaveTextContent(`${NOBODY}保全判断の記録（保存物・操作者・時刻）は監査の履歴に残ります。`);
    await pressPart(SUMMARY, "この保全判断を記録する");
    expect(posts(calls)[1]).toEqual({ method: "POST", path: `/compliance/copies/review-preservation?${SCOPE}`, body: keyed(PRESERVATION, 2) });
    expect(task(TASK)).toHaveTextContent("保存物 3：保全判断を記録しました（第2版）。何も消去していません。コピーの残存を確認し直してください。");
  });
});

describe("registering a copy handed to somebody outside", () => {
  const TASK = TASKS.register;
  const SEND = `/compliance/copies/register?${SCOPE}`;
  const SECRET = "synthetic private contents";
  const file = (name = "synthetic.csv", bytes = [1, 2, 3]) => { const item = new File([SECRET], name, { type: "text/csv" }); Object.defineProperty(item, "arrayBuffer", { value: async () => new Uint8Array(bytes).buffer }); return item; };
  const pick = async (item: File) => { await act(async () => { fireEvent.change(task(TASK).querySelector("input[type=file]")!, { target: { files: [item] } }); }); };
  async function fill(verified: boolean) {
    await open(TASK);
    await pick(file());
    tick(TASK, "合成 一");
    set(TASK, "受渡し先・管理場所", "給与担当の隔離保管"); set(TASK, "選んだ保存起算の日時（日本時間）", "2026-09-01T09:00:07"); set(TASK, "人物一覧と受渡しの確認根拠", "合成受渡し記録");
    if (verified) { set(TASK, "確認者", "確認者"); tick(TASK, "原本と全対象者・受渡し先を照合した"); }
    await press(TASK, "登録の内容を確認する");
  }

  test("the file is hashed here and only the hash is sent: the body is the established screen's, and the content appears nowhere", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { calls, refresh } = await mount(() => ({ copy_id: UUID, revision: 1 }));
    await fill(false);
    expect(global.crypto.subtle.digest).toHaveBeenCalledWith("SHA-256", expect.anything());
    expect(changes(TASK)).toEqual([
      "受け渡したファイル：（なし） → synthetic.csv（本文は送信せず、SHA-256だけを登録）", "ファイルに含む対象職員：（なし） → 合成 一", "受渡し先・管理場所：（なし） → 給与担当の隔離保管",
      "保存期間の起算：（なし） → 最終更新・受渡し・2026-09-01 09:00:07", "対象者一覧の確認：（なし） → 未確認", "確認根拠：（なし） → 合成受渡し記録",
    ]);
    expect(line(TASK, "作成される版")).toHaveTextContent("新規登録（第1版を作成）");
    expect(line(TASK, "通知")).toHaveTextContent(`${NOBODY}登録の記録（保存物・操作者・時刻）は監査の履歴に残ります。`);
    expect(calls).toEqual([]);
    await press(TASK, "この内容で外部コピーを登録する");
    expect(calls).toEqual([{ method: "POST", path: SEND, body: keyed(REGISTRATION) }]);
    expect(JSON.stringify(calls)).not.toContain(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(log).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(done(TASK)).toHaveTextContent("外部コピーの来歴を登録しました（第1版）。外部の実物の消去を確認した状態ではありません。");
  });

  test("a verified registration names the verifier; an unknown outcome resends the same registration with the same identifier", async () => {
    let sends = 0;
    const { calls } = await mount(() => { if (++sends === 1) throw new PlanningError(503, "unavailable"); return { copy_id: UUID, revision: 1 }; });
    await fill(true);
    expect(changes(TASK)[4]).toBe("対象者一覧の確認：（なし） → 確認済み（確認者 確認者）");
    await press(TASK, "この内容で外部コピーを登録する");
    await press(TASK, "同じ内容を再送する");
    expect(calls.map((call) => call.body)).toEqual([keyed(VERIFIED_REGISTRATION), keyed(VERIFIED_REGISTRATION)]);
  });

  test("going back and confirming the same draft again after an unknown outcome resends the identical body and key; a changed draft is a new registration", async () => {
    let made = 0;
    Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => `00000000-0000-4000-8000-00000000000${++made}`) });
    let sends = 0;
    const { calls } = await mount(() => { if (++sends <= 2) throw new PlanningError(503, "unavailable"); return { copy_id: "registered", revision: 1 }; });
    await fill(false);
    await press(TASK, "この内容で外部コピーを登録する");
    expect(line(TASK, "競合・部分失敗")).toHaveTextContent("結果を確認できません。");
    // Back to the entries, nothing changed, and on to the confirmation again.
    await press(TASK, "入力に戻る");
    expect(surface(TASK)).toBeNull();
    await press(TASK, "登録の内容を確認する");
    await press(TASK, "この内容で外部コピーを登録する");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[0].body).toMatchObject({ idempotency_key: "idempotency-key-1", payload: { copy_id: "00000000-0000-4000-8000-000000000001" } });
    // The same again, the third time answered: still the first identifier and the first key.
    await press(TASK, "入力に戻る");
    set(TASK, "受渡し先・管理場所", "別の管理場所");
    set(TASK, "受渡し先・管理場所", "給与担当の隔離保管");
    await press(TASK, "登録の内容を確認する");
    await press(TASK, "この内容で外部コピーを登録する");
    expect(calls[2]).toEqual(calls[0]);
    expect(done(TASK)).toHaveTextContent("外部コピーの来歴を登録しました（第1版）。");
    expect(made).toBe(1);
  });

  test("a draft that was changed after an unknown outcome is another registration, with its own identifier and key", async () => {
    let made = 0;
    Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => `00000000-0000-4000-8000-00000000000${++made}`) });
    const { calls } = await mount(() => { throw new PlanningError(503, "unavailable"); });
    await fill(false);
    await press(TASK, "この内容で外部コピーを登録する");
    await press(TASK, "入力に戻る");
    set(TASK, "受渡し先・管理場所", "別の管理場所");
    await press(TASK, "登録の内容を確認する");
    await press(TASK, "この内容で外部コピーを登録する");
    const [first, second] = calls.map((call) => call.body as { idempotency_key: string; payload: { copy_id: string; relative_path: string } });
    expect([first.payload.copy_id, second.payload.copy_id]).toEqual(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]);
    expect([first.idempotency_key, second.idempotency_key]).toEqual(["idempotency-key-1", "idempotency-key-2"]);
    expect(second.payload.relative_path).toBe("別の管理場所");
    // Another file is another draft as well.
    await press(TASK, "入力に戻る");
    Object.defineProperty(global.crypto, "subtle", { configurable: true, value: { digest: jest.fn(async () => new Uint8Array(32).fill(9).buffer) } });
    await pick(file("other.csv", [4]));
    await press(TASK, "登録の内容を確認する");
    await press(TASK, "この内容で外部コピーを登録する");
    expect((calls[2].body as typeof first).payload.copy_id).toBe("00000000-0000-4000-8000-000000000003");
  });

  test("the identifier follows the body that is sent: a change to a field that is not sent keeps the identifier and the key", async () => {
    let made = 0;
    Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => `00000000-0000-4000-8000-00000000000${++made}`) });
    let sends = 0;
    const { calls } = await mount(() => { if (++sends <= 2) throw new PlanningError(503, "unavailable"); return { copy_id: "registered", revision: 1 }; });
    await fill(false);
    await press(TASK, "この内容で外部コピーを登録する");
    expect(line(TASK, "競合・部分失敗")).toHaveTextContent("結果を確認できません。");
    // The reviewer of a list that is not marked as verified is not part of the request.
    await press(TASK, "入力に戻る");
    set(TASK, "確認者", "まだ照合していない確認者");
    await press(TASK, "登録の内容を確認する");
    await press(TASK, "この内容で外部コピーを登録する");
    expect(calls[1]).toEqual(calls[0]);
    // Neither is the name of the file: the same content under another name is the same request.
    await press(TASK, "入力に戻る");
    await pick(file("renamed.csv"));
    await press(TASK, "登録の内容を確認する");
    expect(changes(TASK)[0]).toBe("受け渡したファイル：（なし） → renamed.csv（本文は送信せず、SHA-256だけを登録）");
    await press(TASK, "この内容で外部コピーを登録する");
    expect(calls[2]).toEqual(calls[0]);
    expect(calls[0].body).toEqual({ ...REGISTRATION, payload: { ...REGISTRATION.payload, copy_id: "00000000-0000-4000-8000-000000000001" }, idempotency_key: "idempotency-key-1" });
    expect(made).toBe(1);
    expect(done(TASK)).toHaveTextContent("外部コピーの来歴を登録しました（第1版）。");
  });

  test("the same field is part of the body once the list is marked as verified: changing it then is another registration", async () => {
    let made = 0;
    Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: jest.fn(() => `00000000-0000-4000-8000-00000000000${++made}`) });
    const { calls } = await mount(() => { throw new PlanningError(503, "unavailable"); });
    await fill(true);
    await press(TASK, "この内容で外部コピーを登録する");
    await press(TASK, "入力に戻る");
    set(TASK, "確認者", "別の確認者");
    await press(TASK, "登録の内容を確認する");
    await press(TASK, "この内容で外部コピーを登録する");
    const [first, second] = calls.map((call) => call.body as { idempotency_key: string; payload: { copy_id: string; evidence: { verified_by: string | null } } });
    expect([first.payload.copy_id, second.payload.copy_id]).toEqual(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]);
    expect([first.idempotency_key, second.idempotency_key]).toEqual(["idempotency-key-1", "idempotency-key-2"]);
    expect([first.payload.evidence.verified_by, second.payload.evidence.verified_by]).toEqual(["確認者", "別の確認者"]);
  });

  test("a person under control is refused by the server, in its words; without a file or a person nothing is sent", async () => {
    const { calls } = await mount(() => { throw conflict(); });
    await open(TASK);
    expect(within(task(TASK)).getByRole("button", { name: "登録の内容を確認する" })).toBeDisabled();
    await pick(file());
    set(TASK, "受渡し先・管理場所", "給与担当の隔離保管"); set(TASK, "選んだ保存起算の日時（日本時間）", "2026-09-01T09:00:07"); set(TASK, "人物一覧と受渡しの確認根拠", "合成受渡し記録");
    await press(TASK, "登録の内容を確認する");
    expect(within(task(TASK)).getByRole("alert")).toHaveTextContent("原本ファイルと、ファイルに含む対象職員を選んでください。");
    expect(surface(TASK)).toBeNull();
    tick(TASK, "合成 一");
    await press(TASK, "登録の内容を確認する");
    await press(TASK, "この内容で外部コピーを登録する");
    expect(within(surface(TASK)!).getByRole("alert")).toHaveTextContent("Input, version or ledger conflict; refresh and review again");
    expect(calls).toHaveLength(1);
  });

  test("the file chosen last is the one that is hashed, even when an earlier hash finishes later", async () => {
    let finishFirst!: (value: ArrayBuffer) => void, finishSecond!: (value: ArrayBuffer) => void;
    Object.defineProperty(global.crypto, "subtle", { configurable: true, value: { digest: jest.fn((_name: string, bytes: ArrayBuffer) => new Promise<ArrayBuffer>((resolve) => { if (new Uint8Array(bytes)[0] === 1) finishFirst = resolve; else finishSecond = resolve; })) } });
    await mount();
    await open(TASK);
    await pick(file("first.csv", [1]));
    await waitFor(() => expect(finishFirst).toBeDefined());
    await pick(file("second.csv", [2]));
    await waitFor(() => expect(finishSecond).toBeDefined());
    await act(async () => finishSecond(new Uint8Array(32).fill(2).buffer));
    expect(task(TASK)).toHaveTextContent(`second.csv：SHA-256 ${"02".repeat(32)}`);
    await act(async () => finishFirst(new Uint8Array(32).fill(1).buffer));
    expect(task(TASK)).toHaveTextContent(`second.csv：SHA-256 ${"02".repeat(32)}`);
  });
});

describe("the person references of existing records", () => {
  const TASK = TASKS.backfill;
  const READ_CANDIDATES = `/compliance/copies/account-backfill?${SCOPE}`;

  test("the candidates are read when the task is opened; they are confirmed and added as the established screen sent it", async () => {
    let candidates = BACKFILL_PREVIEW;
    const { calls, refresh } = await mount((call: Call) => { if (call.method === "GET") return candidates; candidates = { preview_hash: "0".repeat(64), changes: [], unresolved_copy_ids: [] }; return { updated_copies: 1, unresolved_copy_ids: ["copy-unknown"], subject_reviews_required: true }; });
    expect(calls).toEqual([]);
    await open(TASK);
    expect(calls).toEqual([{ method: "GET", path: READ_CANDIDATES, body: undefined }]);
    expect(task(TASK)).toHaveTextContent("追加候補1件");
    expect(task(TASK)).toHaveTextContent("人物対応が未確定の記録1件");
    expect(listed(TASK, "操作者参照の追加候補")).toEqual(["記録 1（第2版）：追加する職員 合成 二"]);
    await press(TASK, "追加の内容を確認する");
    expect(changes(TASK)).toEqual(["記録 1：第2版 → 第3版（追加する職員 合成 二）"]);
    expect(line(TASK, "作成される版")).toHaveTextContent("候補の記録 1件のそれぞれが、上の「変更内容」の版になります。対象者一覧の確認状態は、未確認に戻ります。");
    expect(line(TASK, "通知")).toHaveTextContent(`${NOBODY}追加を受け付けた記録は、サーバーに残ります。`);
    expect(line(TASK, "競合・部分失敗")).toHaveTextContent("全件を追加するか、1件も追加しないかのどちらかで、一部だけが追加されることはありません。");
    await press(TASK, "この確認版の参照を追加する");
    expect(posts(calls)).toEqual([{ method: "POST", path: READ_CANDIDATES, body: keyed(BACKFILL) }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(done(TASK)).toHaveTextContent("1件の記録に参照を追加しました。以前の対象者確認は無効になりました（サーバーの回答：対象者一覧の確認が必要）。");
    await waitFor(() => expect(task(TASK)).toHaveTextContent("サーバーが返した追加候補はありません。"));
  });

  test("a conflict shows the candidates the server made again; they are confirmed again before anything is added", async () => {
    let candidates = BACKFILL_PREVIEW;
    let sends = 0;
    const { calls } = await mount((call: Call) => { if (call.method === "GET") return candidates; if (++sends === 1) { candidates = { ...BACKFILL_PREVIEW, preview_hash: "1".repeat(64), unresolved_copy_ids: [] }; throw conflict(); } return { updated_copies: 1, unresolved_copy_ids: [], subject_reviews_required: true }; });
    await open(TASK);
    await press(TASK, "追加の内容を確認する");
    await press(TASK, "この確認版の参照を追加する");
    expect(within(within(surface(TASK)!).getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("候補追加候補 1件・人物対応が未確定 1件追加候補 1件・人物対応が未確定 0件追加候補 1件・人物対応が未確定 1件あり");
    await press(TASK, "三つの内容を確認し、現在の版に対して確認し直す");
    expect(surface(TASK)).toHaveTextContent("サーバーが作り直した候補に対する追加として確認し直します。");
    await press(TASK, "この確認版の参照を追加する");
    expect(posts(calls)[1].body).toEqual(keyed({ ...BACKFILL, payload: { preview_hash: "1".repeat(64) } }, 2));
  });
});
