import { ChevronRight } from "lucide-react";
import type { ScheduleChangeCase } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import CaseActions from "../shared/changeCases/CaseActions";
import CaseNotice from "../shared/changeCases/CaseNotice";
import CaseSummary from "../shared/changeCases/CaseSummary";
import { nameOf, routeOf, type RouteContext } from "../shell/routeTypes";
import WorkspaceLink from "../shell/WorkspaceLink";
import { homeQueue } from "./model";

/** The states an open case waits in, in the order a planner meets them. `next` says in
 * plain words who does what next: a note of the row's state, set as text beside a dot (not
 * as a button-shaped pill: only the row itself is pressed); `tone` is the colour of the dot
 * while the count is not zero. Declared here; the counts are the server's cases, by state. */
const WAITING = [
  { status: "READY", title: "承認待ち", detail: "同意がそろい、承認すると新しい公開版になるケース", next: "責任者が承認する", tone: "good" },
  { status: "AWAITING_INDEPENDENT_APPROVAL", title: "別担当の承認待ち", detail: "作成者・対象者とは別の責任者が最終判断するケース", next: "別の責任者が承認する", tone: "warn" },
  { status: "AWAITING_CONSENT", title: "同意待ち", detail: "関係者の同意を待っているケース", next: "関係者の返事を待つ", tone: "warn" },
  { status: "DRAFT", title: "指摘あり", detail: "検証で指摘があり、公開できないケース（取り下げて作り直す）", next: "取り下げて作り直す", tone: "danger" },
] as const;

/** The consents asked of the viewer, and for a planner how many open cases wait in each
 * state. `cases` is null when they could not be read: then nothing is claimed about them.
 * A state that has cases leads to the route where they are decided. */
export default function HomeQueue({ cases, ctx }: { cases: ScheduleChangeCase[] | null; ctx: RouteContext }) {
  if (!cases) return <p className="ideal-note">欠勤・交換のケースを確認できません。</p>;
  const planner = ctx.role !== "PHARMACIST";
  const { asked, counts } = homeQueue(cases, ctx.scope.person_id);
  const decide = routeOf("operations/cases").route;
  return <CaseNotice>
    <div className="ideal-stack">
      {asked.length > 0 && <section className="ideal-panel" aria-labelledby="asked-title">
        <div className="ideal-panel__head"><div><h2 id="asked-title">同意が必要な勤務</h2></div><StatusPill tone="warn">{asked.length}件</StatusPill></div>
        <div className="ideal-case-list">{asked.map((c) => <article key={c.case_id}><CaseSummary c={c} nameOf={(person) => nameOf(ctx, person)} planner={planner} /><CaseActions c={c} verbs={["consent", "decline"]} /></article>)}</div>
      </section>}
      {planner && <section className="ideal-panel" aria-labelledby="queue-title">
        <div className="ideal-panel__head"><div><h2 id="queue-title">次に判断すること</h2></div>
          <WorkspaceLink className="ideal-link ideal-link--target" route={routeOf("operations/cases").route}>当日運用で開く <ChevronRight aria-hidden="true" /></WorkspaceLink></div>
        <p className="ideal-note">進行中のケースすべてを、待っている状態ごとに数えています（今日以外の勤務のケースも含みます）。件数のある行から、当日運用のケース一覧を開けます。</p>
        <ol className="ideal-priority-list">
          {WAITING.map((row) => {
            const count = counts[row.status];
            const said = <><span className="ideal-priority-list__number">{count}</span><div><strong>{row.title}</strong><p>{row.detail}</p></div><span className="ideal-v3-home-next"><i className={`ideal-dot ideal-dot--${count ? row.tone : "neutral"}`} />{row.next}</span></>;
            return <li key={row.status}>{count > 0
              ? <WorkspaceLink className="ideal-v3-home-waiting" route={decide}>{said}<ChevronRight aria-hidden="true" /></WorkspaceLink>
              : <div className="ideal-v3-home-waiting">{said}</div>}</li>;
          })}
        </ol>
      </section>}
      {!planner && !asked.length && <p className="ideal-note">あなたに同意を求めている申請はありません。</p>}
    </div>
  </CaseNotice>;
}
