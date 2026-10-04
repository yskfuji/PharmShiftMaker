import { IdentityDisplay } from '@/components/IdentityProvider';
import { ReactNode } from "react";

import GlobalNavigation from "@/components/GlobalNavigation";
import SidebarNavigation from "@/components/layout/SidebarNavigation";

interface AppLayoutProps {
  currentPath: string;
  scheduleHref?: string;
  children: ReactNode;
}

export default function AppLayout({ currentPath, scheduleHref = "/schedule", children }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen bg-canvas text-fg">
      <aside className="hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="px-2">
          <p className="text-xs tracking-widest text-fg-muted">PharmShiftMaker</p>
          <p className="text-2xl font-bold text-fg">Scheduler</p>
        </div>
        {/* The same destinations as GlobalNavigation (lib/navigation.ts). */}
        <SidebarNavigation currentPath={currentPath} scheduleHref={scheduleHref} />
        <div className="mt-auto rounded-lg border border-line bg-surface-sunken p-4">
          <p className="text-xs text-fg-muted">ログイン中</p>
          <IdentityDisplay />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
          <div>
            <p className="text-xs tracking-widest text-fg-muted">PharmShiftMaker 運用</p>
            <p className="text-sm text-fg-muted">薬剤科の勤務と業務管理</p>
          </div>
          <p className="text-sm text-fg-muted">生成 → 確認 → 公開</p>
        </header>
        {/* Below the sidebar's breakpoint the same destinations are listed here. */}
        <GlobalNavigation current={currentPath} className="border-b border-line px-4 py-1 lg:hidden" />
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 focus:outline-none">{children}</main>
      </div>
    </div>
  );
}
