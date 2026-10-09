"use client";

import JstDateTimeField from "../../shared/JstDateTimeField";
import type { Piece } from "../api";

/**
 * The intervals of one kind (work, breaks or scheduled hours) in Japan time, to the
 * second. An interval is added and removed as a whole, and a new one starts where the
 * last one ends. Presence is all that is checked here.
 */
export default function IntervalFields({ id, label, value, onChange }: { id: string; label: string; value: Piece[]; onChange: (pieces: Piece[]) => void }) {
  const set = (index: number, patch: Partial<Piece>) => onChange(value.map((piece, at) => (at === index ? { ...piece, ...patch } : piece)));
  return <fieldset className="ideal-fieldset" id={id} tabIndex={-1}>
    <legend>{label}（日本時間）</legend>
    {value.length === 0 && <p className="ideal-note">{label}の区間はありません。</p>}
    {value.map((piece, index) => <div className="ideal-form" key={index}>
      <JstDateTimeField label={`${label}${index + 1} 開始`} value={piece.start} onChange={(start) => set(index, { start })} required />
      <JstDateTimeField label={`${label}${index + 1} 終了`} value={piece.end} onChange={(end) => set(index, { end })} required />
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => onChange(value.filter((_, at) => at !== index))}>{label}{index + 1}を削除</button></div>
    </div>)}
    <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => onChange([...value, { start: value.at(-1)?.end ?? "", end: "" }])}>{label}を追加</button></div>
  </fieldset>;
}
