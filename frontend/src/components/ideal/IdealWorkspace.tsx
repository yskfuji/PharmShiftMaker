"use client";

import { useState } from "react";
import ContextLink from "@/components/ContextLink";
import { browserNavigation } from "@/lib/browserNavigation";
import { Bell, ChevronRight, Menu, Settings, ShieldCheck, Sparkles, X } from "lucide-react";
import { roleLabels } from "@/ideal/data";
import { useWorkspace } from "@/ideal/providers/WorkspaceContext";
import GovernanceScreen from "@/ideal/screens/GovernanceScreen";
import HomeScreen from "@/ideal/screens/HomeScreen";
import OperationsScreen from "@/ideal/screens/OperationsScreen";
import PeopleScreen from "@/ideal/screens/PeopleScreen";
import PlanScreen from "@/ideal/screens/PlanScreen";
import RequestsScreen from "@/ideal/screens/RequestsScreen";
import ScheduleScreen from "@/ideal/screens/ScheduleScreen";
import SettingsScreen from "@/ideal/screens/SettingsScreen";
import { EmptyState, LoadingState, ProblemState, screenMeta } from "@/ideal/screens/shared";
import { LiveGovernance, LivePeople, LiveSettings } from "@/ideal/screens/live/LiveAdminScreens";
import { LiveHomeQueue, LiveOperations, LiveRequests } from "@/ideal/screens/live/LiveCaseScreens";
import { LivePlan } from "@/ideal/screens/live/LivePlan";
import IntegratedFeatureView from "@/ideal/screens/live/IntegratedFeatureView";
import { syntheticProblems } from "@/ideal/synthetic";
import type { LiveApi } from "@/ideal/live/context";
import type { WorkspaceModel } from "@/ideal/model";
import type { IdealRole, IdealScreen, ShowcaseState } from "@/ideal/types";
import { defaultWorkspaceView, workspaceViews } from "@/ideal/views";

const stateLabels: Record<ShowcaseState, string> = {
  ready: "正常",
  empty: "空",
  loading: "読込中",
  failure: "通信失敗",
  conflict: "版競合",
  forbidden: "権限なし",
};

type Props = {
  initialScreen?: IdealScreen;
  initialRole?: IdealRole;
  initialState?: ShowcaseState;
  initialView?: string;
  showLabControls?: boolean;
  /** The production entry (/workspace): each screen is its own URL, loaded natively (like
   * the production navigation, so the unsaved-changes guard applies) and carrying the scope,
   * so back, bookmarks and titles follow the screens. Otherwise screens switch in place. */
  entry?: boolean;
};

function Screen({ screen, view, role, model, live, onNavigate, entry }: { screen: IdealScreen; view?: string; role: IdealRole; model: WorkspaceModel; live: LiveApi | null; onNavigate: (screen: IdealScreen) => void; entry: boolean }) {
  if (live && view) return <IntegratedFeatureView screen={screen} view={view} live={live} />;
  switch (screen) {
    case "home": return <HomeScreen role={role} model={model.home} queue={live && <LiveHomeQueue live={live} onNavigate={onNavigate} linkTo={entry ? (s) => `/workspace/${s}` : undefined} />} />;
    case "schedule": return <ScheduleScreen role={role} model={model.schedule} />;
    default:
      // With the API, each screen reads and changes through the server; the synthetic
      // screens below are the showcase's fixed content.
      if (live) {
        switch (screen) {
          case "plan": return <LivePlan live={live} view="generate" />;
          case "operations": return <LiveOperations live={live} />;
          case "requests": return <LiveRequests live={live} />;
          case "people": return <LivePeople live={live} />;
          case "governance": return <LiveGovernance live={live} />;
          case "settings": return <LiveSettings live={live} />;
        }
      }
      switch (screen) {
        case "plan": return <PlanScreen />;
        case "operations": return <OperationsScreen />;
        case "requests": return <RequestsScreen role={role} />;
        case "people": return <PeopleScreen />;
        case "governance": return <GovernanceScreen />;
        case "settings": return <SettingsScreen />;
      }
  }
}

/**
 * The ideal workspace shell. Data comes from the surrounding provider: synthetic content
 * (the default, used by Storybook and /showcase) or the viewer's scope from the API.
 */
