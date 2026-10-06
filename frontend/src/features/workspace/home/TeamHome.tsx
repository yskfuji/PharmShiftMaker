import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { routeOf } from "../shell/routeTypes";
import WorkspaceLink from "../shell/WorkspaceLink";
import type { HomeMetric, TeamHome as Team } from "./model";

/** Where a figure leads: the route that shows what it counts, and the words of the link.
 * Both are routes the home's contract names as its ways out. */
const WAY = {
  schedule: { route: routeOf("schedule/index").route, label: "勤務表で見る" },
  cases: { route: routeOf("operations/cases").route, label: "欠勤・交換を開く" },
  today: { route: routeOf("operations/today").route, label: "今日の予定を開く" },
  leave: { route: routeOf("requests/leave").route, label: "休暇の申請を開く" },
} as const;

/** A figure as a tile: its name, the figure, what it counts and, where a route shows it,
 * the way there. */
function Tile({ link, ...metric }: HomeMetric) {
  return <article className={`ideal-metric ideal-metric--${metric.tone ?? "neutral"}`}><p>{metric.label}</p><strong>{metric.value}</strong><span>{metric.detail}</span>
    {link && <WorkspaceLink className="ideal-link ideal-link--target" route={WAY[link].route}>{WAY[link].label} <ChevronRight aria-hidden="true" /></WorkspaceLink>}</article>;
}

/** A planner's home: today and what waits for the viewer, the requests and cases, the
 * day's counts and the recent records. Which publication is on screen, and that it was
 * verified, is said by the frame above; here it is said only when it needs attention. */
export default function TeamHome({ home, queue }: { home: Team; queue: ReactNode }) {
  return <div className="ideal-stack ideal-home-bands">
    <section className="ideal-home-summary" aria-labelledby="home-day-title">
      <div><h2 id="home-day-title">{home.heading}</h2>{home.needs && <p>{home.needs}</p>}</div>
      {home.publication && <p className="ideal-v3-callout ideal-v3-callout--warn">{home.publication}</p>}
    </section>
    <section className="ideal-home-band ideal-home-band--primary" aria-labelledby="home-actions-title"><div className="ideal-home-band__head"><div><h2 id="home-actions-title">今対応すること</h2></div></div>
      {queue}
    </section>
    <section className="ideal-home-band" aria-labelledby="home-today-title"><div className="ideal-home-band__head"><div><h2 id="home-today-title">今日把握すること</h2></div></div><div className="ideal-grid ideal-grid--4">{home.metrics.map((m) => <Tile key={m.label} {...m} />)}</div></section>
    <section className="ideal-home-band ideal-home-band--quiet" aria-labelledby="home-recent-title"><div className="ideal-home-band__head"><div><h2 id="home-recent-title">最近変わったこと</h2></div>
      <WorkspaceLink className="ideal-link ideal-link--target" route={WAY.schedule.route}>勤務表で変更された勤務を見る <ChevronRight aria-hidden="true" /></WorkspaceLink></div>{home.stability ? <>
      <p className="ideal-stability"><span>{home.stability.window}</span> <strong>欠勤・交換の記録 {home.stability.value}</strong><span> · {home.stability.label}</span></p>
      {home.stability.changes.length > 0 && <ul className="ideal-v3-home-changes" aria-label="記録があった日">{home.stability.changes.map((change, position) => <li key={`${position}-${change.day}`}><span>{change.day}</span><strong>{change.count}</strong></li>)}</ul>}
      <p className="ideal-note">{home.stability.note}</p>
    </> : <p className="ideal-note">変更履歴を確認できません。</p>}</section>
  </div>;
}
