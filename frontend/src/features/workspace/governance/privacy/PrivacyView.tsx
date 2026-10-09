import { StatusPill } from "@/ideal/ui/atoms";
import SelectedPersonBand from "../../shared/SelectedPersonBand";
import TaskJump from "../../shared/TaskJump";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import { anchorLabel, categoryLabel, currentRules, DECIDE_TASK, kindLabel, nameIn, nextLabel, proofLabel, statusLabel, statusTone, type PrivacyData } from "./model";
import PrivacyTasks from "./PrivacyTasks";
import TableScrollCue from "../../shared/TableScrollCue";
import Identifiers from "../../shared/Identifiers";

/**
 * Personal-data requests, retention and erasure: the requests as they stand (and, for an
 * administrator, the retention rules and the legal holds), what can be done next, and the
 * decisions recorded so far. A form opens only from "next"; every request, decision,
 * revision, hold, plan and erasure is confirmed in place. The count in the header is of
 * the requests for which the server lists a next decision, and leads to the task that
 * records one.
 */
/** Under the holds, whether or not this department has one. The server looks for a hold in
 * every department of the facility (a hold of the person, or of a whole department:
 * application/subject_controls.py, _require_applicable and execute_eligible;
 * application/copies.py, confirm_external), and this route lists the holds of its own
 * department only (routers/compliance.py, the privacy listing). An administrator refused
 * because of another department's hold finds the reason here and not in the list. */
const OTHER_DEPARTMENTS = "同じ施設のほかの部署で、対象の職員または部署全体が保全中のときも、サーバーは人物制御の適用と消去の実行を受け付けません。その保全は、この一覧には出ません。";
/** While this department has a hold in force: whom it stops, and after it the same about the
 * other departments, in one paragraph. */
const HELD = "保全中の職員には、人物制御の適用も消去の実行もできません。「部署全体」の保全が保全中のあいだは、どの職員にもできません（サーバーが受け付けません）。";
const OTHER_DEPARTMENTS_TOO = "同じ施設のほかの部署の保全も同じように止めますが、その保全はこの一覧には出ません。";

