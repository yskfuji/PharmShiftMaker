"use client";
import useUnsavedNavigation from "./useUnsavedNavigation";

import { DragEvent, useEffect, useMemo, useState } from "react";

import { ScheduleAssignment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatShiftLabelShort } from "@/lib/shiftLabels";

interface ManualAssignmentEditorProps {
  isoDate: string;
  assignments: ScheduleAssignment[];
  baselineAssignments?: ScheduleAssignment[];
  onSave: (assignments: ScheduleAssignment[]) => Promise<void> | void;
  onReset?: () => Promise<void> | void;
  isEdited?: boolean;
  availablePeople?: string[];
  /** Told whether this editor holds rows that differ from the saved assignments. */
  onDirtyChange?: (dirty: boolean) => void;
}

interface EditableAssignment {
  personId: string;
  shiftId: string;
}

export default function ManualAssignmentEditor({
  isoDate,
  assignments,
  baselineAssignments,
  onSave,
  onReset,
  isEdited,
  availablePeople,
  onDirtyChange,
}: ManualAssignmentEditorProps) {
  const [rows, setRows] = useState<EditableAssignment[]>(() => assignments.map((item) => ({
    personId: item.personId,
    shiftId: item.shiftId,
  })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingPerson, setDraggingPerson] = useState<string | null>(null);
  const [dragHoverIndex, setDragHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    setRows(assignments.map((item) => ({ personId: item.personId, shiftId: item.shiftId })));
  }, [assignments, isoDate]);

  const isSavable = useMemo(() => rows.length > 0 && rows.every((row) => row.personId.trim() && row.shiftId.trim()), [rows]);
  // Unsaved rows are registered, so leaving the page or closing the day dialog asks first.
  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(assignments.map((item) => ({ personId: item.personId, shiftId: item.shiftId }))), [rows, assignments]);
  useUnsavedNavigation(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const handleChange = (index: number, field: keyof EditableAssignment, value: string) => {
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, { personId: "", shiftId: "" }]);
  };

  const handleRemoveRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragStart = (personId: string) => (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData("text/plain", personId);
    event.dataTransfer.effectAllowed = "copyMove";
    setDraggingPerson(personId);
  };

  const handleDragEnd = () => {
    setDraggingPerson(null);
  };

  const handleRowDragOver = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragHoverIndex(index);
  };

  const handleRowDragLeave = (index: number) => () => {
    if (dragHoverIndex === index) {
      setDragHoverIndex(null);
    }
  };

  const handleRowDrop = (index: number) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const personId = event.dataTransfer.getData("text/plain");
    if (personId) {
      handleChange(index, "personId", personId);
    }
    setDragHoverIndex(null);
  };

  const handleSave = async () => {
    if (!isSavable) {
      setError("シフトIDと職員IDを入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const normalized = rows.map((row) => ({
        personId: row.personId.trim(),
        shiftId: row.shiftId.trim(),
        assignmentDate: isoDate,
      }));
      await onSave(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "手動調整の保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!onReset) {
      setRows(assignments.map((item) => ({ personId: item.personId, shiftId: item.shiftId })));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onReset();
      // Back to the generated assignments even when no adjustment had been applied (then the
      // assignments passed in do not change, and unapplied rows would otherwise stay).
      setRows((baselineAssignments ?? assignments).map((item) => ({ personId: item.personId, shiftId: item.shiftId })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "リセットに失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-fg">手動調整</h4>
          <p className="text-xs text-fg-muted mt-1">新しいシフト割り当てを入力すると、この日の全割当を置き換えます。</p>
        </div>
        <Badge variant={isEdited ? "destructive" : "outline"} className={cn(isEdited ? "bg-warning-soft text-warning" : "") }>
          {isEdited ? "手動調整済み" : "自動割当"}
        </Badge>
      </div>

      {availablePeople && availablePeople.length > 0 && (
        <div className="rounded-lg border border-dashed border-line/70 bg-canvas/60 p-4">
          <p className="text-xs text-fg-muted mb-2">スタッフ名をドラッグ＆ドロップして担当者を入れ替えできます。</p>
          <div className="flex flex-wrap gap-2">
            {availablePeople.map((person) => (
              <button
                key={person}
                type="button"
                draggable
                onDragStart={handleDragStart(person)}
                onDragEnd={handleDragEnd}
                data-testid="person-chip"
                data-person-id={person}
                className={"ui-button "+(cn(
                  "cursor-grab rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-fg transition-colors hover:bg-primary-soft",
                  draggingPerson === person && "border-primary text-primary",
                ))}
              >
                {person}
              </button>
            ))}
          </div>
        </div>
      )}

      {baselineAssignments && baselineAssignments.length > 0 && !isEdited && (
        <p className="text-xs text-fg-muted">
          現在の自動割当: {baselineAssignments.map((item) => `${formatShiftLabelShort(item.shiftId)}/${item.personId}`).join(", ")}
        </p>
      )}

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={`${row.personId}-${index}`} className="flex items-center gap-2" data-testid={`manual-row-${index}`}>
            <Input
              value={row.shiftId}
              onChange={(event) => handleChange(index, "shiftId", event.target.value)}
              placeholder="シフトID"
              aria-label={`シフトID ${index + 1}`}
              data-testid={`manual-row-${index}-shift`}
              className="min-w-0 flex-1"
            />
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 py-2 transition-all",
                dragHoverIndex === index && "border-primary bg-primary-soft",
              )}
              onDragOver={handleRowDragOver(index)}
              onDragLeave={handleRowDragLeave(index)}
              onDrop={handleRowDrop(index)}
              data-testid={`manual-row-${index}-drop`}
            >
              <Input
                value={row.personId}
                onChange={(event) => handleChange(index, "personId", event.target.value)}
                placeholder="職員ID"
                aria-label={`職員ID ${index + 1}`}
                data-testid={`manual-row-${index}-person`}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-fg-muted hover:text-danger"
              onClick={() => handleRemoveRow(index)}
              aria-label="割当を削除"
            >
              ×
            </Button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-fg-muted">割当がありません。下のボタンから追加してください。</p>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleAddRow}>
          割当を追加
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={handleReset}>
            リセット
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!isSavable || saving}
            onClick={handleSave}
            data-testid="manual-save-button"
          >
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </div>
    </div>
  );
}
