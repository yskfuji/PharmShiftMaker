"use client";

import { useId, useState } from "react";
import { Activity } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export type LoadRange = "weekly" | "monthly";

export interface StaffLoadRecord {
  personId: string;
  displayName: string;
  role: string;
  loadPercent: number;
  nightCount: number;
  eveningCount: number;
  warnings?: number;
}

interface StaffLoadCardProps {
  snapshots: Record<LoadRange, StaffLoadRecord[]>;
}

const RANGE_OPTIONS: { key: LoadRange; label: string }[] = [
  { key: "weekly", label: "今週" },
  { key: "monthly", label: "今月" },
];

export default function StaffLoadCard({ snapshots }: StaffLoadCardProps) {
  const [range, setRange] = useState<LoadRange>("weekly");
  const activeDataset = snapshots[range];
  const headingId = useId();

  return (
    <Card aria-labelledby={headingId} className="border-line/80 bg-surface">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle id={headingId} className="text-xl">スタッフ稼働状況</CardTitle>
            <CardDescription>夜勤・夕診の偏りを即座に把握</CardDescription>
          </div>
          <Activity className="h-5 w-5 text-fg-muted" aria-hidden="true" />
        </div>
        <div className="inline-flex rounded-full border border-line/70 bg-canvas/80 p-1 text-xs font-medium">
          {RANGE_OPTIONS.map((option) => (
            <Button
              key={option.key}
              type="button"
              size="sm"
              variant={range === option.key ? "secondary" : "ghost"}
              className={cn(
                "h-7 rounded-full px-3 text-xs transition-all",
                range === option.key ? "shadow-inner" : "text-fg-muted"
              )}
              aria-pressed={range === option.key}
              onClick={() => setRange(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeDataset.map((record) => (
          <article key={record.personId} className="rounded-lg border border-line/60 bg-canvas/60 p-3 transition hover:border-primary/40">
            <div className="flex items-center justify-between text-sm">
              <div>
                <p className="font-semibold text-fg">{record.displayName}</p>
                <p className="text-xs text-fg-muted">{record.role}</p>
              </div>
              <Badge variant="outline" className="text-xs text-fg-muted">
                稼働 {record.loadPercent}%
              </Badge>
            </div>
            <div className="mt-2 h-2 rounded-full bg-surface/60" aria-hidden="true">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all"
                style={{ width: `${Math.min(record.loadPercent, 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-fg-muted" aria-live="polite">
              {record.displayName} の稼働率 {record.loadPercent}%
            </p>
            <dl className="mt-3 flex flex-wrap gap-3 text-xs text-fg-muted">
              <div>
                <dt className="sr-only">夜勤回数</dt>
                <dd>夜勤 {record.nightCount}回</dd>
              </div>
              <div>
                <dt className="sr-only">夕診回数</dt>
                <dd>夕診 {record.eveningCount}回</dd>
              </div>
              {typeof record.warnings === "number" && (
                <div>
                  <dt className="sr-only">警告数</dt>
                  <dd className={record.warnings > 0 ? "text-warning" : undefined}>
                    警告 {record.warnings}件
                  </dd>
                </div>
              )}
            </dl>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}
