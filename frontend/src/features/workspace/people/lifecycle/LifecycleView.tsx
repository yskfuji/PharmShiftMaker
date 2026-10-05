import type { LifecycleCase } from "@/ideal/types";
import { nameOf, type RouteContext } from "../../shell/routeTypes";
import LifecycleCard from "./LifecycleCard";
import LifecycleForm from "./LifecycleForm";

/** Onboarding and offboarding cases of the scope (of the person the URL names, when it
 * names one), and the form that starts another. */
export default function LifecycleView({ data, ctx }: { data: LifecycleCase[]; ctx: RouteContext }) {
  const person = ctx.selectedPersonId;
  const list = person ? data.filter((c) => c.person_id === person) : data;
  return <div className="ideal-stack">
    <section className="ideal-panel" aria-labelledby="lifecycle-title">
      <div className="ideal-panel__head"><div><span className="ideal-eyebrow">入職・退職</span><h2 id="lifecycle-title">手続きのケース</h2></div></div>
      {list.length ? <div className="ideal-lifecycle-list">{list.map((c) => <LifecycleCard key={c.case_id} c={c} name={nameOf(ctx, c.person_id)} />)}</div> : <p className="ideal-note">{person ? "選択した職員に進行中の手続きはありません。" : "進行中の手続きはありません。"}</p>}
      <details className="ideal-v3-disclosure"><summary>新しい入職・退職手続きを始める</summary><LifecycleForm initialPersonId={person} /></details>
    </section>
  </div>;
}
