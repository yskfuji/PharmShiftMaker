import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import ThreeWayTable from "@/features/workspace/shared/ThreeWayTable";
import { inPartsFrame } from "./partsFrame";

const meta = {
  title: "Ideal UI v3/Parts/ThreeWayTable",
  component: ThreeWayTable,
  decorators: [inPartsFrame],
} satisfies Meta<typeof ThreeWayTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Differences: Story = {
  name: "01 差分のある行が先",
  args: { rows: [
    { label: "業務", base: "調剤", current: "調剤", proposed: "調剤" },
    { label: "必須の配置人数", base: "1名", current: "1名", proposed: "2名" },
    { label: "希望する配置人数", base: "2名", current: "3名", proposed: "2名" },
    { label: "原本確認の資料", base: "合成配置表 A", current: "合成配置表 A", proposed: "合成配置表 B" },
  ] },
};
export const Gone: Story = {
  name: "02 現在の記録なし",
  args: { rows: [{ label: "業務", base: "調剤", current: "（なし）", proposed: "調剤" }, { label: "必須の配置人数", base: "1名", current: "（なし）", proposed: "2名" }] },
};
