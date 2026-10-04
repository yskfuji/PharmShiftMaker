import type { IdealRole } from "./types";

type DisplayChangeCase = { caseId: string; kind: "ABSENCE" | "SWAP"; status: string; version: number; summary: string; affectedDate: string; requestedBy: string };
type DisplayLifecycleCase = { caseId: string; kind: "ONBOARD" | "OFFBOARD"; status: string; personName: string; effectiveDate: string; completedTasks: number; totalTasks: number };

export const roleLabels: Record<IdealRole, string> = {
  ADMIN: "システム管理者",
  LEADER: "薬剤部責任者",
  PHARMACIST: "薬剤師",
};

export const staff = [
  { id: "p-001", name: "佐藤 美咲", badge: "責任者", shifts: ["日", "日", "休", "遅", "日", "休", "休"] },
  { id: "p-002", name: "鈴木 悠斗", badge: "抗菌化学療法", shifts: ["早", "日", "日", "日", "休", "日", "休"] },
  { id: "p-003", name: "高橋 葵", badge: "がん薬物療法", shifts: ["日", "休", "日", "遅", "日", "日", "休"] },
  { id: "p-004", name: "田中 蓮", badge: "病棟", shifts: ["休", "日", "早", "日", "日", "休", "日"] },
  { id: "p-005", name: "伊藤 凛", badge: "新人支援", shifts: ["日", "日", "日", "休", "早", "休", "日"] },
];

export const days = ["10/12 月", "13 火", "14 水", "15 木", "16 金", "17 土", "18 日"];

export const changeCases: DisplayChangeCase[] = [
  { caseId: "CHG-1048", kind: "ABSENCE", status: "READY", version: 3, summary: "高橋 葵・10月14日 欠勤", affectedDate: "2026-10-14", requestedBy: "高橋 葵" },
  { caseId: "CHG-1047", kind: "SWAP", status: "AWAITING_CONSENT", version: 2, summary: "鈴木 悠斗 ⇄ 田中 蓮", affectedDate: "2026-10-17", requestedBy: "鈴木 悠斗" },
  { caseId: "CHG-1046", kind: "SWAP", status: "APPROVED", version: 4, summary: "佐藤 美咲 ⇄ 伊藤 凛", affectedDate: "2026-10-11", requestedBy: "佐藤 美咲" },
];

export const lifecycleCases: DisplayLifecycleCase[] = [
  { caseId: "LFC-208", kind: "ONBOARD", status: "IN_PROGRESS", personName: "山本 結衣", effectiveDate: "2026-11-01", completedTasks: 4, totalTasks: 7 },
  { caseId: "LFC-207", kind: "OFFBOARD", status: "READY", personName: "小林 陽介", effectiveDate: "2026-10-31", completedTasks: 5, totalTasks: 5 },
  { caseId: "LFC-206", kind: "ONBOARD", status: "COMPLETED", personName: "中村 澪", effectiveDate: "2026-10-01", completedTasks: 7, totalTasks: 7 },
];

export const navByRole: Record<IdealRole, string[]> = {
  ADMIN: ["home", "schedule", "plan", "operations", "requests", "people", "governance", "settings"],
  LEADER: ["home", "schedule", "plan", "operations", "requests", "people"],
  PHARMACIST: ["home", "schedule", "requests"],
};
