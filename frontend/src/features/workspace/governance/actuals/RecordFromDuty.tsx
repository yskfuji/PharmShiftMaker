"use client";

import { useId, useState, type ReactNode } from "react";
import { jstText } from "../../shared/jst";
import { useStepFocus } from "../../shared/useStepFocus";
import type { PublishedPlan } from "../api";
import ActualEditor, { ActualSavedNotice } from "./ActualEditor";
import { draftOfPublishedDuty, personName, type ActualDraft, type ActualTaskContext } from "./model";

const planLabel = (plan: PublishedPlan) => {
  const day = jstText(plan.period.split("|")[0]).slice(0, 10);
  return `${day ? `${day} からの計画` : "計画"}・公開第${plan.version}版`;
};

/**
 * Records the actual of one published duty: choose the duty, enter what was worked,
 * confirm. The entry starts from the duty as published; when an actual was already
 * recorded for the duty, that actual is corrected instead. The identity of a new actual
 * is made once, when the duty is chosen, so a resend carries the same one.
 */
export default function RecordFromDuty({ context, onSaved }: { context: ActualTaskContext; onSaved: () => void }) {
  const id = useId();
  const steps = useStepFocus<"target">();
  const [chosen, setChosen] = useState("");
  const [draft, setDraft] = useState<ActualDraft | null>(null);
  const [done, setDone] = useState<ReactNode>(null);
  const duties = context.publications.flatMap((plan, planIndex) => plan.assignments.map((duty, dutyIndex) => ({ value: `${planIndex}:${dutyIndex}`, plan, duty })));
  function leave() { setDraft(null); setChosen(""); steps.moveTo("target"); }
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 実績を記録する公開勤務を選ぶ</h3>
    {duties.length === 0 ? <p className="ideal-note">公開済みの勤務はありません。</p> : <div className="ideal-form">
      <label htmlFor={`${id}-target`}>実績を記録する公開勤務</label>
      <select id={`${id}-target`} className="ideal-input" value={chosen} disabled={Boolean(draft)} onChange={(event) => {
        const found = duties.find((item) => item.value === event.target.value);
        setDone(null); setChosen(event.target.value);
        setDraft(found ? draftOfPublishedDuty(context, found.plan, found.duty, crypto.randomUUID()) : null);
      }}>
        <option value="">選んでください</option>
        {duties.map((item) => <option key={item.value} value={item.value}>{planLabel(item.plan)} {personName(context.names, item.duty.person_id)} {jstText(item.duty.start)}</option>)}
      </select>
      {draft && <p className="ideal-note">別の勤務を選ぶには、下の「入力を破棄する」を使ってください。</p>}
    </div>}
    {draft && <ActualEditor key={draft.key} draft={draft} context={context} onLeave={leave}
      onDone={(revision) => { leave(); setDone(<ActualSavedNotice revision={revision} />); onSaved(); }} />}
    <p className="ideal-done" role="status">{done}</p>
  </div>;
}
