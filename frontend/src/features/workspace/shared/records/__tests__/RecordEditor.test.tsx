import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createIdealClient } from "@/ideal/api/client";
import { createMutator } from "@/ideal/api/mutations";
import { PlanningError } from "@/lib/planningTransport";
import { LiveProvider, liveFrom } from "../../../shell/WorkspaceRuntime";
import { syntheticContext } from "../../../showcase/synthetic/context";
import { hasUnsavedChanges } from "../../useUnsavedNavigation";
import type { Fact } from "../facts";
import RecordEditor from "../RecordEditor";
import type { RecordVersion } from "../useRecordSave";

type Rule = { rule_id: string; hours: number; note: string };
type Body = { expected_revision: number; payload: Rule; idempotency_key: string };
const facts = (rule: Rule): Fact[] => [{ label: "1日の時間数", text: `${rule.hours}時間` }, { label: "備考", text: rule.note || "（なし）" }];
const stored: Rule = { rule_id: "r1", hours: 8, note: "" };

type Extra = Pick<Parameters<typeof RecordEditor<Rule, { revision: number }>>[0], "expected" | "initialTarget" | "focusOnMount" | "confirmation" | "saved">;
function mount({ send, current = null, appendOnly = false, prepare, extra = {} }: { send: (body: Body) => Promise<{ revision: number }>; current?: RecordVersion<Rule> | null; appendOnly?: boolean; prepare?: (rule: Rule) => Rule | Promise<Rule>; extra?: Extra }) {
  const refresh = jest.fn(async () => undefined);
  let keys = 0;
  const live = liveFrom(syntheticContext("ADMIN"), { client: createIdealClient("test", async () => { throw new Error("not used"); }), mutate: createMutator("test", () => `key-${++keys}`), refresh });
  const sent: Body[] = [];
  render(<LiveProvider live={live}><RecordEditor<Rule, { revision: number }>
    noun="取得規則" contentTitle="規則の内容を入力する" appendOnly={appendOnly} prepare={prepare}
    records={appendOnly ? [] : [{ key: "r1", revision: 2, payload: stored, label: "8時間の規則" }]}
    create={() => ({ rule_id: "new-rule", hours: 0, note: "" })}
    facts={facts}
    fields={({ value, exists, onChange }) => <>
      <label htmlFor="hours">1日の時間数</label>
      <input id="hours" type="number" value={value.hours} onChange={(event) => onChange({ hours: event.target.valueAsNumber })} />
      <p>{exists ? "登録済みの記録" : "新しい記録"}</p>
    </>}
    mutation={(rule) => `record:rule:${rule.rule_id}`}
    send={async (body) => { sent.push(body); return send(body); }}
    readCurrent={async () => current}
    notified="誰にも通知されません。" risk={(revision) => `サーバーが第${revision}版と照合します。`}
    slip={(rule) => (rule.hours > 24 ? "1日は24時間までです。" : null)}
    refusedChange="時間数を変えるときは、新しい規則として登録してください。" {...extra} /></LiveProvider>);
  return { sent, refresh };
}
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const surface = () => document.querySelector(".ideal-confirm") as HTMLElement;
const line = (term: string) => within(surface()).getByText(term, { selector: "dt" }).parentElement!;

