import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import IdealWorkspace from "@/components/ideal/IdealWorkspace";
import SyntheticWorkspaceProvider from "@/ideal/providers/SyntheticWorkspaceProvider";

const meta = {
  title: "理想UI v2/全画面ショーケース",
  component: IdealWorkspace,
  parameters: { layout: "fullscreen" },
  // Stories always use the synthetic provider: no sign-in, API or database.
  decorators: [(Story) => <SyntheticWorkspaceProvider><Story /></SyntheticWorkspaceProvider>],
} satisfies Meta<typeof IdealWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LeaderHome: Story = { name: "責任者・今日", args: { initialScreen: "home", initialRole: "LEADER", showLabControls: true } };
export const PharmacistHome: Story = { name: "薬剤師・今日", args: { initialScreen: "home", initialRole: "PHARMACIST", showLabControls: true } };
export const MonthlySchedule: Story = { name: "月間勤務表", args: { initialScreen: "schedule", initialRole: "LEADER", showLabControls: true } };
export const PlanStudio: Story = { name: "計画スタジオ", args: { initialScreen: "plan", initialRole: "LEADER", showLabControls: true } };
export const DailyOperations: Story = { name: "当日運用", args: { initialScreen: "operations", initialRole: "LEADER", showLabControls: true } };
export const LeaveAndSwap: Story = { name: "休暇・交換", args: { initialScreen: "requests", initialRole: "PHARMACIST", showLabControls: true } };
export const PeopleLifecycle: Story = { name: "職員ライフサイクル", args: { initialScreen: "people", initialRole: "ADMIN", showLabControls: true } };
export const Governance: Story = { name: "ガバナンス", args: { initialScreen: "governance", initialRole: "ADMIN", showLabControls: true } };
export const Settings: Story = { name: "設定", args: { initialScreen: "settings", initialRole: "ADMIN", showLabControls: true } };
export const Failure: Story = { name: "通信後の結果不明", args: { initialScreen: "operations", initialRole: "LEADER", initialState: "failure", showLabControls: true } };
export const Conflict: Story = { name: "版競合 409", args: { initialScreen: "plan", initialRole: "LEADER", initialState: "conflict", showLabControls: true } };
export const Forbidden: Story = { name: "権限拒否 403", args: { initialScreen: "governance", initialRole: "PHARMACIST", initialState: "forbidden", showLabControls: true } };
export const Empty: Story = { name: "空状態", args: { initialScreen: "requests", initialRole: "PHARMACIST", initialState: "empty", showLabControls: true } };
export const Loading: Story = { name: "読込状態", args: { initialScreen: "home", initialRole: "LEADER", initialState: "loading", showLabControls: true } };
