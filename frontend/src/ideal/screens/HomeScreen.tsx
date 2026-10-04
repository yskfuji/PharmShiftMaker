import type { ReactNode } from "react";
import { Check, ChevronRight, Clock3, ShieldCheck } from "lucide-react";
import type { HomeModel } from "../model";
import type { IdealRole } from "../types";
import { Metric, StatusPill } from "./shared";

/** `queue`: the API-backed decision queue and consent requests, shown where the
 * synthetic model has its fixed queue. */
export default function HomeScreen({ role, model, queue }: { role: IdealRole; model: HomeModel; queue?: ReactNode }) {
  if (role === "PHARMACIST") {
    const home = model.personal;
    return (
      <div className="ideal-stack ideal-home-bands">
        <section className="ideal-home-band ideal-home-band--primary" aria-labelledby="personal-now-title">
          <div className="ideal-home-band__head"><div><span className="ideal-eyebrow">今日把握すること</span><h2 id="personal-now-title">次の勤務</h2></div><div className="ideal-hero__time"><Clock3 aria-hidden="true" /><strong>{home.when}</strong><span>{home.countdown}</span></div></div>
          <h3>{home.title}</h3><p>{home.detail}</p>
        </section>
        {queue && <section className="ideal-home-band" aria-labelledby="personal-action-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">今対応すること</span><h2 id="personal-action-title">同意と確認</h2></div></div>{queue}</section>}
        {home.request && <section className="ideal-panel"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">{home.request.eyebrow}</span><h2>{home.request.title}</h2></div><StatusPill tone="warn">{home.request.due}</StatusPill></div><p>{home.request.body}</p><div className="ideal-actions"><button className="ideal-button ideal-button--primary"><Check aria-hidden="true" />同意する</button><button className="ideal-button ideal-button--secondary">詳細を見る</button></div></section>}
        <section className="ideal-home-band" aria-labelledby="personal-recent-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">最近変わったこと</span><h2 id="personal-recent-title">自分の予定と休暇</h2></div></div><div className="ideal-grid ideal-grid--3">{home.metrics.map((m) => <Metric key={m.label} {...m} />)}</div></section>
      </div>
    );
  }
  const home = model.team;
  return (
    <div className="ideal-stack ideal-home-bands">
      <section className="ideal-home-summary">
        <div><span className="ideal-eyebrow">{home.eyebrow}</span><h2>{home.headline[role]}</h2><p>{home.detail}</p></div>
        <div className="ideal-hero__seal"><ShieldCheck aria-hidden="true" /><span>最終検証</span><strong>{home.sealTime}</strong></div>
      </section>
      <section className="ideal-home-band ideal-home-band--primary" aria-labelledby="home-actions-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">優先順・最大3件</span><h2 id="home-actions-title">今対応すること</h2></div>{home.priorities && <button className="ideal-link">すべて見る <ChevronRight aria-hidden="true" /></button>}</div>
        {home.priorities ? <ol className="ideal-priority-list">{home.priorities.slice(0, 3).map((item) => <li key={item.number}><span className="ideal-priority-list__number">{item.number}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div><StatusPill tone={item.tone}>{item.tag}</StatusPill></li>)}</ol> : (queue ?? <p className="ideal-note">判断待ちの項目はありません。</p>)}
      </section>
      <section className="ideal-home-band" aria-labelledby="home-today-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">勤務・申請・通知</span><h2 id="home-today-title">今日把握すること</h2></div></div><div className="ideal-grid ideal-grid--4">{home.metrics.map((m) => <Metric key={m.label} {...m} />)}</div></section>
      <section className="ideal-home-band ideal-home-band--quiet" aria-labelledby="home-recent-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">版と変更</span><h2 id="home-recent-title">最近変わったこと</h2></div></div>{home.stability ? <><div className="ideal-stability"><strong>{home.stability.value}</strong><span>{home.stability.label}</span></div><div className="ideal-mini-bars" aria-label="過去14日間の変更件数">{home.stability.bars.map((v, i) => <span key={i} className={v ? "is-change" : ""} title={`${i + 1}日前: ${v}件`} />)}</div><p className="ideal-note">{home.stability.note}</p></> : <p className="ideal-note">変更履歴を確認できません。</p>}</section>
    </div>
  );
}