test("choose, enter, confirm, save: nothing is sent before the confirmation and the body carries the revision the edit started from", async () => {
  const { sent, refresh } = mount({ send: async (body) => ({ revision: body.expected_revision + 1 }) });
  expect(screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual(["1. 対象を選ぶ"]);
  expect(within(screen.getByLabelText("編集する対象")).getAllByRole("option").map((option) => option.textContent)).toEqual(["選んでください", "新しい取得規則を登録する", "8時間の規則（第2版）"]);
  set("編集する対象", "r1");
  expect(screen.getByText("登録済みの記録")).toBeInTheDocument();
  set("1日の時間数", "7");
  expect(screen.getByLabelText("編集する対象")).toBeDisabled();
  expect(hasUnsavedChanges()).toBe(true);
  press("保存内容を確認する");
  expect(sent).toEqual([]);
  expect(within(surface()).getByRole("heading", { level: 4, name: "3. 保存前の確認" })).toHaveFocus();
  expect(line("変更内容")).toHaveTextContent("1日の時間数：8時間 → 7時間");
  expect(line("作成される版")).toHaveTextContent("第2版 → 第3版");
  expect(line("競合・部分失敗")).toHaveTextContent("サーバーが第2版と照合します。");
  await act(async () => { press("この内容で保存する"); });
  expect(sent).toEqual([{ expected_revision: 2, payload: { ...stored, hours: 7 }, idempotency_key: "key-1" }]);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText("取得規則を第3版として保存しました。")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 4, name: "1. 対象を選ぶ" })).toHaveFocus();
  expect(screen.getByLabelText("編集する対象")).toHaveValue("");
  expect(hasUnsavedChanges()).toBe(false);
});

