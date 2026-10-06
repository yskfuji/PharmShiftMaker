import { StatusPill } from "@/ideal/ui/atoms";
import { obligationStatusLabel } from "@/lib/leaveDisplay";
import type { LeaveRequestRow } from "../api";
import SoftBreaks from "../../shared/SoftBreaks";
import { amountText, daysText, findingStatus, grantDay, grantOwner, periodText, requestKind, requestStatus, type LedgerState } from "./model";
import TableScrollCue from "../../shared/TableScrollCue";
import Identifiers from "../../shared/Identifiers";

const tone = (status: string) => (status === "APPROVED" ? "good" : status === "CANCELLED" ? "neutral" : "warn");
/** The server's verdict on the five-day obligation as a tone, by its code: a table fixed
 * here. The verdict is always said in words; a code this table does not have is neutral. */
const OBLIGATION_TONE: Record<string, "good" | "warn" | "danger"> = { fulfilled: "good", at_risk: "warn", overdue: "danger" };
const obligationTone = (status: string) => (Object.hasOwn(OBLIGATION_TONE, status) ? OBLIGATION_TONE[status] : "neutral");

/**
 * A table of requests: whose, its status, what, when, how much, the decision record and
 * the version. The status follows the person, so that it is in view at phone width before
 * the table is scrolled.
 */
export function RequestTable({ label, rows, person }: { label: string; rows: LeaveRequestRow[]; person: (personId: string) => string }) {
  return <><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="ideal-table">
    <thead><tr><th scope="col">本人</th><th scope="col">状態</th><th scope="col">種類</th><th scope="col">期間（日本時間）</th><th scope="col">単位・数量</th><th scope="col">判断の記録</th><th scope="col">版</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.request_id}>
      <th scope="row">{person(row.person_id)}</th>
      <td><StatusPill tone={tone(row.status)}>{requestStatus(row.status)}</StatusPill></td>
      <td>{requestKind(row.kind)}</td>
      <td>{periodText(row.payload.start, row.payload.end)}</td>
      <td>{amountText(row)}</td>
      <td>{row.decision?.reference ? <span data-verbatim>{row.decision.reference}</span> : "—"}</td>
      <td>第{row.version}版</td>
    </tr>)}</tbody>
  </table></div></>;
}

/**
 * What stands now: the balance of each grant, the five-day obligation and what the server
 * reports about the ledger, and the viewer's own requests that are not withdrawn. The two
 * tables of the ledger are named apart, and the server's reports are set off as something
 * that needs attention. `ledger` is null when the server could not account the ledger:
 * then nothing is claimed about it (never a zero balance).
 */
