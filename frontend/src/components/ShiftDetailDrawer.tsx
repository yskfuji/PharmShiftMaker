"use client";

import { X } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import useModalDialog from "./useModalDialog";

import {
  DayAssignments,
  HolidayRequestKind,
  HolidayRequestRecord,
  ScheduleAssignment,
  ScheduleWarning,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

import HolidayRequestEditor from "./HolidayRequestEditor";
import ManualAssignmentEditor from "./ManualAssignmentEditor";
import { formatShiftLabel } from "@/lib/shiftLabels";

function formatWarningContext(context: Record<string, unknown> | undefined): string | null {
  if (!context) {
    return null;
  }
  if (typeof context.date === "string") {
    return `対象日: ${context.date}`;
  }
  if (typeof context.start_date === "string" && typeof context.end_date === "string") {
    return `対象期間: ${context.start_date} 〜 ${context.end_date}`;
  }
  if (Array.isArray(context.person_ids) && context.person_ids.length > 0) {
    return `対象: ${context.person_ids.join(", ")}`;
  }
  if (typeof context.person_id === "string") {
    return `対象: ${context.person_id}`;
  }
  return null;
}

interface ShiftDetailDrawerProps {
  day: DayAssignments | null;
  onClose: () => void;
  holidayRequest?: HolidayRequestRecord | null;
  onSaveHolidayRequest?: (kind: HolidayRequestKind) => Promise<void> | void;
  onDeleteHolidayRequest?: () => Promise<void> | void;
  isRequestLoading?: boolean;
  requestError?: string | null;
  manualAssignments?: ScheduleAssignment[];
  baselineAssignments?: ScheduleAssignment[];
  onSaveManualAssignments?: (assignments: ScheduleAssignment[]) => Promise<void> | void;
  onResetManualAssignments?: () => Promise<void> | void;
  isManuallyEdited?: boolean;
  dayWarnings?: ScheduleWarning[];
  availablePeople?: string[];
}

export default function ShiftDetailDrawer({
  day,
  onClose,
  holidayRequest,
  onSaveHolidayRequest,
  onDeleteHolidayRequest,
  isRequestLoading,
  requestError,
  manualAssignments,
  baselineAssignments,
  onSaveManualAssignments,
  onResetManualAssignments,
  isManuallyEdited,
  dayWarnings,
  availablePeople,
}: ShiftDetailDrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Closing discards this dialog's unapplied rows only after the user agrees. Adjustments
  // already applied stay on the page (the page itself guards them until the confirmed save),
  // so they are not a reason to ask here.
  const [editorDirty, setEditorDirty] = useState(false);
  const requestClose = useCallback(() => {
    if (!editorDirty || window.confirm("未保存の手動調整を破棄して閉じますか？")) onClose();
  }, [editorDirty, onClose]);
  useModalDialog(!!day, panel, requestClose);
  if (!day || typeof document === "undefined") {
    return null;
  }

  const severityBadgeClass: Record<ScheduleWarning["severity"], string> = {
    info: "bg-primary-soft text-link border border-primary/40",
    warning: "bg-warning-soft text-warning border border-warning/40",
    critical: "bg-danger-soft text-danger border border-danger/30",
  };

  return createPortal(
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm p-4 sm:items-center animate-in fade-in duration-200">
      <button type="button" tabIndex={-1} aria-label="背景を選択して勤務詳細を終了" className="absolute inset-0 cursor-default" onClick={requestClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-line bg-surface shadow-2xl animate-in slide-in-from-bottom-10 duration-300 sm:zoom-in-95">
        <div className="flex items-center justify-between p-6 border-b border-line">
          <div>
            <p className="text-sm text-fg-muted font-medium">{day.isoDate}</p>
            <h2 id={titleId} className="text-xl font-bold text-fg mt-1">{day.dayNumber} 日の割り当て</h2>
          </div>
          <Button
            data-autofocus
            variant="ghost"
            size="icon"
            onClick={requestClose}
            className="rounded-full hover:bg-canvas"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">閉じる</span>
          </Button>
        </div>

        <div className="p-6 max-h-[60vh] overflow-y-auto">
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-fg-muted uppercase tracking-wider">シフト割り当て</h4>
            <ul className="divide-y divide-line rounded-lg border border-line bg-canvas/50 overflow-hidden">
              {day.assignments.length === 0 && (
                <li className="py-4 px-4 text-fg-muted italic text-center text-sm">割り当てなし</li>
              )}
              {day.assignments.map((assignment) => (
                <li
                  key={`${assignment.personId}-${assignment.shiftId}-${assignment.assignmentDate}`}
                  className="py-3 px-4 flex flex-wrap justify-between items-center gap-x-3 gap-y-1 hover:bg-surface/50 transition-colors"
                >
                  <Badge
                    variant="outline"
                    className="max-w-full whitespace-normal font-semibold text-primary border-primary/30 bg-primary-soft [overflow-wrap:anywhere]"
                    title={formatShiftLabel(assignment.shiftId)}
                  >
                    {formatShiftLabel(assignment.shiftId)}
                  </Badge>
                  <div className="min-w-0 text-sm font-medium text-fg [overflow-wrap:anywhere]">{assignment.personId}</div>
                </li>
              ))}
            </ul>
          </div>

          {dayWarnings && dayWarnings.length > 0 && (
            <div className="mt-8 pt-6 border-t border-line">
              <h4 className="text-sm font-medium text-fg-muted uppercase tracking-wider">警告</h4>
              <ul className="mt-3 space-y-3">
                {dayWarnings.map((warning, index) => {
                  const extra = formatWarningContext(warning.context);
                  return (
                    <li
                      key={`${warning.code}-${index}`}
                      className={cn(
                        "rounded-lg p-3 text-sm",
                        severityBadgeClass[warning.severity],
                      )}
                    >
                      <div className="font-semibold">{warning.message}</div>
                      {extra && <p className="mt-1 text-xs text-fg-muted">{extra}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {onSaveManualAssignments && (
            <div className="mt-8 pt-6 border-t border-line">
              <ManualAssignmentEditor
                isoDate={day.isoDate}
                assignments={manualAssignments ?? day.assignments}
                baselineAssignments={baselineAssignments ?? day.assignments}
                onSave={onSaveManualAssignments}
                onReset={onResetManualAssignments}
                isEdited={isManuallyEdited}
                availablePeople={availablePeople}
                onDirtyChange={setEditorDirty}
              />
            </div>
          )}

          {onSaveHolidayRequest && (
            <div className="mt-8 pt-6 border-t border-line">
              <HolidayRequestEditor
                isoDate={day.isoDate}
                currentRequest={holidayRequest ?? null}
                onSave={onSaveHolidayRequest}
                onDelete={onDeleteHolidayRequest ?? (() => {})}
                isBusy={Boolean(isRequestLoading)}
                error={requestError ?? null}
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
