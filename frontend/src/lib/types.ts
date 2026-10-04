export type ShiftCategory =
  | "DAY_SHIFT"
  | "EVENING_SHIFT"
  | "NIGHT_DUTY"
  | "ON_CALL"
  | "WARD"
  | "OFF"
  | string;

export interface PersonSummary {
  personId: string;
  displayName: string;
  role: string;
}

export interface ScheduleAssignment {
  personId: string;
  assignmentDate: string; // ISO date string (yyyy-mm-dd)
  shiftId: string;
}

export interface ScheduleGenerateParams {
  year: number;
  month: number;
  trialMode?: boolean;
  expectedVersion?: number;
  manualAssignments?: ScheduleAssignment[];
}

export interface ScheduleGenerateResponse {
  year: number;
  month: number;
  trialMode: boolean;
  generatedAt: string;
  totalAssignments: number;
  assignments: ScheduleAssignment[];
  warnings: ScheduleWarning[];
  lockVersion: number | null;
}

export interface DayAssignments {
  isoDate: string;
  dayNumber: number;
  assignments: ScheduleAssignment[];
}

export interface CalendarMonthData {
  year: number;
  month: number; // 1-12
  days: DayAssignments[];
}

export interface ScheduleWarning {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  context: Record<string, unknown>;
}

export type HolidayRequestKind =
  | "PUBLIC_HOLIDAY_REQUEST"
  | "PAID_LEAVE_REQUEST"
  | "SUMMER_LEAVE_REQUEST"
  | "REFRESH_LEAVE_REQUEST";

export type LeaveQuotaKind = Exclude<HolidayRequestKind, "PUBLIC_HOLIDAY_REQUEST">;

export interface LeaveQuotaRecord {
  personId: string;
  personName: string | null;
  year: number;
  month: number;
  kind: LeaveQuotaKind;
  totalDays: number;
  usedDays: number;
  usedBeforeMonth: number;
  remainingDays: number;
}

export interface HolidayRequestRecord {
  personId: string;
  date: string; // ISO yyyy-mm-dd
  kind: HolidayRequestKind;
  order: number;
  isApproved: boolean;
}

export type ManualAssignmentMap = Record<string, ScheduleAssignment[]>;
