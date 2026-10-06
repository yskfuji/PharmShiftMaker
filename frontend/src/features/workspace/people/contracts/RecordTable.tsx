import type { ReactNode } from "react";
import { periodParts } from "./model";
import TableScrollCue from "../../shared/TableScrollCue";

/** Dates in a cell: kept on one line, so a row is not doubled by a date broken in two. */
export function OneLine({ children }: { children: ReactNode }) {
  return <span className="ideal-v3-contracts-period">{children}</span>;
}
/** A period: where it may break at all, it breaks between its two dates and nowhere else. */
export function Period({ start, end }: { start: unknown; end: unknown }) {
  const [from, to] = periodParts(start, end);
  return <span className="ideal-v3-contracts-period"><span>{from} 〜</span> <span>{to}</span></span>;
}

/** The records of one kind as they stand, one row each; the first cell names the record.
 * The table scrolls inside its own keyboard-focusable region on a narrow screen. */
export default function RecordTable({ label, columns, rows, empty }: { label: string; columns: string[]; rows: Array<{ key: string; cells: ReactNode[] }>; empty: string }) {
  if (!rows.length) return <p className="ideal-note">{empty}</p>;
  return <><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="ideal-table">
    <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.key}>{row.cells.map((cell, index) => (index === 0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>))}</tr>)}</tbody>
  </table></div></>;
}
