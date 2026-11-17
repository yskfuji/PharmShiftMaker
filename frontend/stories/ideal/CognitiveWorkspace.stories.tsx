import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import CognitiveWorkspaceShowcase from "@/features/workspace/showcase/CognitiveWorkspaceShowcase";
import { workspaceV3Routes } from "./workspaceV3Routes";

const meta = {
  title: "Ideal UI v3/Cognitive Workspace",
  component: CognitiveWorkspaceShowcase,
  parameters: { layout: "fullscreen", fetchRoutes: workspaceV3Routes },
  argTypes: {
    screen: { control: "select", options: ["home", "schedule", "plan", "operations", "requests", "people", "governance", "settings"] },
    role: { control: "select", options: ["ADMIN", "LEADER", "PHARMACIST"] },
    state: { control: "select", options: ["ready", "empty", "loading", "failure", "conflict", "forbidden"] },
  },
} satisfies Meta<typeof CognitiveWorkspaceShowcase>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Today: Story = { name: "01 今日・責任者", args: { screen: "home", role: "LEADER" } };
export const Schedule: Story = { name: "02 勤務表", args: { screen: "schedule", role: "LEADER" } };
export const PlanInput: Story = { name: "03 計画・前提", args: { screen: "plan", view: "input", role: "LEADER" } };
export const PlanGenerate: Story = { name: "04 計画・生成", args: { screen: "plan", view: "generate", role: "LEADER" } };
export const PlanCompare: Story = { name: "05 計画・比較", args: { screen: "plan", view: "compare", role: "LEADER" } };
export const PlanDrafts: Story = { name: "06 計画・確認編集", args: { screen: "plan", view: "drafts", role: "LEADER" } };
export const PlanPublications: Story = { name: "07 計画・公開版", args: { screen: "plan", view: "publications", role: "LEADER" } };
export const OperationsToday: Story = { name: "08 当日運用・今日", args: { screen: "operations", view: "today", role: "LEADER" } };
export const OperationsCases: Story = { name: "09 当日運用・ケース", args: { screen: "operations", view: "cases", role: "LEADER" } };
export const RequestsMine: Story = { name: "10 申請・自分", args: { screen: "requests", view: "mine", role: "PHARMACIST" } };
export const RequestsLeave: Story = { name: "11 申請・休暇", args: { screen: "requests", view: "leave", role: "PHARMACIST" } };
export const RequestsSwap: Story = { name: "12 申請・交換", args: { screen: "requests", view: "swap", role: "PHARMACIST" } };
export const RequestsOutside: Story = { name: "13 申請・兼業", args: { screen: "requests", view: "outside", role: "PHARMACIST" } };
export const PeopleDirectory: Story = { name: "14 職員・一覧", args: { screen: "people", view: "directory", role: "ADMIN" } };
export const PeopleMemberships: Story = { name: "15 職員・本人アカウント", args: { screen: "people", view: "memberships", role: "ADMIN" } };
export const PeopleLifecycle: Story = { name: "16 職員・入退職", args: { screen: "people", view: "lifecycle", role: "ADMIN" } };
export const PeopleContracts: Story = { name: "17 職員・契約資格", args: { screen: "people", view: "contracts", role: "ADMIN" } };
export const GovernanceAudit: Story = { name: "18 ガバナンス・監査", args: { screen: "governance", view: "audit", role: "ADMIN" } };
export const GovernanceActuals: Story = { name: "19 ガバナンス・実績", args: { screen: "governance", view: "actuals", role: "ADMIN" } };
export const GovernancePrivacy: Story = { name: "20 ガバナンス・個人情報", args: { screen: "governance", view: "privacy", role: "ADMIN" } };
export const GovernanceRecovery: Story = { name: "21 ガバナンス・復旧", args: { screen: "governance", view: "recovery", role: "ADMIN" } };
export const SettingsAppearance: Story = { name: "22 設定・外観", args: { screen: "settings", view: "appearance", role: "ADMIN" } };
export const SettingsNotifications: Story = { name: "23 設定・通知", args: { screen: "settings", view: "notifications", role: "ADMIN" } };
export const SettingsAbsenceConsent: Story = { name: "24 設定・欠勤同意", args: { screen: "settings", view: "absence-consent", role: "ADMIN" } };
export const SettingsFlextime: Story = { name: "25 設定・フレックス", args: { screen: "settings", view: "flextime", role: "ADMIN" } };
export const TodayPharmacist: Story = { name: "26 今日・薬剤師", args: { screen: "home", role: "PHARMACIST" } };
export const Empty: Story = { name: "27 空状態", args: { screen: "requests", view: "mine", role: "PHARMACIST", state: "empty" } };
export const Loading: Story = { name: "28 読込状態", args: { screen: "home", role: "LEADER", state: "loading" } };
export const Failure: Story = { name: "29 結果不明", args: { screen: "operations", view: "cases", role: "LEADER", state: "failure" } };
export const Conflict: Story = { name: "30 版競合", args: { screen: "plan", view: "drafts", role: "LEADER", state: "conflict" } };
export const Forbidden: Story = { name: "31 権限拒否", args: { screen: "people", view: "directory", role: "PHARMACIST", state: "forbidden" } };
