import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import ConfirmSurface from "@/features/workspace/shared/ConfirmSurface";
import { changedFacts, threeWayRows, type Fact } from "@/features/workspace/shared/records/facts";
import { inPartsFrame } from "./partsFrame";

// Fictitious record lines. No real person, facility or document.
const facts = (minimum: number, target: number, reference: string, status = "未確認"): Fact[] => [
  { label: "業務", text: "調剤" }, { label: "場所", text: "薬剤部" },
  { label: "必須の配置人数", text: `${minimum}名` }, { label: "希望する配置人数", text: `${target}名` },
  { label: "適用開始", text: "2026-10-05 09:00" }, { label: "適用終了", text: "2026-10-05 17:00" },
  { label: "原本確認の資料", text: reference, verbatim: true }, { label: "原本確認の状態", text: status },
];
const base = facts(1, 2, "合成配置表 A");
const proposed = facts(2, 2, "合成配置表 B", "確認済み");
const unknown = { kind: "unknown" as const, code: "503", title: "結果を確認できません", body: "応答を受け取れませんでした。操作が反映されたかは不明です。同じ操作を繰り返す前に、最新の内容を取得して確認してください。", action: "最新の内容を取得" };
const refused = { kind: "validation" as const, code: "422", title: "サーバーの検証で止まりました", body: "Target cannot be lower than required minimum", action: "内容を見直す" };

const meta = {
  title: "Ideal UI v3/Parts/ConfirmSurface",
  component: ConfirmSurface,
  decorators: [inPartsFrame],
  args: {
    title: "保存前の確認",
    changes: changedFacts(base, proposed),
    version: { from: 3, to: 4 },
    notified: "誰にも通知されません。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。",
    risk: "保存前の時点では検出されていません。保存時にサーバーが第3版と照合します。1件の記録だけを保存するため、一部だけが保存されることはありません。",
    outcome: { kind: "idle" },
    busy: false,
    confirmLabel: "この内容で保存する",
    onConfirm: () => undefined,
    onBack: () => undefined,
    onReviewed: () => undefined,
  },
} satisfies Meta<typeof ConfirmSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Update: Story = { name: "01 更新（第3版 → 第4版）" };
export const Create: Story = { name: "02 新規登録", args: { changes: changedFacts(null, proposed), version: { from: 0, to: 1 } } };
export const Unchanged: Story = { name: "03 差分なし", args: { changes: [], version: { from: 3, to: 3 } } };
export const Sending: Story = { name: "04 送信中", args: { busy: true } };
export const Conflict: Story = { name: "05 競合（三者比較）", args: { outcome: { kind: "conflict", rows: threeWayRows(base, facts(1, 3, "合成配置表 A"), proposed), currentRevision: 4 } } };
export const UnknownOutcome: Story = { name: "06 結果不明（同じ内容を再送）", args: { outcome: { kind: "unknown", problem: unknown } } };
export const Refused: Story = { name: "07 サーバーが拒否", args: { outcome: { kind: "refused", problem: refused, fields: [{ field: "input_hash", message: "String should match pattern '^[a-f0-9]{64}$'" }] } } };
export const Irreversible: Story = { name: "08 取り消せない操作（確定のボタンは危険色）", args: { title: "終了前の確認", confirmTone: "danger", confirmLabel: "理由を記録して終了する", backLabel: "終了せずに戻る", changes: [{ label: "採用の期間", before: "2027-01-01 〜 2028-03-31", after: "2027-01-01 〜 2027-06-30" }], version: { from: 2, to: 3 } } };
export const HeldBack: Story = { name: "09 確定できない理由を言う（所有者が止めている間）", args: { confirmDisabled: true, confirmDisabledReason: "対象の日時を読み取れないため、確定できません。一覧を読み直してから、もう一度確認してください。" } };
