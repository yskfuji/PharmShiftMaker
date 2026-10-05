import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Menu } from "lucide-react";
import { roleLabels } from "@/ideal/data";
import { WORKSPACE_NAV } from "@/features/workspace/generated/usecaseRoutes";
import type { PublicationRead } from "@/ideal/api/contracts";
import { screenMeta } from "@/ideal/ui/atoms";
import type { IdealRole, IdealScreen, PlanningScopeSummary, WorkspaceNotification } from "@/ideal/types";
import { defaultWorkspaceView, workspaceViews } from "@/ideal/views";
import WorkspaceContextSummary from "./WorkspaceContextSummary";
import { workspaceHrefWithContext } from "./workspaceHref";
import WorkspaceUserMenu from "./WorkspaceUserMenu";

/** What the frame shows: who is signed in, their scopes, the scope, period and publication
 * the URL selects, and their notifications. The route's context provides it. */
export type ShellInitial = {
  viewerName: string;
  scopes: PlanningScopeSummary[];
  scope: PlanningScopeSummary | null;
  publications: PublicationRead[];
  selectedPublicationId: string | null;
  requestedPeriod: string;
  notifications: WorkspaceNotification[];
};

type Props = {
  initial: ShellInitial;
  screen: IdealScreen;
  view?: string;
  routeContext?: { publication?: string; case?: string; person?: string };
  children: ReactNode;
};

/**
 * The production workspace chrome is a Server Component. It contains only request-time
 * identity/scope context and navigation; interactive business controls remain isolated
 * below it. This prevents the whole application frame becoming one client bundle.
 */
export default function WorkspaceShell({ initial, screen, view, routeContext, children }: Props) {
  const scope = initial.scope;
  const role: IdealRole = scope?.role ?? "PHARMACIST";
  const allowed: readonly IdealScreen[] = scope ? WORKSPACE_NAV[role] : ["home"];
  const publication = initial.publications.find((item) => item.publication_id === initial.selectedPublicationId) ?? null;
  const selectedView = view ?? defaultWorkspaceView(screen, role);
  const currentView = workspaceViews[screen]?.find((item) => item.key === selectedView);
  const contextPeriod = initial.requestedPeriod;
  const scopeId = scope?.scope_id;
  const context = { scope: scopeId, period: contextPeriod, publication: publication?.publication_id, ...routeContext };
  const hrefFor = (key: IdealScreen) => {
    const targetView = defaultWorkspaceView(key, role);
    return workspaceHrefWithContext(`/workspace/${key}${targetView ? `/${targetView}` : ""}`, context);
  };
  const notices = initial.notifications.filter((item) => !item.read).length;
  const visibleViews = workspaceViews[screen]?.filter((item) => item.roles.includes(role)) ?? [];
  const viewLink = (item: (typeof visibleViews)[number], index: number) => <Link key={item.key} href={workspaceHrefWithContext(`/workspace/${screen}/${item.key}`, context)} aria-current={selectedView === item.key ? "page" : undefined}>
    {screen === "plan" && <span>{index + 1}</span>}<strong>{item.label}</strong>{item.short && <small>{item.short}</small>}
  </Link>;

  const nav = <nav aria-label="主要ナビゲーション" className="ideal-v3-nav">
    {allowed.map((key) => {
      const meta = screenMeta[key];
      const Icon = meta.icon;
      return <Link key={key} href={hrefFor(key)} aria-current={screen === key ? "page" : undefined}>
        <Icon aria-hidden="true" />
        <span><strong>{meta.label}</strong><small>{meta.hint}</small></span>
        {screen === key && <ChevronRight aria-hidden="true" />}
      </Link>;
    })}
  </nav>;

  return <div className="ideal-v3-app">
    <aside className="ideal-v3-sidebar">
      <Link className="ideal-v3-brand" href={hrefFor("home")} aria-label="PharmShiftMaker 今日へ">
        <span aria-hidden="true">Rx</span><span><strong>PharmShiftMaker</strong><small>勤務計画・運用支援</small></span>
      </Link>
      {nav}
    </aside>

    <header className="ideal-v3-mobile-header">
      <details className="ideal-v3-mobile-nav"><summary aria-label="メニューを開く"><Menu aria-hidden="true" /></summary><div>{nav}</div></details>
      <Link className="ideal-v3-brand" href={hrefFor("home")} aria-label="PharmShiftMaker 今日へ"><span aria-hidden="true">Rx</span><strong>PharmShiftMaker</strong></Link>
      <WorkspaceUserMenu compact name={initial.viewerName} role={roleLabels[role]} settingsHref={workspaceHrefWithContext("/workspace/settings/appearance", context)} notificationsHref={workspaceHrefWithContext("/workspace/settings/notifications", context)} notices={notices} />
    </header>

    <main id="main" tabIndex={-1} className="ideal-v3-main">
      <header className="ideal-v3-page-head">
        <div className="ideal-v3-title-block"><span className="ideal-eyebrow">{currentView?.label ?? screenMeta[screen].hint}</span><h1>{screenMeta[screen].label}</h1><p>{currentView?.description ?? screenMeta[screen].hint}</p></div>
        <WorkspaceUserMenu name={initial.viewerName} role={roleLabels[role]} settingsHref={workspaceHrefWithContext("/workspace/settings/appearance", context)} notificationsHref={workspaceHrefWithContext("/workspace/settings/notifications", context)} notices={notices} />
      </header>

      <section className="ideal-v3-context" aria-label="表示中の業務コンテキスト">
        <form method="get"><label>施設・部署<select name="scope" defaultValue={scopeId ?? ""}>{initial.scopes.map((item) => <option key={item.scope_id} value={item.scope_id}>{item.display_name}</option>)}</select></label>{contextPeriod && <input type="hidden" name="period" value={contextPeriod} />}<button type="submit">表示</button></form>
        <WorkspaceContextSummary period={contextPeriod} publication={publication ? { publication_id: publication.publication_id, version: publication.version, validation_status: publication.validation_status } : null} />
      </section>

      {workspaceViews[screen] && <nav className={`ideal-v3-subnav ${screen === "plan" ? "is-process" : ""}`} aria-label={`${screenMeta[screen].label}の機能`}>
        {screen === "settings" ? <><div className="ideal-v3-subnav-group"><span>個人設定</span>{visibleViews.filter((item) => ["appearance", "notifications"].includes(item.key)).map(viewLink)}</div><div className="ideal-v3-subnav-group"><span>施設・部署設定</span>{visibleViews.filter((item) => ["absence-consent", "flextime"].includes(item.key)).map(viewLink)}</div></> : visibleViews.map(viewLink)}
      </nav>}

      <div className="ideal-v3-content">{children}</div>
      <footer className="ideal-v3-footer"><span>PharmShiftMaker · 認知中心UI v3</span><span>日本語 · Asia/Tokyo · 実データの権限はサーバーで判定</span></footer>
    </main>
  </div>;
}
