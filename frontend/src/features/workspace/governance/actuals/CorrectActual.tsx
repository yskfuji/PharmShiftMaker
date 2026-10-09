"use client";

import { useId, useState, type ReactNode } from "react";
import { useStepFocus } from "../../shared/useStepFocus";
import ActualEditor, { ActualSavedNotice } from "./ActualEditor";
import { actualLabel, draftOfActual, type ActualDraft, type ActualTaskContext } from "./model";

/** Corrects one registered actual: choose it, change its content, confirm. The correction
 * is saved as the next revision; the server keeps the earlier ones. */
export default function CorrectActual({ context, onSaved }: { context: ActualTaskContext; onSaved: () => void }) {
  const id = useId();
  const steps = useStepFocus<"target">();
  const [draft, setDraft] = useState<ActualDraft | null>(null);
  const [done, setDone] = useState<ReactNode>(null);
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 訂正する実績を選ぶ</h3>
    {context.actuals.length === 0 ? <p className="ideal-note">登録済みの実績はありません。</p> : <div className="ideal-form">
      <label htmlFor={`${id}-target`}>訂正する実績</label>
      <select id={`${id}-target`} className="ideal-input" value={draft?.key ?? ""} disabled={Boolean(draft)} onChange={(event) => {
        const row = context.actuals.find((item) => item.external_id === event.target.value);
        setDone(null); setDraft(row ? draftOfActual(context, row) : null);
      }}>
        <option value="">選んでください</option>
        {context.actuals.map((row) => <option key={row.external_id} value={row.external_id}>{actualLabel(row, context.names)}</option>)}
      </select>
      {draft && <p className="ideal-note">別の実績を選ぶには、下の「入力を破棄する」を使ってください。</p>}
    </div>}
    {draft && <ActualEditor key={draft.key} draft={draft} context={context}
      onLeave={() => { setDraft(null); steps.moveTo("target"); }}
      onDone={(revision) => { setDraft(null); setDone(<ActualSavedNotice revision={revision} />); onSaved(); steps.moveTo("target"); }} />}
    <p className="ideal-done" role="status">{done}</p>
  </div>;
}
