import { findingStatus, findingText } from "@/lib/findingText";
import type { Settlement } from "../api";
import { hm, type SettlementState } from "./model";

/** The end of a settlement period is exclusive on the server; people read the last day. */
const lastDay = (end: string) => new Date(Date.parse(`${end}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const monthly = (item: Settlement) => Object.values(item.monthly_overtime_seconds ?? {}).reduce((sum, seconds) => sum + seconds, 0);

/**
 * The flextime settlement per person and settlement period, as the server computed it
 * from the registered input and the actuals. Read only: every number and every finding is
 * the server's; the findings are shown with its own text.
 */
export default function SettlementSection({ settlement }: { settlement: SettlementState | null }) {
  const result = settlement?.available ? settlement.result : null;
  const rows = result?.people.flatMap((person) => person.settlements.map((item) => ({ person, item }))) ?? [];
  return <section aria-labelledby="flextime-settlement-title">
    <h3 id="flextime-settlement-title" className="ideal-v3-heading">フレックスタイム制の清算</h3>
    <p className="ideal-note">実績の労働時間から、サーバーが清算期間ごとに計算した結果です（時間:分）。この画面では変更できません。</p>
    {settlement === null && <p className="ideal-note">清算を読み込めませんでした。上の「一部の情報を更新できませんでした」を確認してください。</p>}
    {settlement && !settlement.available && <p className="ideal-note">清算は、まだ表示できません。サーバーの回答：{settlement.reason}</p>}
    {result && rows.length === 0 && <p className="ideal-note">清算の対象となる実績はまだありません。</p>}
    {result && rows.length > 0 && <div className="ideal-table-wrap" role="region" aria-label="職員別・清算期間別の清算" tabIndex={0}><table className="ideal-table">
      <thead><tr><th scope="col">職員</th><th scope="col">清算期間</th><th scope="col">総枠</th><th scope="col">実労働</th><th scope="col">各月の時間外（週平均50時間超）</th><th scope="col">最終月に加える時間外</th><th scope="col">割り当てられない時間外</th></tr></thead>
      <tbody>{rows.map(({ person, item }) => <tr key={person.person_id + item.kind + item.start}>
        <th scope="row">{person.name}</th>
        <td>{item.start} 〜 {lastDay(item.end)}{item.kind === "flextime_part" && "（途中入社・退職の部分）"}</td>
        <td>{hm(item.frame_seconds)}</td>
        <td>{hm(item.worked_seconds)}</td>
        <td>{item.kind === "flextime" ? hm(monthly(item)) : "—"}</td>
        <td>{item.kind === "flextime" ? hm(item.final_month_overtime_seconds ?? 0) : hm(item.settlement_seconds ?? 0)}</td>
        <td>{item.kind === "flextime" && item.unattributed_seconds ? hm(item.unattributed_seconds) : "—"}</td>
      </tr>)}</tbody>
    </table></div>}
    {result && result.findings.length > 0 && <>
      <p className="ideal-note">確認が必要な点（サーバーの検証結果）：</p>
      <ul className="ideal-note-list" aria-label="清算で確認が必要な点">{result.findings.map((finding, index) => <li key={index}>{findingStatus(finding.status)}：{findingText(finding.message)}</li>)}</ul>
    </>}
    {result?.input_hash && <details className="ideal-v3-disclosure"><summary>清算の識別情報</summary><p className="ideal-note">計算に使った入力版：{result.input_hash}</p></details>}
  </section>;
}
