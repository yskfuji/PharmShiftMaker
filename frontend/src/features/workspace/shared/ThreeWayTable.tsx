import type { ThreeWayRow } from "./records/facts";

/**
 * A conflicting edit, one row per line of the record: at the start of the edit, on the
 * server now, and as edited. Rows whose three values are not all the same come first and
 * are marked. Nothing is merged here; the person decides what to keep. The table scrolls
 * inside its own keyboard-focusable region on a narrow screen.
 */
export default function ThreeWayTable({ rows, label = "三つの内容の比較" }: { rows: ThreeWayRow[]; label?: string }) {
  const differs = (row: ThreeWayRow) => !(row.base === row.current && row.current === row.proposed);
  const ordered = [...rows.filter(differs), ...rows.filter((row) => !differs(row))];
  return <div className="ideal-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="ideal-table">
    <thead><tr><th scope="col">項目</th><th scope="col">編集開始時</th><th scope="col">現在</th><th scope="col">編集中</th><th scope="col">差分</th></tr></thead>
    <tbody>{ordered.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.base}</td><td>{row.current}</td><td>{row.proposed}</td><td>{differs(row) ? "あり" : "なし"}</td></tr>)}</tbody>
  </table></div>;
}
