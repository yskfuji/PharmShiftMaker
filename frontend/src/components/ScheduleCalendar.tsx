"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import useHolidayRequests from "@/hooks/useHolidayRequests";
import {
  CalendarMonthData,
  DayAssignments,
  HolidayRequestKind,
  HolidayRequestRecord,
  ManualAssignmentMap,
  ScheduleAssignment,
  ScheduleWarning,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import DayCell from "./DayCell";
import ShiftDetailDrawer from "./ShiftDetailDrawer";
import { Button } from "@/components/ui/Button";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

interface ScheduleCalendarProps {
  data: CalendarMonthData;
  manualOverrides?: ManualAssignmentMap;
  onManualSaveAssignments?: (isoDate: string, assignments: ScheduleAssignment[]) => Promise<void> | void;
  onManualResetAssignments?: (isoDate: string) => Promise<void> | void;
  warnings?: ScheduleWarning[];
  availablePeople?: string[];
}

function buildCalendarSlots(
  data: CalendarMonthData,
  days: DayAssignments[],
): Array<DayAssignments | null> {
  const slots: Array<DayAssignments | null> = [];
  const firstWeekday = new Date(Date.UTC(data.year, data.month - 1, 1)).getDay();
  for (let i = 0; i < firstWeekday; i += 1) {
    slots.push(null);
  }
  slots.push(...days);
  return slots;
}

function chunkWeeks(slots: Array<DayAssignments | null>): Array<Array<DayAssignments | null>> {
  const weeks: Array<Array<DayAssignments | null>> = [];
  for (let i = 0; i < slots.length; i += 7) {
    weeks.push(slots.slice(i, i + 7));
  }
  return weeks;
}

const severityPriority: Record<ScheduleWarning["severity"], number> = {
  info: 1,
  warning: 2,
  critical: 3,
};

function enumerateRange(startIso: string, endIso: string): string[] {
  const result: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return result;
  }
  if (start.getTime() > end.getTime()) {
    return result;
  }
  const step = 24 * 60 * 60 * 1000;
  for (let ts = start.getTime(); ts <= end.getTime(); ts += step) {
    result.push(new Date(ts).toISOString().slice(0, 10));
  }
  return result;
}

function buildWarningMap(warnings?: ScheduleWarning[]): Map<string, ScheduleWarning[]> {
  const map = new Map<string, ScheduleWarning[]>();
  if (!warnings) {
    return map;
  }
  for (const warning of warnings) {
    const context = warning.context ?? {};
    const dateValue = typeof context.date === "string" ? context.date : null;
    const startValue = typeof context.start_date === "string" ? context.start_date : null;
    const endValue = typeof context.end_date === "string" ? context.end_date : null;
    const targetDates: string[] = [];
    if (dateValue) {
      targetDates.push(dateValue);
    } else if (startValue && endValue) {
      targetDates.push(...enumerateRange(startValue, endValue));
    }
    if (targetDates.length === 0) {
      continue;
    }
    for (const iso of targetDates) {
      const existing = map.get(iso) ?? [];
      map.set(iso, [...existing, warning]);
    }
  }
  return map;
}

function pickWorstSeverity(entries: ScheduleWarning[] | undefined): ScheduleWarning["severity"] | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }
  return entries.reduce((current, warning) => {
    if (!current) {
      return warning.severity;
    }
    return severityPriority[warning.severity] > severityPriority[current] ? warning.severity : current;
  }, undefined as ScheduleWarning["severity"] | undefined);
}

