"use client";

import { FormEvent, useId, useMemo, useState } from "react";
import { AlertTriangle, CalendarRange, Check, ChevronLeft, ChevronRight, Edit2, Loader2, Plus, RefreshCcw, Save, Trash2, X } from "lucide-react";

import useLeaveQuotas from "@/hooks/useLeaveQuotas";
import useStaffDirectory from "@/hooks/useStaffDirectory";
import { LeaveQuotaKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import useUnsavedNavigation, {confirmDiscardChanges} from "./useUnsavedNavigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

const KIND_INFO: Record<LeaveQuotaKind, { label: string; description: string; color: string }> = {
  PAID_LEAVE_REQUEST: {
    label: "有給休暇",
    description: "旧形式の有給枠",
    color: "bg-leave-paid-soft text-leave-paid border-leave-paid/40",
  },
  SUMMER_LEAVE_REQUEST: {
    label: "夏季休暇",
    description: "夏季特別休暇",
    color: "bg-leave-summer-soft text-leave-summer border-leave-summer/40",
  },
  REFRESH_LEAVE_REQUEST: {
    label: "リフレッシュ休暇",
    description: "リフレッシュ/特別休暇",
    color: "bg-leave-refresh-soft text-leave-refresh border-leave-refresh/40",
  },
};

interface LeaveQuotaManagerProps {
  initialYear: number;
  initialMonth: number;
  canEdit?: boolean;
}

function toKey(personId: string, kind: LeaveQuotaKind) {
  return `${personId}-${kind}`;
}

export default function LeaveQuotaManager({ initialYear, initialMonth, canEdit = false }: LeaveQuotaManagerProps) {
  const formId = useId();
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("0");
  const [editingOriginal, setEditingOriginal] = useState<string>("0");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [formPersonId, setFormPersonId] = useState<string>("");
  const [formKind, setFormKind] = useState<LeaveQuotaKind>("PAID_LEAVE_REQUEST");
  const [formTotal, setFormTotal] = useState<string>("5");
  const [formError, setFormError] = useState<string | null>(null);
  // A changed inline value or a started new-quota form is unsaved work.
  useUnsavedNavigation((editingKey !== null && editingValue !== editingOriginal)
    || formPersonId !== "" || formTotal !== "5" || formKind !== "PAID_LEAVE_REQUEST");

  const { items, loading, error, refresh, upsert, remove } = useLeaveQuotas(year, month);
  const { entries: staffEntries, loading: staffLoading, error: staffError } = useStaffDirectory();

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const nameA = a.personName ?? a.personId;
      const nameB = b.personName ?? b.personId;
      if (nameA === nameB) {
        return a.kind.localeCompare(b.kind);
      }
      return nameA.localeCompare(nameB, "ja");
    });
  }, [items]);

  const summary = useMemo(() => {
    const targetKinds = Object.keys(KIND_INFO) as LeaveQuotaKind[];
    const base = targetKinds.map((kind) => {
      const subset = items.filter((item) => item.kind === kind);
      const total = subset.reduce((sum, item) => sum + item.totalDays, 0);
      const remaining = subset.reduce((sum, item) => sum + item.remainingDays, 0);
      return { kind, total, remaining };
    });
    return base;
  }, [items]);

  const shiftMonth = (delta: number) => {
    if (pendingAction || !confirmDiscardChanges()) return;
    const date = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(date.getUTCFullYear());
    setMonth(date.getUTCMonth() + 1);
    setEditingKey(null);
    setFormPersonId(""); setFormTotal("5"); setFormKind("PAID_LEAVE_REQUEST");
  };

  const startEdit = (personId: string, kind: LeaveQuotaKind, current: number) => {
    if (!canEdit || !confirmDiscardChanges()) return;
    setEditingKey(toKey(personId, kind));
    setEditingValue(String(current));
    setEditingOriginal(String(current));
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditingValue("0");
  };

  const handleSave = async (personId: string, kind: LeaveQuotaKind) => {
    if (!canEdit) return;
    const parsed = Number.parseInt(editingValue, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      setFormError("日数は0以上の整数で入力してください");
      return;
    }
    setPendingAction(toKey(personId, kind));
    setFormError(null);
    try {
      await upsert(personId, kind, parsed);
      setEditingKey(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "クォータの更新に失敗しました");
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async (personId: string, kind: LeaveQuotaKind) => {
    if (!canEdit) return;
    if (!window.confirm("このクォータを削除しますか？")) {
      return;
    }
    setPendingAction(toKey(personId, kind));
    setFormError(null);
    try {
      await remove(personId, kind);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "クォータの削除に失敗しました");
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) return;
    const parsed = Number.parseInt(formTotal, 10);
    if (!formPersonId) {
      setFormError("職員を選択してください");
      return;
    }
    if (Number.isNaN(parsed) || parsed < 0) {
      setFormError("日数は0以上の整数で入力してください");
      return;
    }
    setPendingAction("create");
    setFormError(null);
    try {
      await upsert(formPersonId, formKind, parsed);
      setFormTotal("5");
      setFormPersonId("");
      setFormKind("PAID_LEAVE_REQUEST");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "クォータの追加に失敗しました");
    } finally {
      setPendingAction(null);
    }
  };

  const renderTotalCell = (personId: string, kind: LeaveQuotaKind, total: number) => {
    const key = toKey(personId, kind);
    const isEditing = editingKey === key;
    if (!isEditing) {
      return <span className="font-semibold text-fg">{total} 日</span>;
    }
    return (
      <Input
        type="number"
        aria-label="旧休暇枠の年間日数"
        min={0}
        value={editingValue}
        onChange={(event) => setEditingValue(event.target.value)}
        className="h-9 w-24"
      />
    );
  };

  return (
    <Card className="mt-8">
      <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle className="text-xl">旧休暇枠の一覧</CardTitle>
          <CardDescription>
            旧形式の記録です。この画面の変更を、現在の勤務案への反映や年休実取得の確定として扱いません。
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="icon" aria-label="前月の旧休暇枠" disabled={!!pendingAction} onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="rounded-md border border-line px-3 py-1 text-sm font-semibold text-fg">
            {year}年 {month}月
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="翌月の旧休暇枠" disabled={!!pendingAction} onClick={() => shiftMonth(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            再読み込み
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {!canEdit && <p role="status">参照のみ。枠の更新は管理者・開発者に限られます。</p>}
        <div className="grid gap-3 md:grid-cols-3">
          {summary.map(({ kind, total, remaining }) => (
            <div key={kind} className="rounded-lg border border-line bg-canvas/50 p-4">
              <div className="flex items-center justify-between text-sm text-fg-muted">
                <span>{KIND_INFO[kind].label}</span>
                <CalendarRange className="h-4 w-4 text-fg-muted" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-fg">{loading || error ? '未確認' : remaining}</span>
                <span className="text-xs text-fg-muted">{loading || error ? '取得結果を確認してください' : `/ ${total} 日 残り`}</span>
              </div>
            </div>
          ))}
        </div>

        {(error || staffError || formError) && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            <AlertTriangle className="h-4 w-4" />
            {error || staffError || formError}
          </div>
        )}

        {sortedItems.length === 0 ? <p role="status">{loading ? "読み込み中..." : error ? "取得できませんでした。登録状況は未確認です。" : "旧休暇枠は登録されていません"}</p> : <><p id={`${formId}-scroll`} className="text-sm text-fg-muted">旧休暇枠の比較表です。狭い画面では横にスクロールして全列を確認できます。</p>
        <div role="region" aria-label="旧休暇枠の比較表" aria-describedby={`${formId}-scroll`} tabIndex={0} className="overflow-x-auto rounded-lg border border-line">
          <table className="ui-data-table w-full min-w-[42rem] divide-y divide-line text-sm">
            <thead className="bg-canvas/80 text-fg-muted">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">職員</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">休暇種別</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">年間枠</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">消化状況</th>
                <th className="whitespace-nowrap px-4 py-3 text-left font-semibold">残り</th>
                <th className="whitespace-nowrap px-4 py-3 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface/30">
              {sortedItems.map((item) => {
                const key = toKey(item.personId, item.kind);
                const info = KIND_INFO[item.kind];
                const usedThisMonth = Math.max(0, item.usedDays - item.usedBeforeMonth);
                const isEditing = editingKey === key;
                const isPending = pendingAction === key;
                return (
                  <tr key={key}>
                    <td className="whitespace-nowrap px-4 py-3 text-fg font-medium">
                      {item.personName ?? item.personId}
                      <div className="text-xs text-fg-muted">{item.personId}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold", info.color)}>
                        {info.label}
                        <span className="text-sm font-normal">{info.description}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">{renderTotalCell(item.personId, item.kind, item.totalDays)}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      <div className="font-medium text-fg">{item.usedDays} 日</div>
                      <div className="text-xs">今月 {usedThisMonth} 日 / 前月まで {item.usedBeforeMonth} 日</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="whitespace-nowrap bg-primary-soft text-primary">
                        残 {item.remainingDays} 日
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {!canEdit ? <span className="text-fg-muted">参照のみ</span> : isEditing ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleSave(item.personId, item.kind)}
                            disabled={isPending}
                          >
                            {isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                            保存
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={cancelEdit} disabled={isPending}>
                            <X className="mr-1 h-4 w-4" />
                            キャンセル
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(item.personId, item.kind, item.totalDays)}
                          >
                            <Edit2 className="mr-1 h-4 w-4" />
                            編集
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-danger hover:bg-danger-soft hover:text-danger"
                            onClick={() => handleDelete(item.personId, item.kind)}
                            disabled={isPending}
                          >
                            {isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
                            削除
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></>}

        {canEdit && <div className="rounded-lg border border-dashed border-line bg-canvas/40 p-5">
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Plus className="h-4 w-4" /> 新規クォータを追加
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${formId}-person`}>対象職員</Label>
                <select
                  id={`${formId}-person`}
                  value={formPersonId}
                  onChange={(event) => setFormPersonId(event.target.value)}
                  className="ui-control w-full rounded-md border border-control bg-surface px-3 py-2 text-sm"
                >
                  <option value="">選択してください</option>
                  {staffLoading ? (
                    <option value="" disabled>
                      取得中...
                    </option>
                  ) : (
                    staffEntries.map((entry) => (
                      <option key={entry.personId} value={entry.personId}>
                        {entry.name} ({entry.personId})
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${formId}-kind`}>休暇種別</Label>
                <select
                  id={`${formId}-kind`}
                  value={formKind}
                  onChange={(event) => setFormKind(event.target.value as LeaveQuotaKind)}
                  className="ui-control w-full rounded-md border border-control bg-surface px-3 py-2 text-sm"
                >
                  {(Object.keys(KIND_INFO) as LeaveQuotaKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_INFO[kind].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${formId}-year`}>対象年</Label>
                <Input id={`${formId}-year`} value={`${year}`} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${formId}-total`}>付与日数</Label>
                <Input
                  id={`${formId}-total`}
                  type="number"
                  min={0}
                  value={formTotal}
                  onChange={(event) => setFormTotal(event.target.value)}
                />
              </div>
            </div>
            <Button type="submit" disabled={pendingAction === "create"}>
              {pendingAction === "create" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              登録/更新
            </Button>
          </form>
        </div>}
      </CardContent>
    </Card>
  );
}
