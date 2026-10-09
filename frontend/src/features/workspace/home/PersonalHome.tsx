import type { ReactNode } from "react";
import { ChevronRight, Clock3 } from "lucide-react";
import { Metric } from "@/ideal/ui/atoms";
import { routeOf } from "../shell/routeTypes";
import WorkspaceLink from "../shell/WorkspaceLink";
import type { PersonalHome as Personal } from "./model";

/** A pharmacist's home: the next duty, what is asked of them, and their own figures. */
export default function PersonalHome({ home, queue }: { home: Personal; queue: ReactNode }) {
  return <div className="ideal-stack ideal-home-bands">
    <section className="ideal-home-band ideal-home-band--primary" aria-labelledby="personal-now-title">
      <div className="ideal-home-band__head"><div><span className="ideal-eyebrow">今日把握すること</span><h2 id="personal-now-title">次の勤務</h2></div><div className="ideal-hero__time"><Clock3 aria-hidden="true" /><strong>{home.when}</strong><span>{home.countdown}</span></div></div>
      <h3>{home.title}</h3><p data-verbatim>{home.detail}</p>
    </section>
    <section className="ideal-home-band" aria-labelledby="personal-action-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">今対応すること</span><h2 id="personal-action-title">同意と確認</h2></div></div>{queue}</section>
    <section className="ideal-home-band" aria-labelledby="personal-recent-title"><div className="ideal-home-band__head"><div><span className="ideal-eyebrow">公開版の内容</span><h2 id="personal-recent-title">自分の勤務</h2></div><WorkspaceLink className="ideal-link ideal-link--target" route={routeOf("schedule/index").route}>勤務表で見る <ChevronRight aria-hidden="true" /></WorkspaceLink></div><div className="ideal-grid ideal-grid--3">{home.metrics.map((m) => <Metric key={m.label} {...m} />)}</div></section>
  </div>;
}
