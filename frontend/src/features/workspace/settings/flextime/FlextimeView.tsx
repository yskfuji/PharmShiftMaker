import { StatusPill } from "@/ideal/ui/atoms";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { routeOf } from "../../shell/routeTypes";
import AdoptionCards from "./AdoptionCards";
import FlextimeTasks from "./FlextimeTasks";
import { adoptionLabel, enrollmentLabel, flexNames, type FlextimeData } from "./model";
import SettlementSection from "./SettlementSection";

/**
 * The facility's flextime: the adoptions as they stand with their participants and the
 * settlement, what can be done next, and the adoptions that were withdrawn or ended. A
 * form opens only from "next"; every registration and decision is confirmed in place.
 * What the viewer may do, and on which days, is what the server answered.
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
      <div><span className="ideal-eyebrow">フレックスタイム制</span><h2>採用の状態と次の操作</h2><p>施設がフレックスタイム制を採用するには、管理者が就業規則と労使協定の内容を登録し、別の管理者が影響を確認して確認します。採用するまでは使われません。</p></div>
      <StatusPill tone={waiting ? "warn" : current.length ? "good" : "neutral"}>{current.length === 0 ? "採用していません" : waiting ? `確認待ちの採用 ${waiting}件` : "確認待ちの採用なし"}</StatusPill>
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
      <p>取り下げた採用と、終了日を定めた採用です。この画面が受け取るのは各記録の現在の版だけで、以前の版の内容は表示できません。登録・確認・取下げ・終了の時刻と操作した役割は、監査の履歴に記録されます。 <WorkspaceLink className="ideal-inline-link" route={routeOf("governance/audit").route}>監査の履歴を開く</WorkspaceLink></p>
      {closed.length === 0 ? <p className="ideal-note">取り下げた採用・終了した採用はありません。</p> : <div className="ideal-table-wrap" role="region" aria-label="取り下げた採用・終了した採用" tabIndex={0}><table className="ideal-table">
        <thead><tr><th scope="col">採用</th><th scope="col">区分</th><th scope="col">理由</th><th scope="col">記録した管理者</th><th scope="col">版</th></tr></thead>
        <tbody>{closed.map((row) => <tr key={row.entity_id}>
          <th scope="row">{adoptionLabel(row, names)}</th>
          <td>{row.payload.status === "withdrawn" ? "取下げ" : "終了"}</td>
          <td>{row.payload.withdrawal_reason ?? row.payload.end_reason}</td>
          <td>{names.account(row.payload.decided_by)}</td>
          <td>第{row.revision}版</td>
        </tr>)}</tbody>
      </table></div>}
      {left.length > 0 && <ul className="ideal-note-list" aria-label="取り下げた参加">{left.map((row) => <li key={row.entity_id}>{enrollmentLabel(row, names)}：{row.payload.withdrawal_reason}（記録 {names.account(row.payload.decided_by)}）</li>)}</ul>}
    </section>
  </div>;
}
