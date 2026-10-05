import { ChevronRight } from "lucide-react";
import type { ScheduleChangeCase } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import CaseActions from "../shared/changeCases/CaseActions";
import CaseNotice from "../shared/changeCases/CaseNotice";
import CaseSummary from "../shared/changeCases/CaseSummary";
import { nameOf, routeOf, type RouteContext } from "../shell/routeTypes";
import WorkspaceLink from "../shell/WorkspaceLink";
import { homeQueue } from "./model";

/** The consents asked of the viewer, and for a planner how many open cases wait in each
 * state. `cases` is null when they could not be read: then nothing is claimed about them. */
export default function HomeQueue({ cases, ctx }: { cases: ScheduleChangeCase[] | null; ctx: RouteContext }) {
  if (!cases) return <p className="ideal-note">欠勤・交換のケースを確認できません。</p>;
  const planner = ctx.role !== "PHARMACIST";
  const { asked, counts } = homeQueue(cases, ctx.scope.person_id);
  return <CaseNotice>
    <div className="ideal-stack">
      {asked.length > 0 && <section className="ideal-panel" aria-labelledby="asked-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">あなたへの依頼</span><h2 id="asked-title">同意が必要な勤務</h2></div><StatusPill tone="warn">{asked.length}件</StatusPill></div>
        <div className="ideal-case-list">{asked.map((c) => <article key={c.case_id}><CaseSummary c={c} nameOf={(person) => nameOf(ctx, person)} planner={planner} /><CaseActions c={c} verbs={["consent", "decline"]} /></article>)}</div>
      </section>}
      {planner && <section className="ideal-panel" aria-labelledby="queue-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">判断待ち</span><h2 id="queue-title">次に判断すること</h2></div>
          <WorkspaceLink className="ideal-link ideal-link--target" route={routeOf("operations/cases").route}>当日運用で開く <ChevronRight aria-hidden="true" /></WorkspaceLink></div>
        <ol className="ideal-priority-list">
          <li><span className="ideal-priority-list__number">{counts.READY}</span><div><strong>承認待ち</strong><p>同意がそろい、承認すると新しい公開版になるケース</p></div><StatusPill tone={counts.READY ? "good" : "neutral"}>承認</StatusPill></li>
          <li><span className="ideal-priority-list__number">{counts.AWAITING_INDEPENDENT_APPROVAL}</span><div><strong>別担当の承認待ち</strong><p>作成者・対象者とは別の責任者が最終判断するケース</p></div><StatusPill tone={counts.AWAITING_INDEPENDENT_APPROVAL ? "warn" : "neutral"}>四つの目</StatusPill></li>
          <li><span className="ideal-priority-list__number">{counts.AWAITING_CONSENT}</span><div><strong>同意待ち</strong><p>関係者の同意を待っているケース</p></div><StatusPill tone={counts.AWAITING_CONSENT ? "warn" : "neutral"}>待機</StatusPill></li>
          <li><span className="ideal-priority-list__number">{counts.DRAFT}</span><div><strong>指摘あり</strong><p>サーバーの検証で公開できないケース（取り下げて作り直す）</p></div><StatusPill tone={counts.DRAFT ? "danger" : "neutral"}>要対応</StatusPill></li>
        </ol>
      </section>}
      {!planner && !asked.length && <p className="ideal-note">あなたに同意を求めている申請はありません。</p>}
    </div>
  </CaseNotice>;
}
