import type { RuleImpact } from "../../api";
import { periodText } from "../model";

/**
 * What an earlier rule revision decided within the review's interval, as the server
 * listed it: the lists and their total are the server's, and nothing is judged here. A
 * decision is saved bound to this list (its size and its check value); the server refuses
 * it when the list has changed.
 */
export default function ImpactList({ impact, bound = false }: { impact: RuleImpact; bound?: boolean }) {
  const span = (key: string) => { const [start, end] = key.split("|"); return periodText(start, end); };
  const rows = [
    ...impact.publications.map((item) => ({ id: `公開 ${item.publication_id}`, text: `公開した勤務表 ${span(item.period_key)} 第${item.version}版（規則版 ${item.rule_revision ?? "不明"}）` })),
    ...impact.grant_assessments.map((item, index) => ({ id: `付与照合 ${item.assessment_id ?? index}（付与 ${item.account_id}）`, text: `年休の付与照合（基準日 ${item.as_of ?? "不明"}・規則版 ${item.rule_revision ?? "不明"}）` })),
    ...impact.grant_records.map((item) => ({ id: `付与原本 ${item.account_id}`, text: `年休の付与原本（付与日 ${item.granted_on}）` })),
  ];
  return <div className="ideal-v3-record" role="group" aria-label="サーバーが返した影響の一覧">
    <p className="ideal-note"><strong>{bound ? "この判断に結び付ける影響の一覧" : "サーバーが返した影響の一覧"}</strong>：公開 {impact.publications.length}件・付与照合 {impact.grant_assessments.length}件・付与原本 {impact.grant_records.length}件（合計 {impact.impact_count}件）</p>
    {rows.length ? <ul className="ideal-note-list">{rows.map((row) => <li key={row.id}>{row.text}</li>)}</ul> : <p className="ideal-note">旧い規則版で決まった記録は、この確認の期間にはありません。</p>}
    {rows.length > 0 && <details className="ideal-v3-disclosure"><summary>識別情報</summary><ul className="ideal-note-list">{rows.map((row) => <li key={row.id}>{row.id}</li>)}</ul></details>}
  </div>;
}
