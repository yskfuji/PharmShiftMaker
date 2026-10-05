import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import ConfirmSurface from "../ConfirmSurface";
import { changedFacts, threeWayRows, type Fact } from "../records/facts";

const facts = (minimum: string, target: string, reference: string): Fact[] => [
  { label: "業務", text: "調剤" }, { label: "必須の配置人数", text: minimum }, { label: "希望する配置人数", text: target }, { label: "原本確認の資料", text: reference },
];
const base = facts("1名", "2名", "配置表A");
const proposed = facts("2名", "2名", "配置表B");

function surface(over: Partial<ComponentProps<typeof ConfirmSurface>> = {}) {
  const handlers = { onConfirm: jest.fn(), onBack: jest.fn(), onReviewed: jest.fn() };
  render(<ConfirmSurface title="保存前の確認" changes={changedFacts(base, proposed)} version={{ from: 3, to: 4 }} notified="誰にも通知されません。" risk="保存時にサーバーが第3版と照合します。"
    outcome={{ kind: "idle" }} busy={false} confirmLabel="この内容で保存する" {...handlers} {...over} />);
  const section = screen.getByRole("region", { name: over.title ?? "保存前の確認" });
  const row = (term: string) => within(section).getByText(term, { selector: "dt" }).parentElement!;
  return { ...handlers, section, row };
}

test("it always says what changes, which version is created, who is notified and what is known of conflicts", () => {
  const { section, row, onConfirm, onBack } = surface();
  expect(section).toHaveClass("ideal-confirm");
  expect(within(section).getAllByRole("term").map((term) => term.textContent)).toEqual(["変更内容", "作成される版", "通知", "競合・部分失敗"]);
  expect(within(row("変更内容")).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["必須の配置人数：1名 → 2名", "原本確認の資料：配置表A → 配置表B"]);
  expect(row("作成される版")).toHaveTextContent("第3版 → 第4版");
  expect(row("通知")).toHaveTextContent("誰にも通知されません。");
  expect(row("競合・部分失敗")).toHaveTextContent("保存時にサーバーが第3版と照合します。");
  // Focus moves to the surface when it opens.
  expect(screen.getByRole("heading", { level: 3, name: "保存前の確認" })).toHaveFocus();
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "この内容で保存する" }));
  fireEvent.click(screen.getByRole("button", { name: "入力に戻る" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onBack).toHaveBeenCalledTimes(1);
});

test("a new record and an unchanged one say which version results", () => {
  const created = surface({ title: "新規の確認", level: 4, changes: changedFacts(null, proposed), version: { from: 0, to: 1 } });
  expect(screen.getByRole("heading", { level: 4, name: "新規の確認" })).toBeInTheDocument();
  expect(created.row("作成される版")).toHaveTextContent("新規登録（第1版を作成）");
  expect(within(created.row("変更内容")).getAllByRole("listitem")[0]).toHaveTextContent("業務：（なし） → 調剤");
  const same = surface({ title: "同じ内容", changes: changedFacts(base, base), version: { from: 3, to: 3 } });
  expect(same.row("変更内容")).toHaveTextContent("現在の版との差分はありません。");
  expect(same.row("作成される版")).toHaveTextContent("第3版のまま（内容が同じため、新しい版は作られません）");
});

test("after a conflict it stays open with the three contents; saving waits for the review", () => {
  const current = facts("1名", "3名", "配置表A");
  const { row, onConfirm, onReviewed } = surface({ outcome: { kind: "conflict", rows: threeWayRows(base, current, proposed), currentRevision: 5 } });
  expect(row("競合・部分失敗")).toHaveTextContent("競合があります。保存していません。");
  expect(screen.getByRole("alert")).toHaveTextContent("409別の更新と競合しました現在の版は第5版です。編集中の内容は保持しています。自動では統合しません。");
  const rows = within(screen.getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row");
  expect(rows.map((item) => item.textContent)).toEqual([
    "項目編集開始時現在編集中差分",
    // Lines whose three values differ come first.
    "必須の配置人数1名1名2名あり", "希望する配置人数2名3名2名あり", "原本確認の資料配置表A配置表A配置表Bあり", "業務調剤調剤調剤なし",
  ]);
  expect(screen.getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "この内容で保存する" }));
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "三つの内容を確認し、現在の版に対して確認し直す" }));
  expect(onReviewed).toHaveBeenCalledTimes(1);
});

test("a record that is gone is said so in the conflict", () => {
  surface({ outcome: { kind: "conflict", rows: threeWayRows(base, null, proposed), currentRevision: null } });
  expect(screen.getByRole("alert")).toHaveTextContent("現在、この記録はサーバーにありません。");
  expect(within(screen.getByRole("region", { name: "三つの内容の比較" })).getAllByRole("row")[1]).toHaveTextContent("業務調剤（なし）調剤あり");
});

test("after an unknown outcome the same content can be sent again", () => {
  const problem = { kind: "unknown" as const, code: "503", title: "結果を確認できません", body: "応答を受け取れませんでした。", action: "最新の内容を取得" };
  const { row, onConfirm } = surface({ outcome: { kind: "unknown", problem } });
  expect(row("競合・部分失敗")).toHaveTextContent("結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます（同じ受付キーで送るため、二重には保存されません）。");
  expect(screen.getByRole("alert")).toHaveTextContent("503結果を確認できません");
  expect(screen.queryByRole("button", { name: "この内容で保存する" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "同じ内容を再送する" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test("a refusal shows the server's message and the fields it names; while sending nothing can be pressed", () => {
  const problem = { kind: "validation" as const, code: "422", title: "サーバーの検証で止まりました", body: "Target cannot be lower than required minimum", action: "内容を見直す" };
  const { row } = surface({ busy: true, outcome: { kind: "refused", problem, fields: [{ field: "input_hash", message: "String should match pattern" }, { field: "", message: "もう一つ" }] } });
  expect(row("競合・部分失敗")).toHaveTextContent("保存していません。サーバーが下の理由で受け付けませんでした。");
  expect(screen.getByRole("alert")).toHaveTextContent("422サーバーの検証で止まりましたTarget cannot be lower than required minimum");
  expect(screen.getByText("input_hash：String should match pattern")).toBeInTheDocument();
  expect(screen.getByText("もう一つ")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "入力に戻る" })).toBeDisabled();
});

test("what is created can be said in the owner's words when it is not a version of one record", () => {
  const { row } = surface({ versionText: "記録の版は作られません。照合結果は受付の記録として残ります。" });
  expect(row("作成される版")).toHaveTextContent("記録の版は作られません。照合結果は受付の記録として残ります。");
  expect(row("作成される版")).not.toHaveTextContent("第3版");
});

test("while the owner's consent is missing nothing can be sent, a resend included", () => {
  const problem = { kind: "unknown" as const, code: "503", title: "結果を確認できません", body: "応答を受け取れませんでした。", action: "最新の内容を取得" };
  const waiting = surface({ title: "同意待ち", confirmDisabled: true });
  expect(within(waiting.section).getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
  expect(within(waiting.section).getByRole("button", { name: "入力に戻る" })).toBeEnabled();
  const resend = surface({ title: "同意待ちの再送", confirmDisabled: true, outcome: { kind: "unknown", problem } });
  fireEvent.click(within(resend.section).getByRole("button", { name: "同じ内容を再送する" }));
  expect(resend.onConfirm).not.toHaveBeenCalled();
  const agreed = surface({ title: "同意済み", confirmDisabled: false });
  fireEvent.click(within(agreed.section).getByRole("button", { name: "この内容で保存する" }));
  expect(agreed.onConfirm).toHaveBeenCalledTimes(1);
});
