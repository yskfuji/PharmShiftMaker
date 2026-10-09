"use client";

import { useId, useState } from "react";
import { problemFrom } from "@/ideal/api/errors";
import ConfirmSurface from "../../shared/ConfirmSurface";
import ErrorSummary, { type SummaryIssue } from "../../shared/ErrorSummary";
import { changedFacts, threeWayRows, type Fact } from "../../shared/records/facts";
import { refusalIssues } from "../../shared/records/refusal";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { settingsApi, type AdoptionRow, type AdoptionTerms, type EnrollmentRequest, type FlexListing, type FlexRegistered } from "../api";
import AdoptionFields from "./AdoptionFields";
import { NOBODY_NOTIFIED } from "./decisions";
import { flexNames, STATUS_LABEL, termsFacts } from "./model";
import { emptyForm, entrySlips, firstEnrollment, refusedRegistration, termsOf, type RegistrationField, type RegistrationForm } from "./registration";
import Identifiers from "../../shared/Identifiers";

/** What one registration sends: the adoption, then each participant's participation. */
type Registration = { payload: AdoptionTerms; participants: EnrollmentRequest[] };
/** The adoption as registered, and for each participant whether the participation was
 * registered and, when it was not, the server's answer. */
type Registered = { adoption: FlexRegistered; participants: Array<{ personId: string; registered: boolean; reason: string }> };

/**
 * Registers an adoption: enter the agreement's terms and the first participants, check the
 * answers, register. The registration awaits confirmation; who may confirm it is the
 * server's answer on the listing afterwards. The adoption's identity is made once, when
 * the answers are first checked, so a resend after a lost response carries the same
 * identity and the same key. The adoption is sent first and each participation after it:
 * when a participation fails, the adoption stays registered and the failure is reported
 * for that participant with the server's reason.
 */