export default function IdealWorkspace({ initialScreen = "home", initialRole = "LEADER", initialState = "ready", initialView, showLabControls = false, entry = false }: Props) {
  const source = useWorkspace();
  const synthetic = source.source === "synthetic";
  const [screen, setScreen] = useState<IdealScreen>(initialScreen);
  const [labRole, setLabRole] = useState<IdealRole>(initialRole);
  const [state, setState] = useState<ShowcaseState>(initialState);
  const [menuOpen, setMenuOpen] = useState(false);
  const model = source.model;
  if (!model) {
    return <div className="ideal-app"><main className="ideal-main" id="main" tabIndex={-1}>
      {source.selectionRequired ? <section className="ideal-panel ideal-scope-choice" aria-labelledby="scope-choice-title"><span className="ideal-eyebrow">勤務場所</span><h1 id="scope-choice-title">施設・部署を選んでください</h1><p>複数の所属があります。表示する範囲を選ぶまで、勤務情報は読み込みません。</p><div className="ideal-scope-choice__items">{source.scopes.map((scope) => <button type="button" className="ideal-button ideal-button--secondary" key={scope.scope_id} onClick={() => source.chooseScope(scope.scope_id)}><span><strong>{scope.display_name}</strong><small>{roleLabels[scope.role]}</small></span><ChevronRight aria-hidden="true" /></button>)}</div></section> : source.problem ? <ProblemState problem={source.problem} onAction={source.reload} /> : <LoadingState />}
    </main></div>;
  }
  const role = synthetic ? labRole : (source.role ?? "PHARMACIST");
  const allowed = model.shell.nav[role];
  // The showcase may display any screen (e.g. a 403 example); the API view only its own nav.
  // The entry has one URL per screen: a screen outside the viewer's role is said so, not
  // replaced by another one under the same URL.
  const selectedView = initialView ?? (entry ? defaultWorkspaceView(screen, role) : undefined);
  const selectedViewMeta = selectedView ? workspaceViews[screen]?.find((item) => item.key === selectedView) : undefined;
  const refused = entry && !synthetic && (!allowed.includes(screen) || Boolean(selectedViewMeta && !selectedViewMeta.roles.includes(role)));
  const current = synthetic || allowed.includes(screen) || refused ? screen : allowed[0];
  const chooseRole = (next: IdealRole) => { setLabRole(next); if (!model.shell.nav[next].includes(screen)) setScreen("home"); };
  // A reload after a change keeps the screen (and its confirmation) in place; the first
  // load, before any model exists, is handled above.
  const view: ShowcaseState = synthetic ? state : "ready";
  const shell = model.shell;
  return <div className="ideal-app">
    <header className="ideal-mobile-header"><button aria-label="メニューを開く" onClick={()=>setMenuOpen(true)}><Menu aria-hidden="true"/></button><div className="ideal-brand"><span>Rx</span><strong>PharmShiftMaker</strong></div><ContextLink className="ideal-icon-button" aria-label="通知を見る" href="/workspace/settings/notifications"><Bell aria-hidden="true"/>{shell.notifications > 0 && <i>{shell.notifications}</i>}</ContextLink></header>
    <aside className={`ideal-sidebar ${menuOpen?"is-open":""}`}>
      <div className="ideal-brand"><span>Rx</span><div><strong>PharmShiftMaker</strong><small>勤務計画・運用支援</small></div></div>
      <button className="ideal-sidebar__close" aria-label="メニューを閉じる" onClick={()=>setMenuOpen(false)}><X aria-hidden="true"/></button>
      <nav aria-label="主要ナビゲーション">{allowed.map(key=>{const meta=screenMeta[key];const Icon=meta.icon;const defaultView=defaultWorkspaceView(key, role);const href=defaultView?`/workspace/${key}/${defaultView}`:`/workspace/${key}`;const inner=<><Icon aria-hidden="true"/><span><strong>{meta.label}</strong><small>{meta.hint}</small></span>{current===key&&<ChevronRight aria-hidden="true"/>}</>;return entry
        ? <ContextLink key={key} href={href} className={`ideal-nav-link ${current===key?"is-current":""}`} aria-current={current===key?"page":undefined}>{inner}</ContextLink>
        : <button key={key} className={current===key?"is-current":""} aria-current={current===key?"page":undefined} onClick={()=>{setScreen(key);setMenuOpen(false)}}>{inner}</button>})}
        {entry&&<ContextLink className="ideal-classic-link" href="/planning">従来の画面へ</ContextLink>}</nav>
      <div className="ideal-sidebar__profile"><span className="ideal-avatar">{shell.user.initial}</span><div><strong>{shell.user.name}</strong><small>{roleLabels[role]}</small></div>{entry ? <ContextLink href="/workspace/settings/appearance" aria-label="アカウント設定"><Settings aria-hidden="true"/></ContextLink> : <button aria-label="アカウント設定"><Settings aria-hidden="true"/></button>}</div>
    </aside>
    {menuOpen&&<button className="ideal-backdrop" aria-label="メニューを閉じる" onClick={()=>setMenuOpen(false)}/>}
    <main className="ideal-main" id="main" tabIndex={-1}>
      {/* The evaluation controls sit in the flow above the page, so they never cover content. */}
      {showLabControls && synthetic && <aside className="ideal-lab" aria-label="ショーケース設定"><strong><Sparkles aria-hidden="true"/>UI Lab</strong><label>役割<select value={role} onChange={e=>chooseRole(e.target.value as IdealRole)}>{Object.entries(roleLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>状態<select value={state} onChange={e=>setState(e.target.value as ShowcaseState)}>{Object.entries(stateLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></aside>}
      <header className="ideal-page-head"><div>{source.scopes.length > 1 && source.scope ? <label className="ideal-scope-switch"><span>施設・部署</span><select aria-label="施設・部署" value={source.scope.scope_id} onChange={(event) => source.chooseScope(event.target.value)}>{source.scopes.map((scope) => <option key={scope.scope_id} value={scope.scope_id}>{scope.display_name}（{roleLabels[scope.role]}）</option>)}</select></label> : <span className="ideal-eyebrow">{shell.scopeLabel}</span>}<h1>{screenMeta[current].label}</h1><p>{screenMeta[current].hint}</p></div><div className="ideal-page-head__actions">{entry ? <ContextLink className="ideal-icon-button" aria-label="通知を見る" href="/workspace/settings/notifications"><Bell aria-hidden="true"/>{shell.notifications > 0 && <i>{shell.notifications}</i>}</ContextLink> : <button className="ideal-icon-button" aria-label="通知を見る"><Bell aria-hidden="true"/>{shell.notifications > 0 && <i>{shell.notifications}</i>}</button>}<div className="ideal-version"><span>公開版</span><strong>{shell.publication.version}</strong><small>{shell.publication.note}</small></div></div></header>
      {entry && workspaceViews[current] && <nav className="ideal-subnav" aria-label={`${screenMeta[current].label}の機能`}>{workspaceViews[current]!.filter((item) => item.roles.includes(role)).map((item) => <ContextLink key={item.key} href={`/workspace/${current}/${item.key}`} aria-current={selectedView === item.key ? "page" : undefined}>{item.label}</ContextLink>)}</nav>}
      {showLabControls&&synthetic&&<div className="ideal-synthetic"><ShieldCheck aria-hidden="true"/><span><strong>合成データ・評価用</strong> 実在する職員・施設の情報は含みません</span></div>}
      {source.problem ? <ProblemState problem={source.problem} onAction={source.reload}/>
        : view==="ready"
          ? (refused
            ? <ProblemState problem={{ kind: "forbidden", code: "403", title: "この画面は、あなたの役割では開けません", body: "左の一覧から、開ける画面を選んでください。", action: "今日へ" }} onAction={()=>browserNavigation.replace("/workspace/home")}/>
            : <Screen screen={current} view={selectedView} role={role} model={model} live={source.live} onNavigate={setScreen} entry={entry}/>)
          : view==="empty"
            ? <EmptyState screen={current} onRefresh={source.reload}/>
            : view==="loading"
              ? <LoadingState/>
              : <ProblemState problem={syntheticProblems[view]}/>}
      <footer className="ideal-footer"><span>{shell.footer[0]}</span><span>{shell.footer[1]}</span></footer>
    </main>
  </div>;
}
