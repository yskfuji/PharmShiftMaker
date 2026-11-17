"use client";

import { Calendar, Palmtree, Sparkles, Sun, Trash2 } from "lucide-react";

import type { LucideIcon } from "lucide-react";

import { HolidayRequestKind, HolidayRequestRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";

const REQUEST_OPTIONS: Array<{
  kind: HolidayRequestKind;
  label: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}> = [
  {
    kind: "PUBLIC_HOLIDAY_REQUEST",
    label: "公休を希望する",
    description: "公休枠の中でこの日を休日に充当します",
    icon: Calendar,
    accent: "bg-leave-public-soft text-leave-public",
  },
  {
    kind: "PAID_LEAVE_REQUEST",
    label: "有給を希望する",
    description: "有給休暇として休みにします (残数を消費)",
    icon: Palmtree,
    accent: "bg-leave-paid-soft text-leave-paid",
  },
  {
    kind: "SUMMER_LEAVE_REQUEST",
    label: "夏季休暇を希望",
    description: "夏季休暇枠（例: 夏季特別休）から差し引き",
    icon: Sun,
    accent: "bg-leave-summer-soft text-leave-summer",
  },
  {
    kind: "REFRESH_LEAVE_REQUEST",
    label: "リフレッシュ休暇を希望",
    description: "リフレッシュ休暇枠（特別休暇）から差し引き",
    icon: Sparkles,
    accent: "bg-leave-refresh-soft text-leave-refresh",
  },
];

const KIND_META = REQUEST_OPTIONS.reduce(
  (acc, option) => {
    acc.label[option.kind] = option.label;
    acc.accent[option.kind] = option.accent;
    return acc;
  },
  {
    label: {} as Record<HolidayRequestKind, string>,
    accent: {} as Record<HolidayRequestKind, string>,
  },
);

interface HolidayRequestEditorProps {
  isoDate: string;
  currentRequest: HolidayRequestRecord | null;
  onSave: (kind: HolidayRequestKind) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
  isBusy: boolean;
  error: string | null;
}

export default function HolidayRequestEditor({
  isoDate,
  currentRequest,
  onSave,
  onDelete,
  isBusy,
  error,
}: HolidayRequestEditorProps) {
  return (
    <Card className="border-none shadow-none bg-transparent">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-sm font-bold text-fg">希望休の登録</CardTitle>
        <CardDescription className="text-xs text-fg-muted">{isoDate} の希望休を登録または解除できます。</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0 space-y-4">
        <div className="grid gap-3">
          {REQUEST_OPTIONS.map(({ kind, label, description, icon: Icon, accent }) => {
            const isActive = currentRequest?.kind === kind;

            return (
              <button
                key={kind}
                type="button"
                disabled={isBusy}
                onClick={() => onSave(kind)}
                className={"ui-button "+(cn(
                  "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all",
                  isActive
                    ? "border-primary bg-primary-soft ring-1 ring-primary"
                    : "border-line bg-canvas hover:border-primary hover:bg-surface",
                  isBusy && "opacity-50 cursor-not-allowed"
                ))}
              >
                <div
                  className={cn(
                    "rounded-full p-2 transition-colors",
                    isActive ? accent : "bg-surface text-fg-muted"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <div className={cn("text-sm font-medium transition-colors", isActive ? "text-primary" : "text-fg")}>
                    {label}
                  </div>
                  <div className="text-xs text-fg-muted">{description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {currentRequest ? (
          <div className="flex items-center justify-between rounded-lg bg-surface p-3 text-xs border border-line">
            <span className="text-primary font-medium flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", KIND_META.accent[currentRequest.kind])}></span>
              現在の希望: {KIND_META.label[currentRequest.kind]}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={onDelete}
              className="h-8 shrink-0 whitespace-nowrap px-2 text-danger hover:text-danger hover:bg-danger-soft"
            >
              <Trash2 className="mr-1 h-3 w-3" />
              取り消す
            </Button>
          </div>
        ) : (
          <div className="text-center text-xs text-fg-muted py-2 bg-surface/50 rounded-lg border border-dashed border-line">
            現在この日には希望休が登録されていません
          </div>
        )}

        {error && (
          <div className="rounded-md bg-danger-soft p-3 text-xs text-danger flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-danger shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