export default function RegisterAdoption({ listing }: { listing: FlexListing }) {
  const live = useLive();
  const api = settingsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"content">();
  const names = flexNames(listing);
  const fieldId = (field: RegistrationField) => `${id}-${field}`;
  const [form, setForm] = useState<RegistrationForm>(emptyForm);
  const [adoptionId, setAdoptionId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [slips, setSlips] = useState<SummaryIssue[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<Registered | null>(null);
  const [exists, setExists] = useState<string | null>(null);
  const send = useConfirmedSend<Registration, Registered, AdoptionRow>({
    name: `flex-adoption:register:${adoptionId ?? ""}`,
    send: async (body, key) => {
      const adoption = await api.registerAdoption(live.scopeId, { payload: body.payload, idempotency_key: key });
      const participants: Registered["participants"] = [];
      for (const payload of body.participants) {
        try {
          // Each participation keeps its own key while its outcome is unknown.
          await live.mutate(`flex-enrollment:register:${payload.enrollment_id}`, { payload }, (enrollmentKey) => api.registerEnrollment(live.scopeId, { payload, idempotency_key: enrollmentKey }));
          participants.push({ personId: payload.person_id, registered: true, reason: "" });
        } catch (error) {
          const problem = problemFrom(error);
          participants.push({ personId: payload.person_id, registered: false, reason: problem.kind === "unknown" ? `${problem.title}。${problem.body}` : problem.body });
        }
      }
      return { adoption, participants };
    },
    readCurrent: async () => (await api.flexAdoptions(live.scopeId)).adoptions.find((row) => row.entity_id === adoptionId) ?? null,
  });
  useUnsavedNavigation(JSON.stringify(form) !== JSON.stringify(emptyForm()));

  const refused = send.outcome.kind === "refused" ? send.outcome : null;
  const identity = adoptionId ?? "";
  const terms = termsOf(form, listing.establishments, identity);
  const facts = (value: AdoptionTerms): Fact[] => [...termsFacts(value, names), { label: "状態", text: STATUS_LABEL.registered }];
  const proposed: Fact[] = [...facts(terms), { label: "参加者（起算日から参加）", text: form.participants.map(names.person).join("、") || "なし（後から追加できます）" }];

  function review() {
    const found = entrySlips(form, fieldId);
    setSlips(found); setAttempt((count) => count + 1); setDone(null); setExists(null);
    send.clear();
    if (found.length) return;
    // One identity per registration: the same one for every resend of this entry.
    setAdoptionId((old) => old ?? `flex-${form.settlement_anchor}-${crypto.randomUUID().slice(0, 8)}`);
    setConfirming(true);
  }
  function reset() { setForm(emptyForm()); setAdoptionId(null); setConfirming(false); setSlips([]); send.clear(); }
  async function save() {
    if (!adoptionId) return;
    const result = await send.run({ payload: terms, participants: form.participants.map((personId) => firstEnrollment(adoptionId, personId, form.settlement_anchor)) });
    if (!result.done) return;
    reset(); setDone(result.result);
    steps.moveTo("content");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    // An adoption with this identity is registered: a registration never replaces it.
    if (now) { reset(); setExists(`この採用は、すでに登録されています（第${now.revision}版、${STATUS_LABEL[now.payload.status] ?? now.payload.status}）。重ねて登録はしていません。内容を変えるときは、取り下げてから新しく登録します。`); steps.moveTo("content"); }
  }

  // A refusal that lists fields of the request names nothing the form has a control for.
  const issues: SummaryIssue[] = !refused ? slips : refused.fields.length ? refusalIssues(refused) : refusedRegistration(refused.problem.body, fieldId);
  const invalid = (field: RegistrationField) => (issues.some((issue) => issue.fieldId === fieldId(field)) ? true : undefined);
  return <div className="ideal-v3-record">
    {(!confirming || refused) && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>1. 採用の内容を入力する</h3>
      {issues.length > 0 && <ErrorSummary title={refused ? "サーバーが登録を受け付けませんでした" : "入力内容に誤りがあります"} issues={issues} attempt={attempt} />}
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
        <AdoptionFields value={form} onChange={(patch) => setForm((old) => ({ ...old, ...patch }))} listing={listing} fieldId={fieldId} invalid={invalid} />
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">入力内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { reset(); setDone(null); setExists(null); steps.moveTo("content"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {confirming && !refused && <ConfirmSurface title="2. 登録前の確認"
      changes={changedFacts(null, proposed)}
      version={{ from: 0, to: 1 }}
      versionText={`採用の記録を新規登録します（第1版、確認待ち）。${form.participants.length ? `参加者 ${form.participants.length}人の参加の記録も、それぞれ第1版（確認待ち）として登録します。` : ""}`}
      notified={NOBODY_NOTIFIED}
      risk="登録前の時点では検出されていません。採用を登録し、続けて参加者を1人ずつ登録します。採用が登録された後で参加の登録が失敗したときは、採用は登録されたままで、失敗した参加者とサーバーの理由を知らせます。同じ採用がすでに登録されていれば登録せず、競合として知らせます。"
      outcome={conflictOutcome(send.outcome, (current) => ({ currentRevision: current?.revision ?? null, rows: threeWayRows(null, current && facts(current.payload), facts(terms)) }))}
      busy={send.busy} confirmLabel="この内容で登録する（確認待ち）"
      onConfirm={() => void save()} onBack={() => { send.clear(); setConfirming(false); steps.moveTo("content"); }} onReviewed={reviewed}>
      <p className="ideal-note">登録しても、採用は確認されるまで有効になりません。登録した管理者とは別の管理者が、影響を表示して確認します。</p>
      <Identifiers items={[{ label: "採用の識別子", value: identity }, { label: "事業場の識別子", value: terms.establishment_id }, { label: "雇用主の識別子", value: terms.employer_id }]} />
    </ConfirmSurface>}
    <div className="ideal-done" role="status">{done && <>
      <p>採用を第{done.adoption.revision}版として登録しました（確認待ち）。別の管理者が影響を確認して確認するまで、フレックスタイム制は有効になりません。</p>
      {done.participants.length > 0 && <ul role="list" className="ideal-note-list" aria-label="参加者の登録結果">{done.participants.map((item) => <li key={item.personId}>{names.person(item.personId)}：{item.registered ? "参加を登録しました（確認待ち）。" : `参加を登録できませんでした。${item.reason} 一覧を確かめ、登録されていなければ「参加者を追加する」から登録してください。`}</li>)}</ul>}
    </>}{exists}</div>
  </div>;
}
