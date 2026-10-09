import { StatusPill } from "@/ideal/ui/atoms";
import TaskJump from "../../shared/TaskJump";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { routeOf } from "../../shell/routeTypes";
import AdoptionCards from "./AdoptionCards";
import FlextimeTasks from "./FlextimeTasks";
import { CONFIRM_TASK, dayOf, enrollmentLabel, flexNames, lastDayOf, type FlextimeData } from "./model";
import SettlementSection from "./SettlementSection";
import TableScrollCue from "../../shared/TableScrollCue";

/**
 * The facility's flextime: the adoptions as they stand with their participants and the
 * settlement, what can be done next, and the adoptions that were withdrawn or ended. A
 * form opens only from "next"; every registration and decision is confirmed in place.
 * What the viewer may do, and on which days, is what the server answered. The count in the
 * header is of the rows the server returned, and leads to the task that answers it.
 */
export default function FlextimeView({ data }: { data: FlextimeData }) {
  const { listing, settlement } = data;
  const names = flexNames(listing);
  const current = listing.adoptions.filter((row) => row.payload.status !== "withdrawn");
  const waiting = current.filter((row) => row.payload.status === "registered").length;
  const closed = listing.adoptions.filter((row) => row.payload.status === "withdrawn" || row.payload.end_reason);
  const left = listing.enrollments.filter((row) => row.payload.status === "withdrawn");
  return <div className="ideal-stack">
    <section className="ideal-toolbar">
      <div><h2>採用の状態と次の操作</h2><p>施設がフレックスタイム制を採用するには、管理者が就業規則と労使協定の内容を登録し、別の管理者が影響を確認して確認します。採用するまでは使われません。</p></div>
      <div className="ideal-v3-badge-action">
        <StatusPill tone={waiting ? "warn" : current.length ? "good" : "neutral"}>{current.length === 0 ? "採用していません" : waiting ? `確認待ちの採用 ${waiting}件` : "確認待ちの採用なし"}</StatusPill>
        {listing.can_manage && waiting > 0 && <TaskJump target={CONFIRM_TASK}>確認する</TaskJump>}
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="flextime-current-title">
      <h2 id="flextime-current-title">現在の状態</h2>
      {!listing.can_manage && <p className="ideal-note">{listing.manage_refusal ?? "採用の登録と確認はできません。"}（閲覧のみ）</p>}
      <div className="ideal-v3-record">
        {current.length === 0 && <p className="ideal-note">採用していません（既定）。採用すると、参加者には時刻付きの勤務を割り当てず、実績から清算期間ごとに清算します。</p>}
        <AdoptionCards listing={listing} adoptions={current} />
        <SettlementSection settlement={settlement} />
      </div>
    </section>
    <section className="ideal-panel" aria-labelledby="flextime-next-title">
      <h2 id="flextime-next-title">次の操作</h2>
      <FlextimeTasks listing={listing} />
    </section>
    <section className="ideal-panel" aria-labelledby="flextime-history-title">
      <h2 id="flextime-history-title">履歴</h2>
      <div className="ideal-v3-flextime-history-lead">
        <p>取り下げた採用と、終了日を定めた採用です。この画面に表示するのは、各記録の現在の版だけです。以前の版の内容は、この画面には表示されません。登録・確認・取下げ・終了の時刻と操作した役割は、監査の履歴に残ります。</p>
      </div>
      <div className="ideal-v3-record">
        <section>
          <h3 className="ideal-v3-heading">取り下げた採用・終了した採用</h3>
          {closed.length === 0 ? <p className="ideal-note">取り下げた採用・終了した採用はありません。</p> : <><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label="取り下げた採用・終了した採用" tabIndex={0}><table className="ideal-table">
            <thead><tr><th scope="col">採用の期間</th><th scope="col">事業場</th><th scope="col">対象労働者の範囲</th><th scope="col">区分</th><th scope="col">理由</th><th scope="col">記録した管理者</th><th scope="col">版</th></tr></thead>
            <tbody>{closed.map((row) => <tr key={row.entity_id}>
              <th scope="row"><span className="ideal-v3-flextime-day">{dayOf(row.payload.start)}</span> 〜 <span className="ideal-v3-flextime-day">{lastDayOf(row.payload.end)}</span></th>
              <td>{names.site(row.payload.establishment_id)}</td>
              <td data-verbatim>{row.payload.target_scope}</td>
              <td>{row.payload.status === "withdrawn" ? "取下げ" : "終了"}</td>
              <td data-verbatim>{row.payload.withdrawal_reason ?? row.payload.end_reason}</td>
              <td>{names.account(row.payload.decided_by)}</td>
              <td>第{row.revision}版</td>
            </tr>)}</tbody>
          </table></div></>}
        </section>
        {left.length > 0 && <section>
          <h3 className="ideal-v3-heading">取り下げた参加</h3>
          <ul role="list" className="ideal-note-list" aria-label="取り下げた参加">{left.map((row) => <li key={row.entity_id}>{enrollmentLabel(row, names)}：<span data-verbatim>{row.payload.withdrawal_reason}</span>（記録 {names.account(row.payload.decided_by)}）</li>)}</ul>
        </section>}
      </div>
      {/* Where every route puts it: after what the history shows. */}
      <div className="ideal-actions"><WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></div>
    </section>
  </div>;
}
