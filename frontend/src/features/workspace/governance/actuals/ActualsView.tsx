import { departmentRoleLabel } from "@/lib/departmentRole";
import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { jstText } from "../../shared/jst";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import ActualTasks from "./ActualTasks";
import { personName, piecesText, type ActualsData } from "./model";

/**
 * Actual work and its reconciliation: the registered actuals as they stand, what can be
 * done next, and the versions. A form opens only from "next"; every import, save and note
 * is confirmed in place. What the viewer may do is what the server answered.
 */
export default function ActualsView({ data, ctx }: { data: ActualsData; ctx: RouteContext }) {
  const pending = data.actuals.filter((row) => !row.reviewed).length;
  const mayOpenAudit = (routeOf("governance/audit").roles as readonly string[]).includes(ctx.role);
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><span className="ideal-eyebrow">実績照合</span><h2>実績の状態と次の操作</h2><p>勤怠の原本から実績を登録し、公開した勤務との差を照合して記録します。実績が契約や所定時間に合うかどうかは、サーバーが検証します。</p></div>
      <StatusPill tone={pending ? "warn" : "good"}>{data.actuals.length === 0 ? "登録済みの実績なし" : pending ? `照合の記録がない実績 ${pending}件` : "すべての実績に照合の記録あり"}</StatusPill>
    </section>
    <section className="ideal-panel" aria-labelledby="actuals-current-title">
      <h2 id="actuals-current-title">現在の状態</h2>
      <p>サーバーが返したあなたの権限：{departmentRoleLabel(data.role)}。{data.canCorrect ? "実績の取込・記録・訂正と、照合内容の記録ができます。" : "照合内容の記録ができます。実績の取込・記録・訂正は、管理者にだけ許可されています。"}</p>
      {data.actuals.length === 0 ? <p className="ideal-note">登録済みの実績はありません。実績は、原本の取込か公開勤務からの記録で登録されます。</p> : <>
        <div className="ideal-table-wrap" role="region" aria-label="登録済みの実績" tabIndex={0}><table className="ideal-table">
          <thead><tr><th scope="col">職員</th><th scope="col">勤務の開始（日本時間）</th><th scope="col">実労働</th><th scope="col">休憩</th><th scope="col">版</th><th scope="col">照合の記録</th></tr></thead>
          <tbody>{data.actuals.map((row) => <tr key={row.external_id}>
            <th scope="row">{personName(data.names, row.duty.person_id)}</th>
            <td>{jstText(row.duty.start)}</td>
            <td>{piecesText(row.duty.work)}</td>
            <td>{piecesText(row.duty.breaks)}</td>
            <td>第{row.revision}版</td>
            <td><StatusPill tone={row.reviewed ? "good" : "warn"}>{row.reviewed ? "現在の版に記録あり" : "未記録"}</StatusPill></td>
          </tr>)}</tbody>
        </table></div>
        <details className="ideal-v3-disclosure"><summary>識別情報</summary>
          <ul className="ideal-note-list">{data.actuals.map((row) => <li key={row.external_id}>{personName(data.names, row.duty.person_id)} {jstText(row.duty.start)}：原本の識別子 {row.external_id}</li>)}</ul>
        </details>
      </>}
    </section>
    <section className="ideal-panel" aria-labelledby="actuals-next-title">
      <h2 id="actuals-next-title">次の操作</h2>
      <ActualTasks data={data} />
    </section>
    <section className="ideal-panel" aria-labelledby="actuals-history-title">
      <h2 id="actuals-history-title">履歴</h2>
      <div className="ideal-v3-record"><section aria-labelledby="actuals-history-versions-title">
        <h3 id="actuals-history-versions-title" className="ideal-v3-heading">版と変更の記録</h3>
        <dl className="ideal-definition-list">
        <div><dt>表示している版</dt><dd>各実績の現在の版です。以前の版の内容は、APIが返さないため、この画面では表示できません。</dd></div>
        <div><dt>登録されている実績</dt><dd>{data.actuals.length}件{data.actuals.length ? `（最も新しい版は第${Math.max(...data.actuals.map((row) => row.revision))}版）` : ""}</dd></div>
        <div><dt>変更の履歴</dt><dd>取込・記録・訂正のたびに実績の版が1つ進み、以前の版は上書きされずにサーバーに残ります。照合の記録は、その時点の版に対して残ります。操作した時刻・役割は監査の履歴に記録されます。
          {mayOpenAudit ? <> <WorkspaceLink className="ideal-inline-link" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></> : " 監査の履歴は管理者が確認できます。"}</dd></div>
        </dl>
      </section></div>
    </section>
  </div>;
}
