"use client";

import { useId, useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import { useLive } from "../../shell/WorkspaceRuntime";
import { ROLE } from "../labels";
import WhyDisabled, { EVIDENCE_NEEDED } from "../../shared/WhyDisabled";

/** Links an account to a person. A new link has no earlier revision, so it is sent
 * against version 0; the form's fields are the draft. The two values of the sign-in service
 * are named in plain words on screen; their names in that service's own terms (issuer,
 * subject) are part of each field's name for assistive technology, as they always were,
 * and are said once in a reveal for the person who has to ask for the values. */
export default function LinkForm({ initialPersonId }: { initialPersonId: string | null }) {
  const live = useLive();
  const id = useId();
  const [form, setForm] = useState({ issuer: "", subject: "", person_id: initialPersonId ?? "", role: "PHARMACIST" as "ADMIN" | "LEADER" | "PHARMACIST" });
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  const people = live.people.map((person) => person.person_id);
  const why = action.busy || evidenceReady(evidence) ? null : EVIDENCE_NEEDED;
  return <form className="ideal-form" aria-labelledby={`${id}-title`} onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { ...form, expected_version: 0, evidence };
    await live.mutate("link-membership", body, (key) => live.client.linkMembership(live.scopeId, { ...body, idempotency_key: key }));
    setEvidence(EMPTY_EVIDENCE);
    await live.refresh();
    return "紐付けました。";
  }); }}>
    <h3 id={`${id}-title`}>アカウントを紐付ける</h3>
    <p className="ideal-note">サインインのたびに、サーバーは「発行者」と「アカウント」の組み合わせで本人を照らし合わせます。2つの値は、サインインの仕組み（認証サービス）を管理している担当者に確認してください。</p>
    <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>担当者に伝える項目の名前</summary>
      <p className="ideal-note">認証サービスの用語では、「発行者」は issuer、「アカウント」は subject と呼ばれます。担当者には、この2つの値を尋ねてください。</p>
    </details>
    <label htmlFor={`${id}-issuer`}>発行者<span className="sr-only">（issuer）</span></label><input id={`${id}-issuer`} className="ideal-input" required minLength={3} aria-describedby={`${id}-issuer-help`} value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />
    <p id={`${id}-issuer-help`} className="ideal-note">サインインに使う認証サービスを表す文字列です（3文字以上）。</p>
    <label htmlFor={`${id}-subject`}>アカウント<span className="sr-only">（subject）</span></label><input id={`${id}-subject`} className="ideal-input" required aria-describedby={`${id}-subject-help`} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
    <p id={`${id}-subject-help`} className="ideal-note">その認証サービスが、本人のアカウントに付けている識別子です。氏名やメールアドレスとは限りません。</p>
    <label htmlFor={`${id}-person`}>職員</label>
    <input id={`${id}-person`} className="ideal-input" required list={`${id}-people`} aria-describedby={`${id}-person-help`} value={form.person_id} onChange={(e) => setForm({ ...form, person_id: e.target.value })} />
    <p id={`${id}-person-help`} className="ideal-note">職員IDを入力します。入力欄を押すと、この施設・部署の職員が氏名つきの候補として出るので、そこから選べます。</p>
    <datalist id={`${id}-people`}>{people.map((p) => <option key={p} value={p}>{live.nameOf(p)}</option>)}</datalist>
    <label htmlFor={`${id}-role`}>役割</label>
    <select id={`${id}-role`} className="ideal-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    <EvidenceFields value={evidence} onChange={setEvidence} />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)} aria-describedby={why ? `${id}-why` : undefined}>紐付ける</button></div>
    <WhyDisabled id={`${id}-why`}>{why}</WhyDisabled>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}
