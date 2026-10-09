"use client";

import { useId, useState, type ReactNode } from "react";
import { jstText } from "../../shared/jst";
import { useStepFocus } from "../../shared/useStepFocus";
import ActualEditor, { ActualSavedNotice } from "./ActualEditor";
import { draftOfUnplanned, dutyOptionLabel, isFlextime, personName, type ActualDraft, type ActualTaskContext } from "./model";

/**
 * Records an actual that has no published duty, under an employment revision the server
 * returned as flextime (the person chose the hours, so no duty was planned). Which
 * revisions are flextime is read from the server's data; the hours are entered, none is
 * proposed. The identities of the new actual are made once, when the entry is started.
 */
export default function RecordUnplanned({ context, onSaved }: { context: ActualTaskContext; onSaved: () => void }) {
  const id = useId();
  const steps = useStepFocus<"target">();
  const [employmentId, setEmploymentId] = useState("");
  const [option, setOption] = useState("");
  const [draft, setDraft] = useState<ActualDraft | null>(null);
  const [done, setDone] = useState<ReactNode>(null);
  const employments = context.employments.filter(isFlextime);
  function leave() { setDraft(null); steps.moveTo("target"); }
  function start() {
    const employment = employments.find((item) => item.revision_id === employmentId);
    const duty = context.dutyOptions[Number(option)];
    if (!employment || !duty) return;
    setDone(null);
    setDraft(draftOfUnplanned(employment, duty, { external: crypto.randomUUID(), duty: crypto.randomUUID() }));
  }
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 雇用条件と業務・場所を選ぶ</h3>
    {employments.length === 0 ? <p className="ideal-note">フレックスタイム制として登録された雇用条件はありません。</p>
      : context.dutyOptions.length === 0 ? <p className="ideal-note">業務・場所の候補がないため、計画なしの実績を記録できません。</p>
        : <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); start(); }}>
          <label htmlFor={`${id}-employment`}>実績を記録する雇用条件</label>
          <select id={`${id}-employment`} className="ideal-input" required value={employmentId} disabled={Boolean(draft)} onChange={(event) => setEmploymentId(event.target.value)}>
            <option value="">選んでください</option>
            {employments.map((item) => <option key={item.revision_id} value={item.revision_id}>{personName(context.names, item.person_id)}（{jstText(item.start).slice(0, 10)} 〜 {jstText(item.end).slice(0, 10)}）</option>)}
          </select>
          <label htmlFor={`${id}-option`}>業務・場所</label>
          <select id={`${id}-option`} className="ideal-input" required value={option} disabled={Boolean(draft)} onChange={(event) => setOption(event.target.value)}>
            <option value="">選んでください</option>
            {context.dutyOptions.map((item, index) => <option key={index} value={index}>{dutyOptionLabel(item)}</option>)}
          </select>
          {draft ? <p className="ideal-note">選び直すには、下の「入力を破棄する」を使ってください。</p>
            : <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">実績の入力へ進む</button></div>}
        </form>}
    {draft && <ActualEditor key={draft.key} draft={draft} context={context} onLeave={leave}
      onDone={(revision) => { leave(); setEmploymentId(""); setOption(""); setDone(<ActualSavedNotice revision={revision} />); onSaved(); }} />}
    <p className="ideal-done" role="status">{done}</p>
  </div>;
}