export default function ScheduleCalendar({
  data,
  manualOverrides,
  onManualSaveAssignments,
  onManualResetAssignments,
  warnings,
  availablePeople,
}: ScheduleCalendarProps) {
  // The open day is kept by date and read from the current data, so the dialog shows
  // saved adjustments at once (a copy taken on opening would stay stale).
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const closeDay = useCallback(() => setSelectedIso(null), []);
  const mergedDays = useMemo(() => {
    return data.days.map((day) => {
      const override = manualOverrides?.[day.isoDate];
      if (!override) {
        return day;
      }
      return {
        ...day,
        assignments: override,
      };
    });
  }, [data.days, manualOverrides]);
  const selectedDay = useMemo<DayAssignments | null>(
    () => (selectedIso ? mergedDays.find((day) => day.isoDate === selectedIso) ?? null : null),
    [mergedDays, selectedIso],
  );
  const baselineAssignmentsMap = useMemo(() => {
    const map = new Map<string, ScheduleAssignment[]>();
    for (const day of data.days) {
      map.set(day.isoDate, day.assignments);
    }
    return map;
  }, [data.days]);
  const slots = useMemo(() => buildCalendarSlots(data, mergedDays), [data, mergedDays]);
  const weeks = useMemo(() => chunkWeeks(slots), [slots]);
  const [visibleWeek, setVisibleWeek] = useState<"all" | number>("all");
  useEffect(() => {
    setVisibleWeek("all");
  }, [data.year, data.month]);
  useEffect(() => {
    if (visibleWeek !== "all" && visibleWeek >= weeks.length) {
      setVisibleWeek("all");
    }
  }, [visibleWeek, weeks.length]);
  const displayedWeeks = useMemo(() => {
    if (visibleWeek === "all") {
      return weeks;
    }
    return weeks.slice(visibleWeek, visibleWeek + 1);
  }, [visibleWeek, weeks]);
  const editedDaySet = useMemo(() => new Set(Object.keys(manualOverrides ?? {})), [manualOverrides]);
  const warningMap = useMemo(() => buildWarningMap(warnings), [warnings]);
  const {
    requests,
    loading: requestLoading,
    error: requestError,
    upsert,
    remove,
  } = useHolidayRequests(data.year, data.month);
  const requestMap = useMemo(() => {
    const map = new Map<string, HolidayRequestRecord>();
    for (const request of requests) {
      map.set(request.date, request);
    }
    return map;
  }, [requests]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const selectedRequest = selectedDay ? requestMap.get(selectedDay.isoDate) ?? null : null;
  const selectedBaselineAssignments = selectedDay ? baselineAssignmentsMap.get(selectedDay.isoDate) ?? [] : [];
  const selectedWarnings = selectedDay ? warningMap.get(selectedDay.isoDate) ?? [] : [];
  const handleManualSave = async (assignments: ScheduleAssignment[]) => {
    if (!selectedDay || !onManualSaveAssignments) {
      return;
    }
    await onManualSaveAssignments(selectedDay.isoDate, assignments);
  };
  const handleManualReset = async () => {
    if (!selectedDay || !onManualResetAssignments) {
      return;
    }
    await onManualResetAssignments(selectedDay.isoDate);
  };

  const handleSaveHolidayRequest = async (kind: HolidayRequestKind) => {
    if (!selectedDay) {
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await upsert(selectedDay.isoDate, kind);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "希望休の登録に失敗しました");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteHolidayRequest = async () => {
    if (!selectedDay) {
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      await remove(selectedDay.isoDate);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "希望休の削除に失敗しました");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-fg">
            {data.year}年 {data.month}月 シフト
          </h2>
          <p className="text-sm text-fg-muted mt-1">セルをクリックすると詳細が表示されます。</p>
        </div>
        <div className="space-y-2 text-right">
          <div>
            {requestError && <p className="text-sm text-danger">{requestError}</p>}
            {!requestError && requestLoading && (
              <p className="text-sm text-fg-muted animate-pulse">希望休の状態を取得しています...</p>
            )}
          </div>
          <div className="flex flex-col gap-2 text-left">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-fg-muted">
              表示範囲
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={visibleWeek === "all" ? "default" : "outline"}
                aria-pressed={visibleWeek === "all"}
                onClick={() => setVisibleWeek("all")}
              >
                全期間
              </Button>
              {weeks.map((_, weekIndex) => (
                <Button
                  key={`week-toggle-${weekIndex}`}
                  type="button"
                  size="sm"
                  variant={visibleWeek === weekIndex ? "default" : "outline"}
                  aria-pressed={visibleWeek === weekIndex}
                  onClick={() => setVisibleWeek(weekIndex)}
                >
                  第{weekIndex + 1}週
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface overflow-x-auto">
        <div className="grid min-w-[40rem] grid-cols-7 border-b border-line bg-canvas/50 md:min-w-0">
          {WEEKDAY_LABELS.map((label, i) => (
            <div 
              key={label} 
              className={cn(
                "py-3 text-center text-sm font-medium text-fg-muted",
                i === 0 && "text-sunday", // Sunday
                i === 6 && "text-saturday" // Saturday
              )}
            >
              {label}
            </div>
          ))}
        </div>

        <div className="space-y-px">
          {displayedWeeks.map((week, weekIndex) => (
            <div key={`week-row-${weekIndex}-${visibleWeek}`} className="grid min-w-[40rem] grid-cols-7 bg-line gap-px md:min-w-0">
              {week.map((day, index) =>
                day ? (
                  <DayCell
                    key={day.isoDate}
                    isoDate={day.isoDate}
                    dayNumber={day.dayNumber}
                    assignments={day.assignments}
                    isSelected={selectedDay?.isoDate === day.isoDate}
                    requestKind={requestMap.get(day.isoDate)?.kind}
                    isManuallyEdited={editedDaySet.has(day.isoDate)}
                    warningSeverity={pickWorstSeverity(warningMap.get(day.isoDate))}
                    onSelect={() => setSelectedIso(day.isoDate)}
                  />
                ) : (
                  <div key={`blank-${weekIndex}-${index}`} className="bg-canvas min-h-[120px]" />
                ),
              )}
            </div>
          ))}
        </div>
      </div>

      <ShiftDetailDrawer
        day={selectedDay}
        onClose={closeDay}
        holidayRequest={selectedRequest}
        onSaveHolidayRequest={handleSaveHolidayRequest}
        onDeleteHolidayRequest={handleDeleteHolidayRequest}
        requestError={actionError}
        isRequestLoading={actionLoading}
        manualAssignments={selectedDay?.assignments ?? []}
        baselineAssignments={selectedBaselineAssignments}
        onSaveManualAssignments={onManualSaveAssignments ? handleManualSave : undefined}
        onResetManualAssignments={onManualResetAssignments ? handleManualReset : undefined}
        isManuallyEdited={selectedDay ? editedDaySet.has(selectedDay.isoDate) : false}
        availablePeople={availablePeople}
        dayWarnings={selectedWarnings}
      />
    </div>
  );
}
