"use client";
import ContextLink from "@/components/ContextLink";
import { CalendarDays, ClipboardList, Home, LayoutDashboard, Settings2 } from "lucide-react";
import { usePrimaryNavigation } from "@/components/NavigationFlags";
import { cn } from "@/lib/utils";
import { currentNavigation } from "@/lib/navigation";

const ICONS: Record<string, typeof CalendarDays> = {
  "/workspace/home": Home,
  "/dashboard": LayoutDashboard,
  "/schedule": CalendarDays,
  "/planning": CalendarDays,
  "/planning/workflows": ClipboardList,
  "/settings": Settings2,
};

/** The sidebar's destinations (lib/navigation.ts; the ideal UI's entry only with IDEAL_UI=1).
 * Only this list is a client component, so the page layout and its main landmark stay as
 * the page renders them. */
export default function SidebarNavigation({ currentPath, scheduleHref }: { currentPath: string; scheduleHref: string }) {
  const items = usePrimaryNavigation();
  return (
    <nav aria-label="主な画面" className="mt-8 space-y-1">
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? CalendarDays;
        const isActive = currentNavigation(currentPath, items) === item;
        return (
          <ContextLink
            key={item.href}
            href={item.href === "/schedule" ? scheduleHref : item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-base font-medium transition-colors",
              isActive ? "bg-primary-soft text-primary" : "text-fg-muted hover:text-fg hover:bg-surface-sunken",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {item.label}
          </ContextLink>
        );
      })}
    </nav>
  );
}