test("a kind that is only added to has no record to choose; the content step comes first and starts again after a save", async () => {
  const { sent } = mount({ appendOnly: true, send: async () => ({ revision: 1 }), prepare: (rule) => ({ ...rule, note: "新規" }) });
  expect(screen.queryByLabelText("編集する対象")).toBeNull();
  expect(screen.getByRole("heading", { level: 4, name: "1. 規則の内容を入力する" })).toBeInTheDocument();
  expect(screen.getByText("新しい記録")).toBeInTheDocument();
  set("1日の時間数", "25");
  press("保存内容を確認する");
  expect(screen.getByRole("alert")).toHaveTextContent("1日は24時間までです。");
  expect(surface()).toBeNull();
  set("1日の時間数", "6");
  press("保存内容を確認する");
  expect(within(surface()).getByRole("heading", { level: 4, name: "2. 保存前の確認" })).toBeInTheDocument();
  expect(line("作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  // What is sent is what the confirmation showed, including what `prepare` adds.
  expect(line("変更内容")).toHaveTextContent("備考：（なし） → 新規");
  await act(async () => { press("この内容で保存する"); });
  expect(sent[0]).toMatchObject({ expected_revision: 0, payload: { rule_id: "new-rule", hours: 6, note: "新規" } });
  expect(screen.getByLabelText("1日の時間数")).toHaveValue(0);
  press("入力を破棄する");
  expect(screen.getByRole("heading", { level: 4, name: "1. 規則の内容を入力する" })).toHaveFocus();
});

test("a conflict whose current version is the one the edit started from says that the server does not take the change", async () => {
  const { sent } = mount({ current: { revision: 2, payload: stored }, send: async () => { throw new PlanningError(409, "conflict"); } });
  set("編集する対象", "r1");
  set("1日の時間数", "7");
  press("保存内容を確認する");
  await act(async () => { press("この内容で保存する"); });
  expect(within(surface()).getByRole("alert")).toHaveTextContent("現在の版は第2版です。");
  expect(surface()).toHaveTextContent("サーバーにある版は、編集を始めたときと同じ第2版です。それでも競合と答えたため、サーバーはこの記録のこの変更を受け付けていません。時間数を変えるときは、新しい規則として登録してください。");
  expect(within(surface()).getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
  press("三つの内容を確認し、現在の版に対して確認し直す");
  expect(within(surface()).getByRole("status")).toHaveTextContent("現在の第2版との差分に更新しました。");
  await act(async () => { press("この内容で保存する"); });
  expect(sent).toHaveLength(2);
});

test("an unknown outcome resends the identical body with the same key; a refusal keeps the entries", async () => {
  let attempts = 0;
  const { sent } = mount({ send: async () => { attempts += 1; if (attempts === 1) throw new PlanningError(503, "down"); if (attempts === 2) return { revision: 1 }; throw new PlanningError(422, JSON.stringify({ detail: "Hourly quantum cannot exceed the equivalent day" })); } });
  set("編集する対象", "new");
  set("1日の時間数", "4");
  press("保存内容を確認する");
  await act(async () => { press("この内容で保存する"); });
  expect(line("競合・部分失敗")).toHaveTextContent("結果を確認できません。");
  await act(async () => { press("同じ内容を再送する"); });
  expect(sent[1]).toEqual(sent[0]);
  set("編集する対象", "new");
  set("1日の時間数", "3");
  press("保存内容を確認する");
  await act(async () => { press("この内容で保存する"); });
  expect(within(surface()).getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりましたHourly quantum cannot exceed the equivalent day");
  press("入力に戻る");
  expect(screen.getByLabelText("1日の時間数")).toHaveValue(3);
  expect(screen.getByRole("heading", { level: 4, name: "2. 規則の内容を入力する" })).toHaveFocus();
});

test("a kind identified by its content sends changed content as a record that is not registered yet", async () => {
  const { sent } = mount({ send: async () => ({ revision: 1 }), extra: { expected: (base, rule) => (rule.hours === base.payload.hours ? base.revision : 0) } });
  set("編集する対象", "r1");
  press("保存内容を確認する");
  expect(line("作成される版")).toHaveTextContent("第2版のまま（内容が同じため、新しい版は作られません）");
  expect(line("競合・部分失敗")).toHaveTextContent("サーバーが第2版と照合します。");
  press("入力に戻る");
  set("1日の時間数", "7");
  press("保存内容を確認する");
  expect(line("変更内容")).toHaveTextContent("1日の時間数：8時間 → 7時間");
  expect(line("作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  expect(line("競合・部分失敗")).toHaveTextContent("サーバーが第0版と照合します。");
  await act(async () => { press("この内容で保存する"); });
  expect(sent).toEqual([{ expected_revision: 0, payload: { ...stored, hours: 7 }, idempotency_key: "key-1" }]);
});

test("a task started from another control opens on the record it names, with focus on that step", () => {
  mount({ send: async () => ({ revision: 1 }), extra: { initialTarget: "new", focusOnMount: true } });
  expect(screen.getByLabelText("編集する対象")).toHaveValue("new");
  expect(screen.getByText("新しい記録")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 4, name: "2. 規則の内容を入力する" })).toHaveFocus();
});

test("a record named at the start is opened as registered; focus is moved only when asked", () => {
  mount({ send: async () => ({ revision: 1 }), extra: { initialTarget: "r1" } });
  expect(screen.getByLabelText("編集する対象")).toHaveValue("r1");
  expect(screen.getByText("登録済みの記録")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 4, name: "2. 規則の内容を入力する" })).not.toHaveFocus();
});

test("what a save is bound to is read before the confirmation, shown in it, and saved with it; a failed read confirms nothing", async () => {
  let fail = true;
  const { sent } = mount({
    send: async () => ({ revision: 3 }),
    prepare: async (rule) => { if (fail) throw new PlanningError(404, JSON.stringify({ detail: "見つかりません。" })); return { ...rule, note: "サーバーの答え" }; },
    extra: { confirmation: (rule) => <p>結び付ける内容：{rule.note}</p>, saved: (result) => <>第{result.revision}版です。<a href="/workspace/plan/input">次へ</a></> },
  });
  set("編集する対象", "r1");
  set("1日の時間数", "7");
  await act(async () => { press("保存内容を確認する"); });
  expect(surface()).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("404見つかりません見つかりません。");
  expect(screen.getByLabelText("1日の時間数")).toHaveValue(7);
  fail = false;
  await act(async () => { press("保存内容を確認する"); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(surface()).toHaveTextContent("結び付ける内容：サーバーの答え");
  expect(line("変更内容")).toHaveTextContent("備考：（なし） → サーバーの答え");
  await act(async () => { press("この内容で保存する"); });
  expect(sent[0].payload).toEqual({ ...stored, hours: 7, note: "サーバーの答え" });
  // What is said after a save may hold a link.
  expect(screen.getByRole("status")).toHaveTextContent("第3版です。次へ");
  expect(screen.getByRole("link", { name: "次へ" })).toHaveAttribute("href", "/workspace/plan/input");
});
