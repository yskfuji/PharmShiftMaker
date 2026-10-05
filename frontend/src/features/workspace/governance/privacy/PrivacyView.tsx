import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import { anchorLabel, categoryLabel, currentRules, kindLabel, nameIn, nextLabel, proofLabel, statusLabel, type PrivacyData } from "./model";
import PrivacyTasks from "./PrivacyTasks";

/**
 * Personal-data requests, retention and erasure: the requests as they stand (and, for an
 * administrator, the retention rules and the legal holds), what can be done next, and the
 * decisions recorded so far. A form opens only from "next"; every request, decision,
 * revision, hold, plan and erasure is confirmed in place.
 */
export default function PrivacyView({ data, ctx }: { data: PrivacyData; ctx: RouteContext }) {
  const admin = ctx.role === "ADMIN";
  const subjectId = ctx.selectedPersonId ?? ctx.scope.person_id;
  const own = subjectId === ctx.scope.person_id;
  const subject = { personId: subjectId, name: own ? `${ctx.viewerName}（あなた）` : nameIn(data.people, subjectId) };
  const awaiting = data.cases.filter((item) => item.allowed_next.length > 0).length;
  const rules = currentRules(data.rules);
  const holding = data.holds.filter((hold) => hold.active).length;
  const mayOpenAudit = (routeOf("governance/audit").roles as readonly string[]).includes(ctx.role);
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><span className="ideal-eyebrow">個人情報</span><h2>本人対応の状態と次の操作</h2><p>個人情報の開示・訂正・利用停止・消去の請求と、その判断、保存規則、法的保全、コピーの消去を扱います。どの判断ができるか、何を消去できるか、何が残るかは、サーバーが答えます。</p></div>
      <StatusPill tone={admin && awaiting ? "warn" : "neutral"}>{admin ? (awaiting ? `次の判断ができる請求 ${awaiting}件` : "次の判断ができる請求なし") : `あなたの請求 ${data.cases.length}件`}</StatusPill>
    </section>
    <section className="ideal-panel" aria-labelledby="privacy-current-title">
      <h2 id="privacy-current-title">現在の状態</h2>
      <p>請求の対象として選択中の職員：{subject.name}。{admin ? (own ? "ほかの職員の請求を代わりに出すには、職員の一覧からその職員を選んでこの画面を開いてください。" : "この職員の請求を、管理者として代わりに出せます。") : "あなた自身の請求だけを出せます。"}</p>
      {data.cases.length === 0 ? <p className="ideal-note">{admin ? "この部署の請求はありません。" : "あなたの請求はありません。"}</p> : <>
        <div className="ideal-table-wrap" role="region" aria-label="本人対応の請求" tabIndex={0}><table className="ideal-table">
          <thead><tr><th scope="col">職員</th><th scope="col">請求の種類</th><th scope="col">請求の内容</th><th scope="col">状態</th><th scope="col">版</th>{admin && <th scope="col">サーバーが受け付ける次の判断</th>}</tr></thead>
          <tbody>{data.cases.map((item) => <tr key={item.case_id}>
            <th scope="row">{nameIn(data.people, item.payload.person_id)}</th>
            <td>{kindLabel(item.payload.kind)}</td>
            <td>{item.payload.reason}</td>
            <td><StatusPill tone={item.allowed_next.length > 0 && admin ? "warn" : "neutral"}>{statusLabel(item.status)}</StatusPill></td>
            <td>第{item.revision}版</td>
            {admin && <td>{nextLabel(item)}</td>}
          </tr>)}</tbody>
        </table></div>
        <details className="ideal-v3-disclosure"><summary>識別情報</summary>
          <ul className="ideal-note-list">{data.cases.map((item) => <li className="ideal-note" key={item.case_id}>{nameIn(data.people, item.payload.person_id)}・{kindLabel(item.payload.kind)}：請求の識別子 {item.case_id}／職員の識別子 {item.payload.person_id}</li>)}</ul>
        </details>
      </>}
      {admin && <>
        <div className="ideal-v3-record"><section aria-labelledby="privacy-rules-title">
          <h3 id="privacy-rules-title" className="ideal-v3-heading">保存規則（各規則の現在の版）</h3>
          {rules.length === 0 ? <p className="ideal-note">保存規則は登録されていません。確認済みの規則がないデータは、サーバーが消去を実行しません。</p>
            : <div className="ideal-table-wrap" role="region" aria-label="保存規則" tabIndex={0}><table className="ideal-table">
              <thead><tr><th scope="col">対象データ種別</th><th scope="col">保存期間の起算</th><th scope="col">保存日数</th><th scope="col">適用期間</th><th scope="col">根拠の状態</th><th scope="col">次回確認日</th><th scope="col">版</th></tr></thead>
              <tbody>{rules.map((rule) => <tr key={rule.key}>
                <th scope="row">{categoryLabel(rule.payload.category)}</th>
                <td>{anchorLabel(rule.payload.anchor)}</td>
                <td>{rule.payload.retention_days}日（法定の最低 {rule.payload.legal_minimum_days}日）</td>
                <td>{rule.payload.effective_from} 〜 {rule.payload.effective_until}（終了日を含まない）</td>
                <td>{proofLabel(rule.payload.evidence.status)}</td>
                <td>{rule.payload.next_review}</td>
                <td>第{rule.revision}版</td>
              </tr>)}</tbody>
            </table></div>}
        </section></div>
        <div className="ideal-v3-record"><section aria-labelledby="privacy-holds-title">
          <h3 id="privacy-holds-title" className="ideal-v3-heading">法的保全（保全中 {holding}件）</h3>
          {data.holds.length === 0 ? <p className="ideal-note">法的保全の記録はありません。</p>
            : <ul className="ideal-note-list" aria-label="法的保全">{data.holds.map((hold) => <li key={hold.hold_id}>{nameIn(data.people, hold.person_id)}：{hold.active ? "保全中" : "解除済み"}（第{hold.revision}版）。理由：{hold.payload.reason ?? "（なし）"}</li>)}</ul>}
        </section></div>
      </>}
    </section>
    <section className="ideal-panel" aria-labelledby="privacy-next-title">
      <h2 id="privacy-next-title">次の操作</h2>
      <PrivacyTasks data={data} subject={subject} />
    </section>
    <section className="ideal-panel" aria-labelledby="privacy-history-title">
      <h2 id="privacy-history-title">履歴</h2>
      <div className="ideal-v3-record"><section aria-labelledby="privacy-history-cases-title">
        <h3 id="privacy-history-cases-title" className="ideal-v3-heading">請求ごとの判断の記録</h3>
        {data.cases.length === 0 ? <p className="ideal-note">判断の記録はありません。</p> : <ul className="ideal-note-list" aria-label="請求ごとの判断の記録">{data.cases.map((item) => <li key={item.case_id}>
          {nameIn(data.people, item.payload.person_id)}・{kindLabel(item.payload.kind)}：受付（第1版）
          {(item.payload.decision_history ?? []).map((decision) => ` → ${statusLabel(decision.status)}（第${decision.expected_revision + 1}版。理由：${decision.reason}${decision.result_reference ? `。実施結果の参照：${decision.result_reference}` : ""}）`).join("")}
        </li>)}</ul>}
        <dl className="ideal-definition-list">
          <div><dt>記録される内容</dt><dd>判断のたびに請求の版が1つ進み、判断の状態・理由・本人確認の根拠が請求に追記されます。判断した時刻は、この一覧にはAPIが返さないため表示できません。</dd></div>
          <div><dt>監査の履歴</dt><dd>請求・判断・保存規則の改定・保全・確認版の作成・消去の実行は、操作した役割と時刻とともに監査の履歴に記録されます。
            {mayOpenAudit ? <> <WorkspaceLink className="ideal-inline-link" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></> : " 監査の履歴は管理者が確認できます。"}</dd></div>
        </dl>
      </section></div>
    </section>
  </div>;
}
