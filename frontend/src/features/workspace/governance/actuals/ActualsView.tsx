import { departmentRoleLabel } from "@/lib/departmentRole";
import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { jstText } from "../../shared/jst";
import TaskJump from "../../shared/TaskJump";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import ActualTasks from "./ActualTasks";
import { REVIEW_TASK, personName, piecesText, type ActualsData } from "./model";
import TableScrollCue from "../../shared/TableScrollCue";
import Identifiers from "../../shared/Identifiers";

/**
 * Actual work and its reconciliation: the registered actuals as they stand, what can be
 * done next, and the versions. A form opens only from "next"; every import, save and note
 * is confirmed in place. What the viewer may do is what the server answered. The count in
 * the header is of the rows the server returned, and leads to the task that answers it.
 */
export default function ActualsView({ data, ctx }: { data: ActualsData; ctx: RouteContext }) {
  const pending = data.actuals.filter((row) => !row.reviewed).length;
  const mayOpenAudit = (routeOf("governance/audit").roles as readonly string[]).includes(ctx.role);
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><h2>実績の状態と次の操作</h2><p>勤怠の原本から実績を登録し、公開した勤務と照らし合わせた結果を記録します。予定との差は、この画面には表示されません。照合の内容として記録します。</p></div>
      <div className="ideal-v3-badge-action">
        <StatusPill tone={pending ? "warn" : "good"}>{data.actuals.length === 0 ? "登録済みの実績なし" : pending ? `照合の記録がない実績 ${pending}件` : "すべての実績に照合の記録あり"}</StatusPill>
        {pending > 0 && <TaskJump target={REVIEW_TASK}>照合を記録する</TaskJump>}
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="actuals-current-title">
      <h2 id="actuals-current-title">現在の状態</h2>
      {data.actuals.length === 0 ? <p className="ideal-note">登録済みの実績はありません。実績は、原本の取込か公開勤務からの記録で登録されます。</p> : <>
        <TableScrollCue />
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
        <Identifiers items={data.actuals.map((row) => ({ key: row.external_id, label: `${personName(data.names, row.duty.person_id)} ${jstText(row.duty.start)} の原本の識別子`, value: row.external_id }))} />
      </>}
      {/* What the viewer may do, after what stands: the sentence is the one the route has always said. */}
      <p className="ideal-v3-callout">あなたは「{departmentRoleLabel(data.role)}」として登録されています。この画面では、{data.canCorrect ? "実績の取込・記録・訂正と、照合内容の記録ができます。" : "照合内容の記録ができます。実績の取込・記録・訂正ができるのは、管理者だけです。"}</p>
    </section>
    <section className="ideal-panel" aria-labelledby="actuals-next-title">
      <h2 id="actuals-next-title">次の操作</h2>
      <ActualTasks data={data} />
    </section>
    <section className="ideal-panel" aria-labelledby="actuals-history-title">
      <h2 id="actuals-history-title">履歴</h2>
      <p>この画面に表示しているのは、各実績の現在の版です。いつ・どの役割が実績を変更したかは、この画面には表示されません。監査の履歴で確認できます。</p>
      <dl className="ideal-definition-list">
        <div><dt>登録されている実績</dt><dd>{data.actuals.length}件{data.actuals.length ? `（最も新しい版は第${Math.max(...data.actuals.map((row) => row.revision))}版）` : ""}</dd></div>
        <div><dt>版の進み方</dt><dd>取込・記録・訂正のたびに実績の版が1つ進みます。照合の記録は、その時点の版に対して残ります。</dd></div>
        <div><dt>以前の版</dt><dd>上書きされずにサーバーに残ります。以前の版の内容は、この画面には表示されません。</dd></div>
        <div><dt>操作の記録</dt><dd>操作した時刻・役割は監査の履歴に記録されます。{mayOpenAudit ? "" : " 監査の履歴は管理者が確認できます。"}</dd></div>
      </dl>
      {mayOpenAudit && <div className="ideal-actions"><WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></div>}
    </section>
  </div>;
}
