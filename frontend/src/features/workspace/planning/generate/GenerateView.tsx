import { useId } from "react";
import { StatusPill } from "@/ideal/ui/atoms";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { BUDGET_SECONDS } from "./budget";
import { periodDays } from "../input/period";
import GenerateJobs from "./GenerateJobs";

export type GenerateData = {
  revision: number; inputHash: string; stale: boolean;
  /** The period of the input version, as the server holds it; null when it has none. */
  period: { start: string; end: string } | null;
  /** What the input version holds: the lengths of its own lists. */
  counts: { people: number; demands: number; candidates: number };
};

/** Three plans from one input version: which input they are made from, what pressing the
 * action does and what follows, then the one action. A stale input is said here, with the
 * way to a current one, and cannot be used. What is said of the action was read in the
 * server: every press queues three new jobs, a finished job saves a new plan under a new
 * identifier, and no plan that exists is removed or replaced (application/planning.py,
 * enqueue and finish_job). */
export default function GenerateView({ data }: { data: GenerateData }) {
  const id = useId();
  return <div className="ideal-stack">
    <section className="ideal-panel" aria-labelledby={`${id}-generate`}>
      <div className="ideal-panel__head ideal-v3-planning-head"><div><span className="ideal-eyebrow">入力版 第{data.revision}版</span><h2 id={`${id}-generate`}>同じ前提から3案を作成</h2><p>同じ入力版と同じ優先順で、探し始める位置だけを変えた案を3つ作ります。結果が同じになった案は、比較の画面で重複として示します。</p></div><StatusPill tone={data.stale ? "warn" : "good"}>{data.stale ? "入力が古い" : "生成可能"}</StatusPill></div>
      <dl className="ideal-definition-list ideal-v3-planning-generate-input">
        <div><dt>もとにする入力版</dt><dd>入力版 第{data.revision}版（職員 {data.counts.people}名・必要配置 {data.counts.demands}件・勤務候補 {data.counts.candidates}件）</dd></div>
        <div><dt>対象期間</dt><dd>{data.period ? periodDays(data.period) : "未確認"}</dd></div>
      </dl>
      {data.stale && <p className="ideal-v3-callout ideal-v3-callout--warn">この入力版は古くなっているため、案を作れません。<WorkspaceLink className="ideal-inline-link" route={routeOf("plan/input").route}>前提・取込</WorkspaceLink>で新しい入力版を作ってから、この画面を開き直してください。</p>}
      <ul className="ideal-note-list ideal-v3-planning-generate-steps" aria-label="押したあとに起きること">
        <li>「3つの案を作る」を押すと、新しい案を3つ作り始めます。すでにある案は消えず、置き換わりません。</li>
        <li>1案あたりの探索は最長{BUDGET_SECONDS}秒です（順番待ちの時間は別です）。進み具合はこの下に出て、作成中の案は中止できます。</li>
        <li>3つそろうと「3案を同じ定義で比較」が出て、次の工程で見比べられます。</li>
      </ul>
      <GenerateJobs inputHash={data.inputHash} stale={data.stale} />
    </section>
  </div>;
}
