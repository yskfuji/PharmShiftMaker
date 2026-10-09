import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Menu } from "lucide-react";
import { roleLabels } from "@/ideal/data";
import { WORKSPACE_NAV } from "@/features/workspace/generated/usecaseRoutes";
import type { PublicationRead } from "@/ideal/api/contracts";
import { screenMeta } from "@/ideal/ui/atoms";
import type { IdealRole, IdealScreen, PlanningScopeSummary, WorkspaceNotification } from "@/ideal/types";
import { defaultWorkspaceView, workspaceRoute, workspaceViews } from "@/ideal/views";
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
  // The plan screen is a process: its views are numbered in the order of the contract, and
  // the one shown is the current one. Nothing here says that a stage is done: the frame does
  // not know it (a stage's own screen says what is finished), so a stage before the current
  // one looks and reads like one after it, a number and a name.
  const process = screen === "plan";
  const viewLink = (item: (typeof visibleViews)[number]) => <Link key={item.key} href={workspaceHrefWithContext(`/workspace/${screen}/${item.key}`, context)} aria-current={selectedView === item.key ? "page" : undefined}>
    {process && <span className="ideal-v3-subnav-step">{visibleViews.indexOf(item) + 1}</span>}<strong>{item.label}</strong>{item.short && <small>{item.short}</small>}
  </Link>;
  const viewGroup = (id: string, label: string, keys: string[]) => {
    const items = visibleViews.filter((item) => keys.includes(item.key));
    return items.length > 0 && <div className="ideal-v3-subnav-group" role="group" aria-labelledby={id}><span id={id} className="ideal-v3-subnav-label">{label}</span><div>{items.map(viewLink)}</div></div>;
  };
  // What this address is for. A screen without views (今日, 勤務表) has its sentence in the
  // contract as well; the hint of the main navigation is said there already.
  const purpose = currentView?.description ?? workspaceRoute(screen)?.description ?? screenMeta[screen].hint;

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
        <div className="ideal-v3-title-block"><h1>{screenMeta[screen].label}</h1><p>{purpose}</p></div>
        <WorkspaceUserMenu name={initial.viewerName} role={roleLabels[role]} settingsHref={workspaceHrefWithContext("/workspace/settings/appearance", context)} notificationsHref={workspaceHrefWithContext("/workspace/settings/notifications", context)} notices={notices} />
      </header>

      <section className="ideal-v3-context" aria-label="表示中の業務コンテキスト">
        <form method="get"><label>施設・部署<select name="scope" defaultValue={scopeId ?? ""}>{initial.scopes.map((item) => <option key={item.scope_id} value={item.scope_id}>{item.display_name}</option>)}</select></label>{contextPeriod && <input type="hidden" name="period" value={contextPeriod} />}<button type="submit">表示</button></form>
        <WorkspaceContextSummary period={contextPeriod} publication={publication ? { publication_id: publication.publication_id, version: publication.version, validation_status: publication.validation_status } : null} />
      </section>

      {workspaceViews[screen] && <nav className={process ? "ideal-v3-subnav is-process" : screen === "settings" ? "ideal-v3-subnav is-grouped" : "ideal-v3-subnav"} aria-label={`${screenMeta[screen].label}の機能`}>
        {screen === "settings" ? <>{viewGroup("settings-group-personal", "個人設定", ["appearance", "notifications"])}{viewGroup("settings-group-scope", "施設・部署設定", ["absence-consent", "flextime"])}</> : visibleViews.map(viewLink)}
      </nav>}

      <div className="ideal-v3-content">{children}</div>
      <footer className="ideal-v3-footer"><span>PharmShiftMaker</span><span>日本語 · 時刻は日本時間（Asia/Tokyo）</span></footer>
    </main>
  </div>;
}
