import { StatusPill } from "@/ideal/ui/atoms";
import { obligationStatusLabel } from "@/lib/leaveDisplay";
import type { LeaveRequestRow } from "../api";
import { amountText, daysText, findingStatus, grantText, periodText, requestKind, requestStatus, type LedgerState } from "./model";

const tone = (status: string) => (status === "APPROVED" ? "good" : status === "CANCELLED" ? "neutral" : "warn");

/** A table of requests: whose, what, when, how much, its status and the decision record. */
export function RequestTable({ label, rows, person }: { label: string; rows: LeaveRequestRow[]; person: (personId: string) => string }) {
  return <div className="ideal-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="ideal-table">
    <thead><tr><th scope="col">本人</th><th scope="col">種類</th><th scope="col">期間（日本時間）</th><th scope="col">単位・数量</th><th scope="col">状態</th><th scope="col">判断の記録</th><th scope="col">版</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.request_id}>
      <th scope="row">{person(row.person_id)}</th>
      <td>{requestKind(row.kind)}</td>
      <td>{periodText(row.payload.start, row.payload.end)}</td>
      <td>{amountText(row)}</td>
      <td><StatusPill tone={tone(row.status)}>{requestStatus(row.status)}</StatusPill></td>
      <td>{row.decision?.reference || "—"}</td>
      <td>第{row.version}版</td>
    </tr>)}</tbody>
  </table></div>;
}

/**
 * What stands now: the balance of each grant, the five-day obligation and the findings as
 * the server accounts them, and the viewer's own requests that are not withdrawn. `ledger`
 * is null when the server could not account the ledger: then nothing is claimed about it
 * (never a zero balance).
 */
export default function LeaveCurrent({ ledger, requests, person, planner }: { ledger: LedgerState | null; requests: LeaveRequestRow[]; person: (personId: string) => string; planner: boolean }) {
  return <div className="ideal-v3-record">
    <section aria-labelledby="leave-balance-title">
      <h3 id="leave-balance-title" className="ideal-v3-heading">年休の残高と取得義務</h3>
      {!ledger ? <p className="ideal-note" role="status">年休残高と取得義務は未確認です。サーバーが台帳を計算できなかったため、残高ゼロや問題なしを意味しません。</p> : <>
        {ledger.balances.length ? <div className="ideal-table-wrap" role="region" aria-label="年休残高" tabIndex={0}><table className="ideal-table">
          <thead><tr><th scope="col">付与（本人／雇用主／付与日）</th><th scope="col">利用可能</th><th scope="col">付与の状態</th></tr></thead>
          <tbody>{ledger.balances.map((balance) => <tr key={balance.account_id}>
            <th scope="row">{grantText(balance)}</th><td>{daysText(balance.available_days)} 日</td><td>{balance.expired ? "失効済み" : "有効"}</td>
          </tr>)}</tbody>
        </table></div> : <p className="ideal-note">{planner ? "この部署に登録された年休の付与はありません。" : "あなたに登録された年休の付与はありません。"}</p>}
        {ledger.obligations.length > 0 && <div className="ideal-table-wrap" role="region" aria-label="年5日の取得管理" tabIndex={0}><table className="ideal-table">
          <thead><tr><th scope="col">対象（本人／雇用主）</th><th scope="col">管理期間（終了日を含まない）</th><th scope="col">実取得／必要</th><th scope="col">サーバーの判定</th></tr></thead>
          <tbody>{ledger.obligations.map((item) => <tr key={item.obligation_id}>
            <th scope="row">{item.person_name || "職員名未確認"}／{item.employer_name || "雇用主名未登録"}</th>
            <td>{item.start || "開始日未確認"} 〜 {item.end}</td>
            <td>{item.taken_half_days / 2}／{item.required_half_days / 2} 日</td>
            <td>{obligationStatusLabel(item.status)}</td>
          </tr>)}</tbody>
        </table></div>}
        {(ledger.balances.length > 0 || ledger.obligations.length > 0) && <details className="ideal-v3-disclosure"><summary>識別情報</summary>
          <ul className="ideal-note-list">
            {ledger.balances.map((balance) => <li key={balance.account_id}>付与ロット（{balance.granted_on || "付与日未確認"}）：{balance.account_id}</li>)}
            {ledger.obligations.map((item) => <li key={item.obligation_id}>取得義務（期限 {item.end}）：{item.obligation_id}</li>)}
          </ul>
        </details>}
        {ledger.requiresReconciliation && <p className="ideal-note" role="status">サーバーは、残高または記録に人事との照合が必要と答えています。</p>}
        {ledger.findings.length > 0 && <section aria-labelledby="leave-findings-title">
          <h4 id="leave-findings-title" className="ideal-v3-heading">サーバーの指摘（{ledger.findings.length}件）</h4>
          <ul className="ideal-note-list">{ledger.findings.map((finding, index) => <li key={index}>{findingStatus(finding.status)}：{finding.message}</li>)}</ul>
        </section>}
      </>}
    </section>
    <section aria-labelledby="leave-own-title">
      <h3 id="leave-own-title" className="ideal-v3-heading">あなたの申請</h3>
      {requests.length ? <RequestTable label="あなたの申請（取下げ済みを除く）" rows={requests} person={person} /> : <p className="ideal-note">進行中のあなたの申請はありません。</p>}
    </section>
  </div>;
}
