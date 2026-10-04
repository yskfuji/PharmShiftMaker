import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  context?: ReactNode;
  className?: string;
}

export default function PageHeader({ title, description, actions, context, className }: PageHeaderProps) {
  return (
    <div className={cn("page-header flex flex-col gap-4 border-b border-line pb-6 lg:flex-row lg:items-center lg:justify-between", className)}>
      <div className="min-w-0">
        {context && <div className="mb-2 text-sm text-fg-muted">{context}</div>}
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-base text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
