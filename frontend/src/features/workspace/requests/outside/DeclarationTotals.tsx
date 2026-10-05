import type { DeclarationPayload } from "../api";
import { declaredTotals, hoursText, type DeclaredTotal } from "./model";

function Totals({ caption, rows }: { caption: string; rows: DeclaredTotal[] }) {
  return <div className="ideal-table-wrap" role="region" aria-label={caption} tabIndex={0}><table className="ideal-table">
    <caption>{caption}</caption>
    <thead><tr><th scope="col">期間</th><th scope="col">所定</th><th scope="col">所定外</th><th scope="col">うち他社の法定休日</th></tr></thead>
    <tbody>{rows.length
      ? rows.map((row) => <tr key={row.period}><th scope="row">{row.period}</th><td>{hoursText(row.scheduled)}</td><td>{hoursText(row.extra)}</td><td>{hoursText(row.holiday)}</td></tr>)
      : <tr><td colSpan={4}>記載された区間はありません。</td></tr>}</tbody>
  </table></div>;
}

/** The declared intervals of one declaration added up for comparison with the other
 * employer's documents. A plain sum of what was declared, said as such. */
export default function DeclarationTotals({ declaration }: { declaration: DeclarationPayload }) {
  const totals = declaredTotals(declaration);
  return <section aria-label="照合用の集計">
    <p className="ideal-note">申告された区間の長さを、区間の開始日で週・月に分けて単純に合計した値です。労働時間の通算や法令上の判定ではありません。通算と公開可否はサーバーが判定します。</p>
    <Totals caption="週別の単純合計（月曜始まり・日本時間）" rows={totals.weeks} />
    <Totals caption="月別の単純合計（日本時間）" rows={totals.months} />
  </section>;
}
