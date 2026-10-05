"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { changedFacts, threeWayRows, type Fact } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { settingsApi, type EnrollmentRequest, type EnrollmentRow, type FlexListing, type FlexRegistered } from "../api";
import { NOBODY_NOTIFIED } from "./decisions";
import { adoptionLabel, dayOf, enrollmentFacts, flexNames, STATUS_LABEL } from "./model";
import { laterEnrollment } from "./registration";

/**
 * Registers one person's participation in an adoption, from one of the days the server
 * lists for that adoption (`settlement_starts.participant_start`). Which adoptions take a
 * new participant is the server's answer on each one; whether the chosen person can
 * participate is answered when the registration is sent. The identity of the new
 * participation is made once, when its content is confirmed, so a resend carries the same.
 */
export default function AddParticipant({ listing }: { listing: FlexListing }) {
  const live = useLive();
  const api = settingsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"content">();
  const names = flexNames(listing);
  const open = listing.adoptions.filter((row) => row.actions.add_participant.allowed);
  const closed = listing.adoptions.filter((row) => !row.actions.add_participant.allowed);
  const [adoptionId, setAdoptionId] = useState("");
  const [personId, setPersonId] = useState("");
  const [start, setStart] = useState("");
  const [draft, setDraft] = useState<EnrollmentRequest | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<{ payload: EnrollmentRequest }, FlexRegistered, EnrollmentRow>({
    name: `flex-enrollment:register:${draft?.enrollment_id ?? ""}`,
    send: (body, key) => api.registerEnrollment(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: async () => (await api.flexAdoptions(live.scopeId)).enrollments.find((item) => item.entity_id === draft?.enrollment_id) ?? null,
  });
  const adoption = open.find((row) => row.entity_id === adoptionId);
  useUnsavedNavigation(Boolean(adoptionId || personId || start));
  const proposed = (request: EnrollmentRequest): Fact[] => [
    { label: "参加者", text: names.person(request.person_id) }, { label: "参加の開始日", text: dayOf(request.start) }, { label: "状態", text: STATUS_LABEL.registered },
  ];
  const stored = (row: EnrollmentRow) => enrollmentFacts(row, names).slice(0, 3);

  function reset() { setAdoptionId(""); setPersonId(""); setStart(""); setDraft(null); setRebased(false); send.clear(); }
  function leave() { setDraft(null); setRebased(false); send.clear(); steps.moveTo("content"); }
  async function save() {
    if (!draft) return;
    const result = await send.run({ payload: draft });
    if (!result.done) return;
    const name = names.person(draft.person_id);
    reset();
    setDone(`${name} の参加を第${result.result.revision}版として登録しました（確認待ち）。確認できる管理者は、「参加を確認する」に表示されます。`);
    steps.moveTo("content");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    if (now) { reset(); setDone(`この参加は、すでに登録されています（第${now.revision}版、${STATUS_LABEL[now.payload.status] ?? now.payload.status}）。重ねて登録はしていません。`); steps.moveTo("content"); return; }
    setRebased(true);
  }

  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("content")}>1. 採用・職員・参加の開始日を選ぶ</h3>
    {open.length === 0 ? <p className="ideal-note">参加者を追加できる採用はありません。</p> : !draft && <form className="ideal-form" onSubmit={(event) => {
      event.preventDefault();
      if (!adoption) return;
      setDone(null); setRebased(false); send.clear();
      setDraft(laterEnrollment(adoption.entity_id, personId, start, crypto.randomUUID().slice(0, 8)));
    }}>
      <label htmlFor={`${id}-adoption`}>参加者を追加する採用</label>
      <select id={`${id}-adoption`} className="ideal-input" required value={adoptionId} onChange={(event) => { setAdoptionId(event.target.value); setStart(""); setDone(null); }}>
        <option value="">選んでください</option>
        {open.map((row) => <option key={row.entity_id} value={row.entity_id}>{adoptionLabel(row, names)}</option>)}
      </select>
      <label htmlFor={`${id}-person`}>職員</label>
      <select id={`${id}-person`} className="ideal-input" required value={personId} onChange={(event) => setPersonId(event.target.value)}>
        <option value="">選んでください</option>
        {listing.people.map((person) => <option key={person.person_id} value={person.person_id}>{person.name}</option>)}
      </select>
      <label htmlFor={`${id}-start`}>参加の開始日（清算期間の初日）</label>
      <select id={`${id}-start`} className="ideal-input" required value={start} onChange={(event) => setStart(event.target.value)}>
        <option value="">選んでください</option>
        {(adoption?.settlement_starts.participant_start ?? []).map((day) => <option key={day} value={day}>{day}</option>)}
      </select>
      <p className="ideal-note">選べる開始日は、サーバーが返した将来の清算期間の初日です。選んだ職員が参加できるかどうかは、登録のときにサーバーが判定します。</p>
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">参加の内容を確認する</button></div>
    </form>}
    {closed.length > 0 && <ul className="ideal-note-list" aria-label="参加者を追加できない採用">{closed.map((row) => <li key={row.entity_id}>{adoptionLabel(row, names)}：{row.actions.add_participant.refusal}</li>)}</ul>}
    {draft && <ConfirmSurface title="2. 登録前の確認"
      changes={changedFacts(null, proposed(draft))}
      version={{ from: 0, to: 1 }}
      notified={NOBODY_NOTIFIED}
      risk="登録前の時点では検出されていません。登録時にサーバーが、同じ参加がまだ登録されていないことを照合します。登録されていれば登録せず、競合として知らせます。1件の参加だけを登録するため、一部だけが登録されることはありません。"
      outcome={conflictOutcome(send.outcome, (current) => ({ currentRevision: current?.revision ?? null, rows: threeWayRows(null, current && stored(current), proposed(draft)) }))}
      busy={send.busy} confirmLabel="参加を登録する（確認待ち）" backLabel="入力に戻る"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      <p className="ideal-note">登録した参加は、確認されるまで有効になりません。</p>
      {rebased && <p className="ideal-note" role="status">現在は登録がないため、新規登録として確認し直します。内容を確認して、もう一度操作してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
