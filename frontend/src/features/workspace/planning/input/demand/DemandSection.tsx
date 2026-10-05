import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../../shell/WorkspaceLink";
import { jstText } from "../../../shared/jst";
import { EVIDENCE_STATUS } from "../../../shared/records/evidence";
import { routeOf } from "../../../shell/routeTypes";
import DemandEditor from "./DemandEditor";
import type { DemandState } from "./model";

/**
 * The required staffing of the input version being planned: what is registered now (with
 * each record's version and the server's staging issues), the next step, and where the
 * versions are kept. The form is not shown until the next step is opened. `state` is null
 * when the records could not be read: then nothing is claimed about them.
 */
export default function DemandSection({ state, inputRevision, admin }: { state: DemandState | null; inputRevision: number; admin: boolean }) {
  if (!state) return <p className="ideal-note">必要配置を確認できません。取得できた前提は上に表示しています。</p>;
  const latest = Math.max(0, ...state.records.map((record) => record.revision));
  return <div className="ideal-v3-record">
    <section aria-labelledby="demand-current-title">
      <h3 id="demand-current-title" className="ideal-v3-heading">現在の必要配置</h3>
      {!state.stagingValid && <div className="ideal-inline-problem" role="alert">
        <StatusPill tone="warn">不整合</StatusPill>
        <div><strong>編集中の記録に不整合があります</strong><p>サーバーの検証結果です。記録は修正できますが、勤務入力への反映・生成・公開の前に解消してください。</p>
          <ul className="ideal-note-list">{state.issues.map((issue, index) => <li key={index}>{issue.location}：{issue.message}</li>)}</ul></div>
      </div>}
      {state.records.length ? <div className="ideal-table-wrap" role="region" aria-label="登録されている必要配置" tabIndex={0}><table className="ideal-table">
        <thead><tr><th scope="col">業務・場所</th><th scope="col">時間帯（日本時間）</th><th scope="col">必須</th><th scope="col">希望</th><th scope="col">原本確認</th><th scope="col">版</th></tr></thead>
        <tbody>{state.records.map((record) => <tr key={record.key}>
          <td>{record.payload.task}・{record.payload.location}</td>
          <td>{jstText(record.payload.start)} 〜 {jstText(record.payload.end)}</td>
          <td>{record.payload.minimum}名</td><td>{record.payload.target}名</td>
          <td>{EVIDENCE_STATUS[record.payload.evidence?.status] ?? "未確認"}</td>
          <td>{record.revision ? `第${record.revision}版` : "未登録（入力版の値）"}</td>
        </tr>)}</tbody>
      </table></div> : <p className="ideal-note">この入力版に登録された必要配置はありません。</p>}
    </section>
    <section aria-labelledby="demand-next-title">
      <h3 id="demand-next-title" className="ideal-v3-heading">次の操作</h3>
      {!state.matchesInput ? <p className="ideal-note" role="alert">対象期間の入力版を確認できません。この画面を読み直してから登録してください。</p>
        : !state.canEdit ? <p className="ideal-note">必要配置の登録は、管理者と責任者が行います。</p>
          : <details className="ideal-v3-disclosure"><summary>必要配置を登録・変更する</summary><DemandEditor inputHash={state.inputHash} inputRevision={inputRevision} records={state.records} dutyOptions={state.dutyOptions} /></details>}
    </section>
    <section aria-labelledby="demand-history-title">
      <h3 id="demand-history-title" className="ideal-v3-heading">版と履歴</h3>
      <dl className="ideal-definition-list">
        <div><dt>対象の入力版</dt><dd>入力版 {inputRevision}</dd></div>
        <div><dt>登録されている記録</dt><dd>{state.records.length}件{latest > 0 ? `（最も新しい版は第${latest}版）` : ""}</dd></div>
        <div><dt>変更の履歴</dt><dd>保存のたびに記録の版が1つ進み、以前の版は上書きされずに残ります。保存した時刻・操作した役割・版は監査の履歴に記録されます。
          {admin && <> <WorkspaceLink className="ideal-inline-link" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></>}</dd></div>
      </dl>
    </section>
  </div>;
}
