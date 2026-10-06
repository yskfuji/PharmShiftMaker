import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import JstDateTimeField from "@/features/workspace/shared/JstDateTimeField";
import { inPartsFrame } from "./partsFrame";

function Owner({ initial, required }: { initial: string; required?: boolean }) {
  const [value, setValue] = useState(initial);
  return <form className="ideal-form" onSubmit={(event) => event.preventDefault()}>
    <JstDateTimeField label="適用開始（日本時間）" value={value} onChange={setValue} required={required} />
    <p className="ideal-note">保存される値（UTC）：{value ? <code>{value}</code> : "未入力"}</p>
  </form>;
}

const meta = {
  title: "Ideal UI v3/Parts/JstDateTimeField",
  component: Owner,
  decorators: [inPartsFrame],
} satisfies Meta<typeof Owner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { name: "01 未入力（必須）", args: { initial: "", required: true } };
export const Filled: Story = { name: "02 入力済み", args: { initial: "2026-10-05T00:00:00.000Z" } };
