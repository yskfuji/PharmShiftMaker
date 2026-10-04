"use client";

import { CircleUserRound, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { WORKSPACE_CONTEXT_CHANGED, type WorkspaceContextChangedDetail } from "@/ideal/providers/contextEvent";

export default function WorkspaceUserMenu({ name, role, settingsHref, notificationsHref, notices, compact = false }: {
  name: string;
  role: string;
  settingsHref: string;
  notificationsHref: string;
  notices: number;
  compact?: boolean;
}) {
  const [unread, setUnread] = useState(notices);
  useEffect(() => setUnread(notices), [notices]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceContextChangedDetail>).detail;
      if (detail?.unreadNotifications !== undefined) setUnread(detail.unreadNotifications);
    };
    window.addEventListener(WORKSPACE_CONTEXT_CHANGED, changed);
    return () => window.removeEventListener(WORKSPACE_CONTEXT_CHANGED, changed);
  }, []);
  return <details className={`ideal-v3-user-menu${compact ? " is-compact" : ""}`}>
    <summary aria-label="利用者メニュー"><CircleUserRound aria-hidden="true" />{!compact && <span>{name}</span>}</summary>
    <div>
      <strong>{name}</strong><small>{role}</small>
      <ThemeToggle />
      <Link href={settingsHref}>個人設定</Link>
      <Link href={notificationsHref}>通知 {unread ? `（未確認${unread}件）` : ""}</Link>
      <button type="button" className="ideal-button ideal-button--secondary" onClick={() => window.dispatchEvent(new Event("workspace-signout"))}><LogOut aria-hidden="true" />サインアウト</button>
    </div>
  </details>;
}
