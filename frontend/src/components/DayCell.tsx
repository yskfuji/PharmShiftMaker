"use client";

import { HolidayRequestKind, ScheduleAssignment, ScheduleWarning } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatShiftLabelShort } from "@/lib/shiftLabels";

export interface DayCellProps {
  isoDate: string;
  dayNumber: number;
  assignments: ScheduleAssignment[];
  isSelected?: boolean;
  onSelect?: () => void;
  requestKind?: HolidayRequestKind;
  isManuallyEdited?: boolean;
  warningSeverity?: ScheduleWarning["severity"];
}

const REQUEST_LABELS: Record<HolidayRequestKind, string> = {
  PUBLIC_HOLIDAY_REQUEST: "公休希望",
  PAID_LEAVE_REQUEST: "有給希望",
  SUMMER_LEAVE_REQUEST: "夏季休暇",
  REFRESH_LEAVE_REQUEST: "リフレッシュ休暇",
};

const REQUEST_COLORS: Record<HolidayRequestKind, string> = {
  PUBLIC_HOLIDAY_REQUEST: "bg-leave-public",
  PAID_LEAVE_REQUEST: "bg-leave-paid",
  SUMMER_LEAVE_REQUEST: "bg-leave-summer",
  REFRESH_LEAVE_REQUEST: "bg-leave-refresh",
};

function summarizeAssignments(assignments: ScheduleAssignment[]): string[] {
  if (assignments.length === 0) {
    return ["休"];
  }
  const summaries = assignments
    .slice(0, 3)
    .map((assignment) => `${formatShiftLabelShort(assignment.shiftId)} / ${assignment.personId}`);
  if (assignments.length > 3) {
    summaries.push(`他${assignments.length - 3}件`);
  }
  return summaries;
}

export default function DayCell({
  isoDate,
  dayNumber,
  assignments,
  isSelected,
  onSelect,
  requestKind,
  isManuallyEdited,
  warningSeverity,
}: DayCellProps) {
  const weekday = new Date(isoDate).getDay();
  const isSunday = weekday === 0;
  const isSaturday = weekday === 6;

  const summaryLines = summarizeAssignments(assignments);
  const requestLabel = requestKind ? REQUEST_LABELS[requestKind] : null;
  const severityColorMap: Record<NonNullable<DayCellProps["warningSeverity"]>, string> = {
    info: "bg-primary",
    warning: "bg-warning",
    critical: "bg-danger",
  };

  return (
    <button
      type="button"
      data-testid="day-cell"
      aria-label={`${isoDate} の割り当て`}
      onClick={onSelect}
      className={"ui-button "+(cn(
        "flex min-h-32 flex-col bg-canvas px-2 py-2 text-left transition-all hover:bg-surface",
        isSelected && "bg-surface ring-1 ring-inset ring-primary z-10"
      ))}
    >
      <div className="flex items-baseline justify-between">
        <span className={cn(
          "text-sm font-bold",
          isSunday ? "text-sunday" : isSaturday ? "text-saturday" : "text-fg"
        )}>
          {dayNumber}
        </span>
        <div className="flex items-center gap-1">
          {warningSeverity && (
            <span
              className={cn("h-2 w-2 rounded-full", severityColorMap[warningSeverity])}
              title={
                warningSeverity === "critical"
                  ? "重大な警告があります"
                  : warningSeverity === "warning"
                    ? "警告があります"
                    : "注意事項があります"
              }
            />
          )}
          {isManuallyEdited && (
            <span className="h-2 w-2 rounded-full bg-warning" title="手動調整済み" />
          )}
          {requestKind && (
            <span className={cn("h-2 w-2 rounded-full", REQUEST_COLORS[requestKind])} title={`希望休: ${requestLabel}`} />
          )}
        </div>
      </div>

      <ul className="mt-2 flex flex-col gap-1 text-xs text-fg-muted">
        {summaryLines.map((line, i) => (
          <li key={i} className="break-words [overflow-wrap:anywhere]">
            {line === "休" ? (
              <span className="text-fg-muted">休日</span>
            ) : (
              line
            )}
          </li>
        ))}
      </ul>
    </button>
  );
}
