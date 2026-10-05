import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import RecordEvidenceFields from "@/features/workspace/shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE, type RecordEvidence } from "@/features/workspace/shared/records/evidence";
import { inPartsFrame } from "./partsFrame";

function Owner({ initial, name }: { initial: RecordEvidence; name?: string }) {
  const [value, setValue] = useState(initial);
  return <form className="ideal-form" onSubmit={(event) => event.preventDefault()}>
    <RecordEvidenceFields name={name} value={value} onChange={(patch) => setValue((old) => ({ ...old, ...patch }))} />
  </form>;
}

const meta = {
  title: "Ideal UI v3/Parts/RecordEvidenceFields",
  component: Owner,
  decorators: [inPartsFrame],
} satisfies Meta<typeof Owner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { name: "01 未入力", args: { initial: EMPTY_RECORD_EVIDENCE } };
export const Verified: Story = { name: "02 確認済み（確認責任者と有効期限）", args: { initial: { reference: "合成配置表 2026-10", status: "verified", verified_by: "合成の確認責任者", valid_until: "2026-12-31T15:00:00.000Z" } } };
export const Named: Story = { name: "03 別の根拠名", args: { name: "派遣の適用根拠", initial: { reference: "合成契約書", status: "rejected", verified_by: null, valid_until: null } } };