export default function PrivacyView({ data, ctx }: { data: PrivacyData; ctx: RouteContext }) {
  const admin = ctx.role === "ADMIN";
  const subjectId = ctx.selectedPersonId ?? ctx.scope.person_id;
  const own = subjectId === ctx.scope.person_id;
  const subject = { personId: subjectId, name: own ? `${ctx.viewerName}（あなた）` : nameIn(data.people, subjectId) };
  const awaiting = data.cases.filter((item) => item.allowed_next.length > 0).length;
  const rules = currentRules(data.rules);
  const holding = data.holds.filter((hold) => hold.active).length;
  const mayOpenDirectory = (routeOf("people/directory").roles as readonly string[]).includes(ctx.role);
  const mayOpenAudit = (routeOf("governance/audit").roles as readonly string[]).includes(ctx.role);
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><h2>本人対応の状態と次の操作</h2><p>請求とその判断、保存規則、法的保全、消去を扱います。何を消去でき、何が残るかは、消去の前に画面で確かめられます。</p></div>
      <div className="ideal-v3-badge-action">
        <StatusPill tone={admin && awaiting ? "warn" : "neutral"}>{admin ? (awaiting ? `次の判断ができる請求 ${awaiting}件` : "次の判断ができる請求なし") : `あなたの請求 ${data.cases.length}件`}</StatusPill>
        {admin && awaiting > 0 && <TaskJump target={DECIDE_TASK}>判断する</TaskJump>}
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="privacy-current-title">
      <h2 id="privacy-current-title">現在の状態</h2>
      <SelectedPersonBand ctx={ctx} route={routeOf("governance/privacy").route} />
      <p className="ideal-v3-callout">請求の対象として選択中の職員：{subject.name}。{admin ? (own ? <>ほかの職員の請求を代わりに出すには、{mayOpenDirectory ? <WorkspaceLink className="ideal-inline-link" route={routeOf("people/directory").route}>職員一覧</WorkspaceLink> : "職員一覧"}でその職員を選び、「個人情報の請求」を押してください。選んだ職員がこの画面に引き継がれます。</> : "この職員の請求を、管理者として代わりに出せます。") : "あなた自身の請求だけを出せます。"}</p>
      <div className="ideal-v3-record">
        <section aria-labelledby="privacy-cases-title">
          <h3 id="privacy-cases-title" className="ideal-v3-heading">{admin ? "この部署の請求" : "あなたの請求"}（{data.cases.length}件）</h3>
          {data.cases.length === 0 ? <p className="ideal-note">{admin ? "この部署の請求はありません。" : "あなたの請求はありません。"}</p> : <>
            <TableScrollCue />
            <div className="ideal-table-wrap" role="region" aria-label="本人対応の請求" tabIndex={0}><table className="ideal-table">
              <thead><tr><th scope="col">職員</th><th scope="col">請求の種類</th><th scope="col">請求の内容</th><th scope="col">状態</th><th scope="col">版</th>{admin && <th scope="col">次にできる判断</th>}</tr></thead>
              <tbody>{data.cases.map((item) => <tr key={item.case_id}>
                <th scope="row">{nameIn(data.people, item.payload.person_id)}</th>
                <td>{kindLabel(item.payload.kind)}</td>
                <td data-verbatim>{item.payload.reason}</td>
                <td><StatusPill tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusPill></td>
                <td>第{item.revision}版</td>
                {admin && <td>{nextLabel(item)}</td>}
              </tr>)}</tbody>
            </table></div>
            <Identifiers items={data.cases.flatMap((item) => { const what = `${nameIn(data.people, item.payload.person_id)}・${kindLabel(item.payload.kind)}`; return [
              { key: `${item.case_id}:case`, label: `${what}：請求の識別子`, value: item.case_id }, { key: `${item.case_id}:person`, label: `${what}：職員の識別子`, value: item.payload.person_id },
            ]; })} />
          </>}
        </section>
        {admin && <>
          <section aria-labelledby="privacy-rules-title">
            <h3 id="privacy-rules-title" className="ideal-v3-heading">保存規則（各規則の現在の版）</h3>
            {rules.length === 0 ? <p className="ideal-note">保存規則は登録されていません。確認済みの規則がないデータは、サーバーが消去を実行しません。</p>
              : <><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label="保存規則" tabIndex={0}><table className="ideal-table">
                <thead><tr><th scope="col">対象データ種別</th><th scope="col">保存期間の起算</th><th scope="col">保存日数</th><th scope="col">適用期間</th><th scope="col">根拠の状態</th><th scope="col">次回確認日</th><th scope="col">版</th></tr></thead>
                <tbody>{rules.map((rule) => <tr key={rule.key}>
                  <th scope="row">{categoryLabel(rule.payload.category)}</th>
                  <td>{anchorLabel(rule.payload.anchor)}</td>
                  <td>{rule.payload.retention_days}日（法定の最低 {rule.payload.legal_minimum_days}日）</td>
                  <td><time>{rule.payload.effective_from}</time> 〜 <time>{rule.payload.effective_until}</time>（終了日を含まない）</td>
                  <td><StatusPill tone={rule.payload.evidence.status === "verified" ? "good" : rule.payload.evidence.status === "rejected" ? "danger" : "warn"}>{proofLabel(rule.payload.evidence.status)}</StatusPill></td>
                  <td>{rule.payload.next_review}</td>
                  <td>第{rule.revision}版</td>
                </tr>)}</tbody>
              </table></div></>}
          </section>
          <section aria-labelledby="privacy-holds-title">
            <h3 id="privacy-holds-title" className="ideal-v3-heading">法的保全（保全中 {holding}件）</h3>
            {data.holds.length === 0 ? <p className="ideal-note">法的保全の記録はありません。</p> : <>
              <ul className="ideal-v3-governance-marked" aria-label="法的保全">{data.holds.map((hold) => <li key={hold.hold_id} className={hold.active ? "is-active" : undefined}>
                <strong>{nameIn(data.people, hold.person_id)}</strong><span className="sr-only">：</span><StatusPill tone={hold.active ? "warn" : "neutral"}>{hold.active ? "保全中" : "解除済み"}</StatusPill><span className="sr-only">（</span><span>第{hold.revision}版</span><span className="sr-only">）。</span><span className="ideal-v3-governance-marked__reason">理由：{hold.payload.reason != null ? <span data-verbatim>{hold.payload.reason}</span> : "（なし）"}</span>
              </li>)}</ul>
            </>}
            <p className="ideal-note">{holding > 0 ? `${HELD}${OTHER_DEPARTMENTS_TOO}` : OTHER_DEPARTMENTS}</p>
          </section>
        </>}
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="privacy-next-title">
      <h2 id="privacy-next-title">次の操作</h2>
      <PrivacyTasks data={data} subject={subject} />
    </section>
    <section className="ideal-panel" aria-labelledby="privacy-history-title">
      <h2 id="privacy-history-title">履歴</h2>
      <div className="ideal-v3-record"><section aria-labelledby="privacy-history-cases-title">
        <h3 id="privacy-history-cases-title" className="ideal-v3-heading">請求ごとの判断の記録</h3>
        <p className="ideal-note">請求ごとに、受付からの判断を版の順に示します。判断した時刻と操作した役割は、この画面には表示されません。監査の履歴で確認できます。{mayOpenAudit ? "" : " 監査の履歴は管理者が確認できます。"}</p>
        {data.cases.length === 0 ? <p className="ideal-note">判断の記録はありません。</p> : <ul className="ideal-v3-governance-history" aria-label="請求ごとの判断の記録">{data.cases.map((item) => <li key={item.case_id}>
          <strong>{nameIn(data.people, item.payload.person_id)}・{kindLabel(item.payload.kind)}</strong>
          <ol className="ideal-v3-governance-history__steps">
            <li><span>第1版</span><StatusPill tone="neutral">受付</StatusPill></li>
            {(item.payload.decision_history ?? []).map((decision) => <li key={decision.expected_revision}>
              <span>第{decision.expected_revision + 1}版</span><StatusPill tone={statusTone(decision.status)}>{statusLabel(decision.status)}</StatusPill><span>理由：<span data-verbatim>{decision.reason}</span>{decision.result_reference ? <>。実施結果の参照：<span data-verbatim>{decision.result_reference}</span></> : ""}</span>
            </li>)}
          </ol>
        </li>)}</ul>}
        {mayOpenAudit && <div className="ideal-actions"><WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></div>}
      </section></div>
    </section>
  </div>;
}
