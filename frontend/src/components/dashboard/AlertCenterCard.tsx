"use client";

import { useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, Info } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  severity: AlertSeverity;
  responsible?: string;
}

interface AlertCenterCardProps {
  alerts: AlertItem[];
}

const SEVERITY_META: Record<AlertSeverity, { icon: typeof AlertCircle; badge: string; tone: string }> = {
  info: { icon: Info, badge: "情報", tone: "text-link border-primary/40 bg-primary-soft" },
  warning: { icon: AlertTriangle, badge: "注意", tone: "text-warning border-warning/40 bg-warning-soft" },
  critical: { icon: AlertCircle, badge: "要対応", tone: "text-danger border-danger/30 bg-danger-soft" },
};

const FILTERS = [
  { key: "all", label: "すべて" },
  { key: "critical", label: "要対応" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

export default function AlertCenterCard({ alerts }: AlertCenterCardProps) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const filteredAlerts = useMemo(() => {
    if (filter === "critical") {
      return alerts.filter((alert) => alert.severity === "critical");
    }
    return alerts;
  }, [alerts, filter]);

  return (
    <Card className="border-line/80 bg-surface">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">アラート・通知センター</CardTitle>
            <CardDescription>自動生成された警告と対応状況を集約</CardDescription>
          </div>
          <Bell className="h-5 w-5 text-fg-muted" aria-hidden="true" />
        </div>
        <div className="inline-flex rounded-full border border-line/70 bg-canvas/80 p-1 text-xs font-medium">
          {FILTERS.map((option) => (
            <Button
              key={option.key}
              type="button"
              variant={filter === option.key ? "secondary" : "ghost"}
              size="sm"
              className={cn(
                "h-7 rounded-full px-3 text-xs transition-all",
                filter === option.key ? "shadow-inner" : "text-fg-muted"
              )}
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {filteredAlerts.length === 0 ? (
          <div className="flex items-center gap-3 rounded-lg border border-line/70 bg-canvas/60 px-4 py-6 text-sm text-fg-muted" role="status" aria-live="polite">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            未対応のアラートはありません。
          </div>
        ) : (
          <ul className="space-y-4" aria-live="polite">
            {filteredAlerts.map((alert) => {
              const SeverityIcon = SEVERITY_META[alert.severity].icon;
              return (
                <li key={alert.id} className="rounded-xl border border-line/70 bg-canvas/70 p-4 transition hover:border-primary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <SeverityIcon className={cn("h-4 w-4", SEVERITY_META[alert.severity].tone)} aria-hidden="true" />
                      <p className="text-sm font-semibold text-fg">{alert.title}</p>
                    </div>
                    <Badge variant="outline" className={cn("text-[11px]", SEVERITY_META[alert.severity].tone)}>
                      {SEVERITY_META[alert.severity].badge}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-fg-muted">{alert.description}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-fg-muted">
                    <span>{new Date(alert.timestamp).toLocaleString("ja-JP")}</span>
                    {alert.responsible && <span>担当: {alert.responsible}</span>}
                    <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs">
                      詳細を見る
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
