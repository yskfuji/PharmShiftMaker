"use client";

import JstDateTimeField from "../../shared/JstDateTimeField";
import type { Piece } from "../api";

/**
 * The intervals of one kind of declared work, in Japan time. An interval is added and
 * removed as a whole; one that is listed needs both its ends (presence is all that is
 * checked here; the server refuses intervals that overlap or leave the declared period).
 */
export default function IntervalList({ name, note, value, onChange }: { name: string; note?: string; value: Piece[]; onChange: (pieces: Piece[]) => void }) {
  const set = (index: number, patch: Partial<Piece>) => onChange(value.map((piece, at) => (at === index ? { ...piece, ...patch } : piece)));
  return <fieldset className="ideal-fieldset">
    <legend>{name}労働区間（日本時間）</legend>
    {note && <p className="ideal-note">{note}</p>}
    {value.length === 0 && <p className="ideal-note">記載した区間はありません。</p>}
    {value.map((piece, index) => <div className="ideal-form" key={index}>
      <JstDateTimeField label={`${name}労働の開始 ${index + 1}`} value={piece.start} onChange={(start) => set(index, { start })} required />
      <JstDateTimeField label={`${name}労働の終了 ${index + 1}`} value={piece.end} onChange={(end) => set(index, { end })} required />
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => onChange(value.filter((_, at) => at !== index))}>{name}労働の区間 {index + 1} を削除</button></div>
    </div>)}
    <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => onChange([...value, { start: "", end: "" }])}>{name}労働の区間を追加</button></div>
  </fieldset>;
}