export default function LeaveCurrent({ ledger, requests, person, planner, me }: { ledger: LedgerState | null; requests: LeaveRequestRow[]; person: (personId: string) => string; planner: boolean; me: string }) {
  // The viewer's own lines of the ledger, as the server returned them: nothing is added up.
  const mine = ledger ? { balances: ledger.balances.filter((item) => item.person_id === me), obligations: ledger.obligations.filter((item) => item.person_id === me) } : null;
  return <div className="ideal-v3-record ideal-v3-requests-tables">
    {mine && mine.balances.length + mine.obligations.length > 0 && <section aria-labelledby="leave-mine-title">
      <h3 id="leave-mine-title" className="ideal-v3-heading">あなたの年休</h3>
      <dl className="ideal-v3-requests-headline">
        {mine.balances.map((balance) => <div key={balance.account_id}>
          <dt>いま使える年休（{grantDay(balance)}）</dt>
          <dd><strong>{daysText(balance.available_days)} 日</strong><span>{balance.expired ? "失効済み" : "有効"}</span></dd>
        </div>)}
        {mine.obligations.map((item) => <div key={item.obligation_id}>
          <dt>年5日の取得（期限 {item.end} の前日まで）</dt>
          <dd><strong>{item.taken_half_days / 2}／{item.required_half_days / 2} 日</strong><StatusPill tone={obligationTone(item.status)}>{obligationStatusLabel(item.status)}</StatusPill></dd>
        </div>)}
      </dl>
    </section>}
    <section aria-labelledby="leave-balance-title">
      <h3 id="leave-balance-title" className="ideal-v3-heading">年休の残高と取得義務</h3>
      {!ledger ? <p className="ideal-v3-callout ideal-v3-callout--warn" role="status">年休残高と取得義務は未確認です。サーバーが台帳を計算できなかったため、残高ゼロや問題なしを意味しません。</p> : <>
        <h4 className="ideal-v3-heading">付与ごとの残高</h4>
        {ledger.balances.length ? <><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label="年休残高" tabIndex={0}><table className="ideal-table">
          <thead><tr><th scope="col">付与された年休<wbr />（職員／<wbr />雇用主／<wbr />付与日）</th><th scope="col">いま使える<wbr />日数</th><th scope="col">有効・失効</th></tr></thead>
          <tbody>{ledger.balances.map((balance) => <tr key={balance.account_id}>
            <th scope="row"><SoftBreaks>{`${grantOwner(balance)}／`}</SoftBreaks><span className="ideal-v3-requests-keep">{grantDay(balance)}</span></th><td>{daysText(balance.available_days)} 日</td><td>{balance.expired ? "失効済み" : "有効"}</td>
          </tr>)}</tbody>
        </table></div></> : <p className="ideal-note">{planner ? "この部署に登録された年休の付与はありません。" : "あなたに登録された年休の付与はありません。"}</p>}
        {ledger.obligations.length > 0 && <>
          <h4 className="ideal-v3-heading">年5日の取得義務</h4>
          <TableScrollCue />
          <div className="ideal-table-wrap" role="region" aria-label="年5日の取得管理" tabIndex={0}><table className="ideal-table">
            <thead><tr><th scope="col">職員／雇用主</th><th scope="col">数える期間（終了日の前日まで）</th><th scope="col">取得済み／必要</th><th scope="col">取得の見通し</th></tr></thead>
            <tbody>{ledger.obligations.map((item) => <tr key={item.obligation_id}>
              <th scope="row"><SoftBreaks>{`${item.person_name || "職員名未確認"}／${item.employer_name || "雇用主名未登録"}`}</SoftBreaks></th>
              <td>{item.start ? <time>{item.start}</time> : "開始日未確認"} 〜 <time>{item.end}</time></td>
              <td>{item.taken_half_days / 2}／{item.required_half_days / 2} 日</td>
              <td><StatusPill tone={obligationTone(item.status)}>{obligationStatusLabel(item.status)}</StatusPill></td>
            </tr>)}</tbody>
          </table></div>
        </>}
        <Identifiers items={[
          ...ledger.balances.map((balance) => ({ key: `grant:${balance.account_id}`, label: `付与ロット（${balance.granted_on || "付与日未確認"}）`, value: balance.account_id })),
          ...ledger.obligations.map((item) => ({ key: `obligation:${item.obligation_id}`, label: `取得義務（期限 ${item.end}）`, value: item.obligation_id })),
        ]} />
        {(ledger.requiresReconciliation || ledger.findings.length > 0) && <div className="ideal-v3-callout ideal-v3-callout--warn ideal-v3-requests-reports">
          {ledger.requiresReconciliation && <p role="status">サーバーは、残高または記録に人事との照合が必要と答えています。</p>}
          {ledger.findings.length > 0 && <section aria-labelledby="leave-findings-title">
            <h4 id="leave-findings-title" className="ideal-v3-heading">サーバーの指摘（{ledger.findings.length}件）</h4>
            <ul role="list" className="ideal-note-list">{ledger.findings.map((finding, index) => <li key={index}>{findingStatus(finding.status)}：{finding.message}</li>)}</ul>
          </section>}
        </div>}
      </>}
    </section>
    <section aria-labelledby="leave-own-title">
      <h3 id="leave-own-title" className="ideal-v3-heading">あなたの申請</h3>
      {requests.length ? <RequestTable label="あなたの申請（取下げ済みを除く）" rows={requests} person={person} /> : <p className="ideal-note">進行中のあなたの申請はありません。</p>}
    </section>
  </div>;
}
