import type { ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { Metric } from "@/ideal/ui/atoms";
import type { TeamHome as Team } from "./model";

/** A planner's home: the publication on screen, what waits for a decision, today's counts
 * and recent changes. */
export default function TeamHome({ home, queue }: { home: Team; queue: ReactNode }) {
  return <div className="ideal-stack ideal-home-bands">
    <section className="ideal-home-summary">
      <div><span className="ideal-eyebrow">{home.eyebrow}</span><h2>{home.headline}</h2><p>{home.detail}</p></div>
      <div className="ideal-hero__seal"><ShieldCheck aria-hidden="true" /><span>最終検証</span><strong>{home.sealTime}</strong></div>
    </section>
    <section className="ideal-home-band ideal-home-band--primary" aria-labelledby="home-actions-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">優先順・最大3件</span><h2 id="home-actions-title">今対応すること</h2></div></div>
      {queue}
    </section>
    <section className="ideal-home-band" aria-labelledby="home-today-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">勤務・申請・通知</span><h2 id="home-today-title">今日把握すること</h2></div></div><div className="ideal-grid ideal-grid--4">{home.metrics.map((m) => <Metric key={m.label} {...m} />)}</div></section>
    <section className="ideal-home-band ideal-home-band--quiet" aria-labelledby="home-recent-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">版と変更</span><h2 id="home-recent-title">最近変わったこと</h2></div></div>{home.stability ? <><div className="ideal-stability"><strong>{home.stability.value}</strong><span>{home.stability.label}</span></div><div className="ideal-mini-bars" aria-label="過去14日間の変更件数">{home.stability.bars.map((v, i) => <span key={i} className={v ? "is-change" : ""} title={`${i + 1}日前: ${v}件`} />)}</div><p className="ideal-note">{home.stability.note}</p></> : <p className="ideal-note">変更履歴を確認できません。</p>}</section>
  </div>;
}
