"use client";

import { useId, useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import { useLive } from "../../shell/WorkspaceRuntime";
import WhyDisabled, { EVIDENCE_NEEDED } from "../../shared/WhyDisabled";

/** Starts an onboarding or offboarding case. The form's fields are the draft. */
export default function LifecycleForm({ initialPersonId }: { initialPersonId: string | null }) {
  const live = useLive();
  const id = useId();
  const [form, setForm] = useState({ person_id: initialPersonId ?? "", kind: "ONBOARD" as "ONBOARD" | "OFFBOARD", effective_date: "" });
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  const why = action.busy || evidenceReady(evidence) ? null : EVIDENCE_NEEDED;
  return <form className="ideal-form" aria-labelledby={`${id}-title`} onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { ...form, evidence };
    await live.mutate("create-lifecycle", body, (key) => live.client.createLifecycle(live.scopeId, { ...body, idempotency_key: key }));
    setEvidence(EMPTY_EVIDENCE);
    await live.refresh();
    return "手続きを始めました。";
  }); }}>
    <h3 id={`${id}-title`}>手続きを始める</h3>
    <label htmlFor={`${id}-person`}>職員ID</label><input id={`${id}-person`} className="ideal-input" required list={`${id}-people`} aria-describedby={`${id}-person-help`} value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })} />
    <datalist id={`${id}-people`}>{live.people.map((person) => <option key={person.person_id} value={person.person_id}>{person.name}</option>)}</datalist>
    <p id={`${id}-person-help`} className="ideal-note">入力欄を押すと、この施設・部署の職員が氏名つきの候補として出るので、そこから選べます。始めると、この職員の手続きが一覧に加わり、種類に応じた確認の項目が並びます。</p>
    <fieldset className="ideal-fieldset ideal-fieldset--inline"><legend>種類</legend>
      {(["ONBOARD", "OFFBOARD"] as const).map((k) => <label key={k} className="ideal-radio"><input type="radio" name={`${id}-kind`} checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />{k === "ONBOARD" ? "入職" : "退職"}</label>)}</fieldset>
    <label htmlFor={`${id}-date`}>発効日</label><input id={`${id}-date`} type="date" className="ideal-input" required value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} />
    <EvidenceFields value={evidence} onChange={setEvidence} />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)} aria-describedby={why ? `${id}-why` : undefined}>始める</button></div>
    <WhyDisabled id={`${id}-why`}>{why}</WhyDisabled>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}
