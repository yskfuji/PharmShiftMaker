"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CalendarMonthData, ManualAssignmentMap } from "@/lib/types";
import { formatShiftLabel, formatShiftLabelShort } from "@/lib/shiftLabels";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

interface ScheduleMatrixViewProps {
  data: CalendarMonthData;
  manualOverrides?: ManualAssignmentMap;
  availablePeople?: string[];
}

export default function ScheduleMatrixView({ data, manualOverrides, availablePeople }: ScheduleMatrixViewProps) {
  const [zoom, setZoom] = useState(1);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomSurfaceRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const increaseZoom = useCallback(() => {
    setZoom((prev) => clampZoom(Math.round((prev + ZOOM_STEP) * 100) / 100));
  }, []);

  const decreaseZoom = useCallback(() => {
    setZoom((prev) => clampZoom(Math.round((prev - ZOOM_STEP) * 100) / 100));
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return undefined;
    }
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      const delta = -event.deltaY;
      if (delta === 0) {
        return;
      }
      setZoom((prev) => clampZoom(prev + delta * 0.0015));
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    const surface = zoomSurfaceRef.current;
    if (!surface) {
      return undefined;
    }

    const activePointers = new Map<number, PointerEvent>();
    let initialDistance: number | null = null;
    let baseZoom = zoomRef.current;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        return;
      }
      activePointers.set(event.pointerId, event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!activePointers.has(event.pointerId)) {
        return;
      }
      activePointers.set(event.pointerId, event);
      if (activePointers.size === 2) {
        event.preventDefault();
        const [first, second] = Array.from(activePointers.values());
        const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
        if (initialDistance == null) {
          initialDistance = distance;
          baseZoom = zoomRef.current;
          return;
        }
        if (initialDistance === 0) {
          return;
        }
        const scale = distance / initialDistance;
        const nextZoom = clampZoom(baseZoom * scale);
        setZoom(nextZoom);
      }
    };

    const resetPointers = (event: PointerEvent) => {
      if (activePointers.has(event.pointerId)) {
        activePointers.delete(event.pointerId);
      }
      if (activePointers.size < 2) {
        initialDistance = null;
        baseZoom = zoomRef.current;
      }
    };

    surface.addEventListener("pointerdown", handlePointerDown);
    surface.addEventListener("pointermove", handlePointerMove, { passive: false });
    surface.addEventListener("pointerup", resetPointers);
    surface.addEventListener("pointercancel", resetPointers);
    surface.addEventListener("pointerleave", resetPointers);

    return () => {
      surface.removeEventListener("pointerdown", handlePointerDown);
      surface.removeEventListener("pointermove", handlePointerMove);
      surface.removeEventListener("pointerup", resetPointers);
      surface.removeEventListener("pointercancel", resetPointers);
      surface.removeEventListener("pointerleave", resetPointers);
    };
  }, []);

  const mergedDays = useMemo(() => {
    return data.days.map((day) => ({
      ...day,
      assignments: manualOverrides?.[day.isoDate] ?? day.assignments,
    }));
  }, [data.days, manualOverrides]);

  const people = useMemo(() => {
    const unique = new Set<string>();
    availablePeople?.forEach((person) => unique.add(person));
    for (const day of mergedDays) {
      for (const assignment of day.assignments) {
        unique.add(assignment.personId);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b, "ja"));
  }, [availablePeople, mergedDays]);

  const weekdayInfo = useMemo(() => {
    return mergedDays.map((day) => {
      const weekday = new Date(day.isoDate).getDay();
      return {
        isoDate: day.isoDate,
        dayNumber: day.dayNumber,
        weekday,
      };
    });
  }, [mergedDays]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-fg">
            {data.year}年 {data.month}月 スタッフ別シフト
          </h2>
          <p className="text-sm text-fg-muted mt-1">縦軸=スタッフ、横軸=日付で各セルにシフト名が表示されます。</p>
        </div>

        <div className="flex items-center gap-2 rounded-md border border-line/70 bg-surface px-3 py-2 text-sm shadow-sm">
          <span className="text-fg-muted">表示倍率</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={decreaseZoom}
              disabled={zoom <= MIN_ZOOM}
              className="ui-button ui-button-secondary ui-table-action inline-flex h-8 w-8 items-center justify-center rounded-md border border-line/70 text-lg font-semibold text-fg disabled:opacity-40"
              aria-label="縮小"
            >
              −
            </button>
            <span className="w-12 text-center tabular-nums font-medium text-fg">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              onClick={increaseZoom}
              disabled={zoom >= MAX_ZOOM}
              className="ui-button ui-button-secondary ui-table-action inline-flex h-8 w-8 items-center justify-center rounded-md border border-line/70 text-lg font-semibold text-fg disabled:opacity-40"
              aria-label="拡大"
            >
              ＋
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface">
        <div ref={scrollContainerRef} className="max-h-[70vh] overflow-auto">
          <div
            ref={zoomSurfaceRef}
            className="inline-block min-w-full"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              willChange: "transform",
              touchAction: "pan-x pan-y",
            }}
          >
            <table className="ui-data-table min-w-[960px] w-full text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface px-4 py-3 text-left text-xs uppercase tracking-wider text-fg-muted">
                    スタッフ
                  </th>
                  {weekdayInfo.map((day) => (
                    <th
                      key={day.isoDate}
                      className={cn(
                        "px-3 py-3 text-center text-xs font-semibold text-fg-muted border-l border-line/60",
                        day.weekday === 0 && "text-sunday",
                        day.weekday === 6 && "text-saturday"
                      )}
                    >
                      <div>{day.dayNumber}</div>
                      <div className="text-[11px]">{WEEKDAY_LABELS[day.weekday]}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.length === 0 ? (
                  <tr>
                    <td colSpan={weekdayInfo.length + 1} className="px-4 py-6 text-center text-sm text-fg-muted">
                      表示できるスタッフがありません。
                    </td>
                  </tr>
                ) : (
                  people.map((personId) => (
                    <tr key={personId} className="border-t border-line/40">
                      <th className="sticky left-0 z-10 whitespace-nowrap bg-surface px-4 py-2 text-left text-sm font-semibold text-fg">
                        {personId}
                      </th>
                      {mergedDays.map((day) => {
                        const assignmentsForPerson = day.assignments.filter((assignment) => assignment.personId === personId);
                        const isManualOverride = Boolean(manualOverrides?.[day.isoDate]);
                        return (
                          <td
                            key={`${personId}-${day.isoDate}`}
                            className={cn(
                              "min-w-[80px] border-l border-line/60 px-2 py-2 align-top",
                              isManualOverride && "bg-warning-soft"
                            )}
                          >
                            {assignmentsForPerson.length === 0 ? (
                              <span className="text-xs text-fg-muted">—</span>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {assignmentsForPerson.map((assignment) => {
                                  const label = formatShiftLabelShort(assignment.shiftId);
                                  const fullLabel = formatShiftLabel(assignment.shiftId);
                                  return (
                                    <span
                                      key={`${assignment.shiftId}-${assignment.assignmentDate}`}
                                      className="text-xs font-medium text-fg"
                                      title={fullLabel}
                                    >
                                      {label}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
