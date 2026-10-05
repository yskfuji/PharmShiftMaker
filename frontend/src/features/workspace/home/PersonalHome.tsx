import type { ReactNode } from "react";
import { Clock3 } from "lucide-react";
import { Metric } from "@/ideal/ui/atoms";
import type { PersonalHome as Personal } from "./model";

/** A pharmacist's home: the next duty, what is asked of them, and their own figures. */
export default function PersonalHome({ home, queue }: { home: Personal; queue: ReactNode }) {
  return <div className="ideal-stack ideal-home-bands">
    <section className="ideal-home-band ideal-home-band--primary" aria-labelledby="personal-now-title">
      <div className="ideal-home-band__head"><div><span className="ideal-eyebrow">今日把握すること</span><h2 id="personal-now-title">次の勤務</h2></div><div className="ideal-hero__time"><Clock3 aria-hidden="true" /><strong>{home.when}</strong><span>{home.countdown}</span></div></div>
      <h3>{home.title}</h3><p>{home.detail}</p>
    </section>
    <section className="ideal-home-band" aria-labelledby="personal-action-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">今対応すること</span><h2 id="personal-action-title">同意と確認</h2></div></div>{queue}</section>
    <section className="ideal-home-band" aria-labelledby="personal-recent-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">最近変わったこと</span><h2 id="personal-recent-title">自分の予定と休暇</h2></div></div><div className="ideal-grid ideal-grid--3">{home.metrics.map((m) => <Metric key={m.label} {...m} />)}</div></section>
  </div>;
}
