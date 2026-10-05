import type { ReactNode } from "react";

/** The records of one kind as they stand, one row each; the first cell names the record.
 * The table scrolls inside its own keyboard-focusable region on a narrow screen. */
export default function RecordTable({ label, columns, rows, empty }: { label: string; columns: string[]; rows: Array<{ key: string; cells: ReactNode[] }>; empty: string }) {
  if (!rows.length) return <p className="ideal-note">{empty}</p>;
  return <div className="ideal-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="ideal-table">
    <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}>{row.cells.map((cell, index) => (index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>))}</tr>)}</tbody>
  </table></div>;
}
