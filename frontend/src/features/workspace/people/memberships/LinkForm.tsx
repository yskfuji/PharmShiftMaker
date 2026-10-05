"use client";

import { useId, useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import { useLive } from "../../shell/WorkspaceRuntime";
import { ROLE } from "../labels";

/** Links an account to a person. A new link has no earlier revision, so it is sent
 * against version 0; the form's fields are the draft. */
export default function LinkForm({ initialPersonId }: { initialPersonId: string | null }) {
  const live = useLive();
  const id = useId();
  const [form, setForm] = useState({ issuer: "", subject: "", person_id: initialPersonId ?? "", role: "PHARMACIST" as "ADMIN" | "LEADER" | "PHARMACIST" });
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  const people = live.people.map((person) => person.person_id);
  return <form className="ideal-form" aria-labelledby={`${id}-title`} onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { ...form, expected_version: 0, evidence };
    await live.mutate("link-membership", body, (key) => live.client.linkMembership(live.scopeId, { ...body, idempotency_key: key }));
    setEvidence(EMPTY_EVIDENCE);
    await live.refresh();
    return "紐付けました。";
  }); }}>
    <h3 id={`${id}-title`}>アカウントを紐付ける</h3>
    <label htmlFor={`${id}-issuer`}>発行者（issuer）</label><input id={`${id}-issuer`} className="ideal-input" required minLength={3} value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
    <label htmlFor={`${id}-subject`}>アカウント（subject）</label><input id={`${id}-subject`} className="ideal-input" required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
    <label htmlFor={`${id}-person`}>職員</label>
    <input id={`${id}-person`} className="ideal-input" required list={`${id}-people`} value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })} />
    <datalist id={`${id}-people`}>{people.map((p) => <option key={p} value={p}>{live.nameOf(p)}</option>)}</datalist>
    <label htmlFor={`${id}-role`}>役割</label>
    <select id={`${id}-role`} className="ideal-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    <EvidenceFields value={evidence} onChange={setEvidence} />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>紐付ける</button></div>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}
