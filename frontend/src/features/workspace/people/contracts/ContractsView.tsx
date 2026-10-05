import { StatusPill } from "@/ideal/ui/atoms";
import type { RouteContext } from "../../shell/routeTypes";
import { ContractOverview, FacilityRecords, RuleRecords } from "./CurrentRecords";
import History from "./History";
import type { Roster } from "./model";
import NextActions from "./NextActions";
import { PersonSelection } from "./Selection";
import StaffRecords from "./StaffRecords";

/**
 * Contracts and qualifications: what is registered now (with the server's staging issues),
 * what can be done next, and the versions. A form opens only from "next"; every save is
 * confirmed in place. The records are the server's read of the route; the person the URL
 * names is chosen at first.
 */
export default function ContractsView({ data, ctx }: { data: Roster; ctx: RouteContext }) {
  const { staging } = data;
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><span className="ideal-eyebrow">契約・資格</span><h2>記録の状態と次の操作</h2><p>職員・施設・規則の記録を、根拠と版を付けて登録します。記録が法令や計画の条件を満たすかどうかは、サーバーが検証します。</p></div>
      <StatusPill tone={staging.valid ? "good" : "warn"}>{staging.valid ? "サーバーの検証で不整合なし" : `サーバーの検証で不整合 ${staging.issues.length}件`}</StatusPill>
    </section>
    <PersonSelection initial={ctx.selectedPersonId}>
      <section className="ideal-panel" aria-labelledby="contracts-current-title">
        <h2 id="contracts-current-title">現在の状態</h2>
        <div className="ideal-v3-record">
          <section aria-labelledby="contracts-current-staging-title">
            <h3 id="contracts-current-staging-title" className="ideal-v3-heading">サーバーの検証結果</h3>
            {staging.valid ? <p className="ideal-note">サーバーの検証で、編集中の記録に不整合は見つかっていません。</p>
              : <div className="ideal-inline-problem" role="alert">
                <StatusPill tone="warn">不整合</StatusPill>
                <div><strong>編集中の記録に不整合があります</strong><p>サーバーの検証結果です。記録は修正できますが、計画の入力への反映・生成・公開の前に解消してください。</p>
                  <ul className="ideal-note-list">{staging.issues.map((issue, index) => <li key={index}>{issue.location}：{issue.message}</li>)}</ul></div>
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
          <section aria-labelledby="contracts-current-facility-title">
            <h3 id="contracts-current-facility-title" className="ideal-v3-heading">施設の記録</h3>
            <FacilityRecords roster={data} />
          </section>
          <section aria-labelledby="contracts-current-rules-title">
            <h3 id="contracts-current-rules-title" className="ideal-v3-heading">規則・協定・判断</h3>
            <RuleRecords roster={data} />
          </section>
        </div>
      </section>
      <section className="ideal-panel" aria-labelledby="contracts-next-title">
        <h2 id="contracts-next-title">次の操作</h2>
        <NextActions roster={data} />
      </section>
    </PersonSelection>
    <section className="ideal-panel" aria-labelledby="contracts-history-title">
      <h2 id="contracts-history-title">履歴</h2>
      <History roster={data} />
    </section>
  </div>;
}
