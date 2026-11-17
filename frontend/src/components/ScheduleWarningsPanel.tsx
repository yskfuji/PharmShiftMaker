import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { ScheduleWarning } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

const SEVERITY_ICONS = {
  info: Info,
  warning: AlertTriangle,
  critical: AlertCircle,
};

const SEVERITY_STYLES = {
  info: "text-link bg-primary-soft border-primary/40",
  warning: "text-warning bg-warning-soft border-warning/40",
  critical: "text-danger bg-danger-soft border-danger/20",
};

interface ScheduleWarningsPanelProps {
  warnings: ScheduleWarning[];
}

export default function ScheduleWarningsPanel({ warnings }: ScheduleWarningsPanelProps) {
  if (warnings.length === 0) {
    return (
      <Card className="border-primary/20 bg-primary-soft" data-testid="warnings-panel">
        <CardContent className="flex items-center gap-3 p-4 text-sm text-primary">
          <CheckCircle2 className="h-5 w-5" />
          <p className="font-medium">警告はありません。シフトは安全基準内です。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-line bg-surface" data-testid="warnings-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <CardTitle className="text-base font-bold text-fg">検知された警告 ({warnings.length})</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {warnings.map((warning, i) => {
            const Icon = SEVERITY_ICONS[warning.severity] || Info;
            const personContext = warning.context?.person_id;
            const personLabel =
              typeof personContext === "string"
                ? personContext
                : personContext != null
                  ? JSON.stringify(personContext)
                  : null;

            return (
              <li
                key={`${warning.code}-${i}`}
                className={cn(
                  "flex items-start gap-3 rounded-md border px-3 py-2 text-sm",
                  SEVERITY_STYLES[warning.severity]
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-0.5 w-full">
                  <div className="font-medium">{warning.message}</div>
                  {personLabel && (
                    <div className="mt-1 flex justify-end">
                      <Badge variant="outline" className="text-xs opacity-80 border-current">
                        対象: {personLabel}
                      </Badge>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
