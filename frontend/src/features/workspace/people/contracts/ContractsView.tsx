import { StatusPill } from "@/ideal/ui/atoms";
import SectionNav from "../../shared/SectionNav";
import SelectedPersonBand from "../../shared/SelectedPersonBand";
import TaskJump from "../../shared/TaskJump";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import { ContractOverview, FacilityRecords, RuleRecords } from "./CurrentRecords";
import History from "./History";
import type { Roster } from "./model";
import NextActions from "./NextActions";
import { PersonSelection } from "./Selection";
import StaffRecords from "./StaffRecords";
import { TASK_COUNT } from "./tasks";

/** How many of the listed records were saved on this screen (they carry a version); the
 * rest are values only the input version holds. A count of what the read returned. */
const saved = (records: Array<{ revision: number }>) => records.filter((item) => item.revision > 0).length;

/**
 * Contracts and qualifications: what is registered now (with the server's staging issues),
 * what can be done next, and the versions. A form opens only from "next"; every save is
 * confirmed in place. The records are the server's read of the route; the person the URL
 * names is chosen at first, and the band under the sections says so and leads out of it.
 *
 * The header says whether the server found an inconsistency and, when it did, leads to its
 * result. The row under it goes to each of the three sections; what it says beside a
 * section is a count of what the server returned, or of the tasks declared in ./tasks.
 */
export default function ContractsView({ data, ctx }: { data: Roster; ctx: RouteContext }) {
  const { staging } = data;
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><h2>記録の状態と次の操作</h2><p>職員・施設・規則の記録を、根拠と版を付けて登録します。記録が法令や計画の条件を満たすかどうかの検証結果は、「現在の状態」の先頭に出ます。</p></div>
      <div className="ideal-v3-badge-action">
        <StatusPill tone={staging.valid ? "good" : "warn"}>{staging.valid ? "記録の検証：不整合なし" : `記録の検証：不整合 ${staging.issues.length}件`}</StatusPill>
        {!staging.valid && <TaskJump target="contracts-current-staging-title">検証結果を見る</TaskJump>}
      </div>
    </section>
    <SectionNav items={[
      { target: "contracts-current-title", label: "現在の状態", meta: `職員${data.people.length}名（保存済み${saved(data.people)}名）・契約${data.contracts.length}件` },
      { target: "contracts-next-title", label: "次の操作", meta: `新しい職員の手順・操作${TASK_COUNT}件` },
      { target: "contracts-history-title", label: "履歴", meta: "現在の版と監査の履歴" },
    ]} />
    <SelectedPersonBand ctx={ctx} route={routeOf("people/contracts").route} />
    <PersonSelection initial={ctx.selectedPersonId}>
      <section className="ideal-panel" aria-labelledby="contracts-current-title">
        <h2 id="contracts-current-title" className="ideal-v3-section-nav__target" tabIndex={-1}>現在の状態</h2>
        <div className="ideal-v3-record ideal-v3-contracts-current">
          <section aria-labelledby="contracts-current-staging-title">
            <h3 id="contracts-current-staging-title" className="ideal-v3-heading ideal-v3-section-nav__target" tabIndex={-1}>記録の検証結果</h3>
            {staging.valid ? <p className="ideal-v3-callout">システムによる検証で、編集中の記録に不整合は見つかっていません。</p>
              : <div className="ideal-v3-callout ideal-v3-callout--warn ideal-v3-contracts-issues" role="alert">
                <p><StatusPill tone="warn">不整合</StatusPill><strong>編集中の記録に不整合があります</strong></p>
                <p>システムによる検証の結果です。記録は修正できますが、計画の入力への反映・生成・公開の前に解消してください。</p>
                <ul role="list" className="ideal-note-list">{staging.issues.map((issue, index) => <li key={index}>{issue.location}：{issue.message}</li>)}</ul>
              </div>}
          </section>
          <section aria-labelledby="contracts-current-staff-title">
            <h3 id="contracts-current-staff-title" className="ideal-v3-heading">職員ごとの記録</h3>
            <StaffRecords roster={data} />
          </section>
          <section aria-labelledby="contracts-current-overview-title">
            <h3 id="contracts-current-overview-title" className="ideal-v3-heading">契約と適用期間</h3>
            <p className="ideal-note">この部署の全員の契約です。制度と、原本・制度の根拠それぞれの確認状態を、登録されたとおりに表示します。</p>
            <ContractOverview roster={data} />
          </section>
          <section className="ideal-v3-contracts-half" aria-labelledby="contracts-current-facility-title">
            <h3 id="contracts-current-facility-title" className="ideal-v3-heading">施設の記録</h3>
            <FacilityRecords roster={data} />
          </section>
          <section className="ideal-v3-contracts-half" aria-labelledby="contracts-current-rules-title">
            <h3 id="contracts-current-rules-title" className="ideal-v3-heading">規則・協定・判断</h3>
            <RuleRecords roster={data} />
          </section>
        </div>
      </section>
      <section className="ideal-panel" aria-labelledby="contracts-next-title">
        <h2 id="contracts-next-title" className="ideal-v3-section-nav__target" tabIndex={-1}>次の操作</h2>
        <NextActions roster={data} />
      </section>
    </PersonSelection>
    <section className="ideal-panel" aria-labelledby="contracts-history-title">
      <h2 id="contracts-history-title" className="ideal-v3-section-nav__target" tabIndex={-1}>履歴</h2>
      <History roster={data} />
    </section>
  </div>;
}
