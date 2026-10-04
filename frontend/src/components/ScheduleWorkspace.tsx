"use client";

import { useMemo, useState } from "react";

import ScheduleCalendar from "@/components/ScheduleCalendar";
import ScheduleMatrixView from "@/components/ScheduleMatrixView";
import ScheduleWarningsPanel from "@/components/ScheduleWarningsPanel";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { buildCalendarData } from "@/lib/calendar";
import { requestScheduleGeneration } from "@/lib/scheduleClient";
import { ManualAssignmentMap, ScheduleAssignment, ScheduleGenerateResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import useUnsavedNavigation from "@/components/useUnsavedNavigation";

interface ScheduleWorkspaceProps {
  initialResponse: ScheduleGenerateResponse;
  year: number;
  month: number;
  userRole: string;
}

export default function ScheduleWorkspace({
  initialResponse,
  year,
  month,
  userRole,
}: ScheduleWorkspaceProps) {
  const [schedule, setSchedule] = useState<ScheduleGenerateResponse>(initialResponse);
  const [calendarData, setCalendarData] = useState(() => buildCalendarData(initialResponse));
  const [manualOverrides, setManualOverrides] = useState<ManualAssignmentMap>({});
  const [pendingAction, setPendingAction] = useState<"trial" | "confirm" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"calendar" | "personMatrix">("calendar");

  const privilegedRoles = useMemo(() => new Set(["LEADER", "ADMIN", "DEVELOPER"]), []);
  const canEdit = privilegedRoles.has(userRole);
  const isPharmacist = userRole === "PHARMACIST";
  // Manual adjustments stay in this page until the confirmed save sends them.
  useUnsavedNavigation(canEdit && Object.keys(manualOverrides).length > 0);
  const editableOverrides = useMemo(
    () => (canEdit ? manualOverrides : {}),
    [canEdit, manualOverrides],
  );

  const manualOverrideCount = useMemo(
    () => Object.values(editableOverrides).reduce((sum, items) => sum + items.length, 0),
    [editableOverrides],
  );

  const availablePeople = useMemo(() => {
    const ids = new Set<string>();
    schedule.assignments.forEach((assignment) => {
      if (assignment.personId) {
        ids.add(assignment.personId);
      }
    });
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
  }, [schedule.assignments]);

  const stats = useMemo(() => {
    const base = [
      {
        label: isPharmacist ? "自分の割当" : "総割当",
        value: schedule.totalAssignments.toLocaleString(),
        hint: isPharmacist ? "閲覧できるのは本人分のみ" : "シフトエントリ数",
      },
      {
        label: "警告数",
        value: schedule.warnings.length,
        hint: "検証状態は公開版の記録を確認",
        highlight: schedule.warnings.length > 0,
      },
      {
        label: "ロックバージョン",
        value: schedule.lockVersion ?? 0,
        hint: schedule.trialMode ? "未確定" : "確定済み",
      },
      {
        label: "生成日時",
        value: new Date(schedule.generatedAt).toLocaleString("ja-JP"),
        hint: schedule.trialMode ? "試行モード" : "確定モード",
      },
    ];
    return base;
  }, [isPharmacist, schedule.generatedAt, schedule.lockVersion, schedule.totalAssignments, schedule.trialMode, schedule.warnings.length]);

  const applyManualOverride = (isoDate: string, assignments: ScheduleAssignment[]) => {
    setManualOverrides((prev) => ({
      ...prev,
      [isoDate]: assignments.map((assignment) => ({
        ...assignment,
        assignmentDate: isoDate,
      })),
    }));
  };

  const resetManualOverride = (isoDate: string) => {
    setManualOverrides((prev) => {
      const next = { ...prev };
      delete next[isoDate];
      return next;
    });
  };

  const collectManualAssignments = () =>
    Object.values(manualOverrides).flatMap((items) => items.map((item) => ({ ...item })));

  const triggerAction = async (mode: "trial" | "confirm") => {
    setPendingAction(mode);
    setActionError(null);
    const manualAssignmentsPayload = collectManualAssignments();
    try {
      const next = await requestScheduleGeneration({
        year,
        month,
        trialMode: mode === "trial",
        expectedVersion: mode === "confirm" ? schedule.lockVersion ?? 0 : undefined,
        manualAssignments: manualAssignmentsPayload.length > 0 ? manualAssignmentsPayload : undefined,
      });
      setSchedule(next);
      setCalendarData(buildCalendarData(next));
      if (mode === "confirm") {
        setManualOverrides({});
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "スケジュール操作に失敗しました");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div>
      <a className="underline" href="/planning">契約に基づく生成・確認・公開へ</a>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} className={cn("border-line/70", stat.highlight && "border-warning/40 bg-warning-soft") }>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <div className="flex items-center gap-3">
                <CardTitle className="text-2xl font-semibold text-fg">{stat.value}</CardTitle>
                {stat.highlight && <Badge variant="destructive">注意</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-fg-muted">{stat.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {canEdit ? (
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pendingAction === "trial"}
            onClick={() => triggerAction("trial")}
            data-testid="trial-button"
          >
            {pendingAction === "trial" ? "試行中..." : "試行で再計算"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={true}
            onClick={() => triggerAction("confirm")}
            data-testid="confirm-button"
          >
            {pendingAction === "confirm" ? "保存中..." : "旧版の公開は終了しました"}
          </Button>
        </div>
      ) : (
        <Card className="mt-6 border-line/60 bg-canvas/60">
          <CardContent className="py-3 text-sm text-fg-muted space-y-1">
            <p>リーダー・管理者・開発者のみが手動調整と確定保存を実行できます。現在は閲覧モードです。</p>
            {isPharmacist && (
              <p className="text-xs text-fg-muted">
                セキュリティ要件により、表示されるシフトはご自身の割り当てのみです。他メンバーのスケジュールは管理権限者が確認できます。
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {actionError && (
        <p className="mt-3 text-sm text-danger">{actionError}</p>
      )}

      {canEdit && manualOverrideCount > 0 && (
        <Card className="mt-6 border-warning/40 bg-warning-soft">
          <CardContent className="py-4 text-sm text-warning">
            現在 {Object.keys(manualOverrides).length} 日に手動調整 ({manualOverrideCount} 件) が適用されています。確定保存でバックエンドにも反映されます。
          </CardContent>
        </Card>
      )}

      <div className="mt-8 space-y-6">
        <ScheduleWarningsPanel warnings={schedule.warnings} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line/60 bg-surface px-4 py-3 text-sm text-fg-muted">
          <span className="font-medium text-fg">表示モード</span>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={viewMode === "calendar" ? "default" : "outline"}
              aria-pressed={viewMode === "calendar"}
              onClick={() => setViewMode("calendar")}
            >
              カレンダー
            </Button>
            <Button
              type="button"
              size="sm"
              variant={viewMode === "personMatrix" ? "default" : "outline"}
              aria-pressed={viewMode === "personMatrix"}
              onClick={() => setViewMode("personMatrix")}
            >
              スタッフ×日付
            </Button>
          </div>
        </div>
        {viewMode === "calendar" ? (
          <ScheduleCalendar
            data={calendarData}
            manualOverrides={editableOverrides}
            onManualSaveAssignments={canEdit ? applyManualOverride : undefined}
            onManualResetAssignments={canEdit ? resetManualOverride : undefined}
            availablePeople={canEdit ? availablePeople : undefined}
            warnings={schedule.warnings}
          />
        ) : (
          <ScheduleMatrixView
            data={calendarData}
            manualOverrides={editableOverrides}
            availablePeople={canEdit ? availablePeople : undefined}
          />
        )}
      </div>
    </div>
  );
}
