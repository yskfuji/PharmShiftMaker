"use client";

import { useState } from "react";
import ConfirmSurface from "../../../shared/ConfirmSurface";
import JstDateTimeField from "../../../shared/JstDateTimeField";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { changedFacts } from "../../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../../shared/useStepFocus";
import useUnsavedNavigation from "../../../shared/useUnsavedNavigation";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type LeaveEventPayload, type LeaveUnit } from "../../api";
import { UNIT_LABEL } from "../model";
import { DayField, SelectField, WholeNumberField } from "../../../shared/records/fields";
import { EVENT_KIND, LEDGER_NOTICE, accountLabel, eventFacts, eventLabel, ledgerOf, newEvent, policyLabel, type Ledger } from "./ledger";

type Body = { expected_revision: number; payload: LeaveEventPayload };
type Answer = { event_id: string; duplicate: boolean; account_revision: number; requires_hr_reconciliation?: boolean };

/**
 * Adds one event to the ledger of a grant: a reservation, its release, leave actually
 * taken, its reversal, an expiry or a conversion. Events are only added. The event is sent
 * against the revision of its grant, because the balance is shared by every event of the
 * grant; when that revision has moved, nothing is added until the change is reviewed.
 * Whether the balance, the unit and the span allow the event is the server's judgement.
 */
export default function LeaveEventEditor({ ledger, onSaved }: { ledger: Ledger; onSaved: () => void }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const steps = useStepFocus<"content">();
  const [draft, setDraft] = useState<LeaveEventPayload>(() => newEvent(crypto.randomUUID()));
  const [pristine, setPristine] = useState(draft);
  // The revision of the grant the confirmation was opened against; null while entering.
  const [against, setAgainst] = useState<number | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<Body, Answer, { revision: number }>({
    name: `leave:${draft.event_id}`,
    send: (body, key) => api.appendLeaveEvent(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: async () => {
      const account = ledgerOf(await api.ledgerContext(live.scopeId)).accounts.find((item) => item.key === draft.account_id);
      onSaved();
      return account ? { revision: account.revision } : null;
    },
  });
  useUnsavedNavigation(JSON.stringify(draft) !== JSON.stringify(pristine));
  const patch = (next: Partial<LeaveEventPayload>) => setDraft((old) => ({ ...old, ...next }));
  const account = ledger.accounts.find((item) => item.key === draft.account_id);
  const policies = ledger.policies.filter((item) => item.payload.person_id === account?.payload.person_id && item.payload.employer_id === account?.payload.employer_id);
  const originals = ledger.events.filter((item) => item.payload.account_id === draft.account_id && item.payload.kind === (draft.kind === "release" ? "reserve" : "take"));
  const linked = draft.kind === "release" || draft.kind === "reverse";
  // An event without a span says so: both ends empty is "no span", not an empty span.
  const event: LeaveEventPayload = draft.interval?.start || draft.interval?.end ? draft : { ...draft, interval: null };
  const facts = eventFacts(ledger, event);

  function restart() {
    const next = newEvent(crypto.randomUUID());
    setDraft(next); setPristine(next); setAgainst(null); setRebased(false); send.clear();
  }
  async function save() {
    if (against === null) return;
    const result = await send.run({ expected_revision: against, payload: event });
    if (!result.done) return;
    onSaved();
    restart();
    setDone(result.result.duplicate ? "同じ内容のイベントが登録済みでした。新しい記録は作っていません。"
      : `年休イベントを記録し、付与台帳は第${result.result.account_revision}版になりました。${result.result.requires_hr_reconciliation ? "サーバーは、台帳に人事との照合が必要な指摘が残っていると答えています。" : ""}`);
    steps.moveTo("content");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    if (!now) { setAgainst(null); setDone("対象の付与原本が、現在サーバーにありません。イベントは記録していません。"); steps.moveTo("content"); return; }
    setAgainst(now.revision); setRebased(true);
  }
  const version = (revision: number | null | undefined) => (revision ? `第${revision}版` : "未登録");

  return <div className="ideal-v3-record">
    {against === null && <>
      <h4 className="ideal-v3-heading" {...steps.heading("content")}>1. イベントの内容を入力する</h4>
      <form className="ideal-form" onSubmit={(submit) => { submit.preventDefault(); setDone(null); setRebased(false); setAgainst(account?.revision ?? 0); }}>
        <SelectField label="対象の付与原本" value={draft.account_id} options={ledger.accounts.map((item) => ({ value: item.key, label: accountLabel(ledger, item.payload) }))} onChange={(account_id) => patch({ account_id, policy_id: "", related_event_id: null })} />
        {account && <p className="ideal-note">この付与台帳は{version(account.revision)}です。予約・取得は、同じ付与のほかの月の記録と残高を共有します。</p>}
        <SelectField label="対象者・雇用主の取得規則" value={draft.policy_id} options={policies.map((item) => ({ value: item.key, label: policyLabel(item.payload) }))} onChange={(policy_id) => patch({ policy_id })} />
        <SelectField label="年休イベント" value={draft.kind} options={Object.entries(EVENT_KIND).map(([value, label]) => ({ value, label }))} onChange={(kind) => patch({ kind: kind as LeaveEventPayload["kind"], related_event_id: null, conversion_old_hours: null, conversion_new_hours: null })} />
        <SelectField label="記録する取得単位" value={draft.unit} options={Object.entries(UNIT_LABEL).map(([value, label]) => ({ value, label }))} onChange={(unit) => patch({ unit: unit as LeaveUnit })} />
        <WholeNumberField label="記録する数量" value={draft.quantity} onChange={(quantity) => patch({ quantity })} />
        <DayField label="イベントの効力日" value={draft.effective_on} onChange={(effective_on) => patch({ effective_on })} />
        {linked && <SelectField label="解除・取消の元イベント" value={draft.related_event_id ?? ""} options={originals.map((item) => ({ value: item.key, label: eventLabel(item.payload) }))} onChange={(related) => patch({ related_event_id: related || null })} />}
        <JstDateTimeField label="対象区間の開始（日本時間）" value={draft.interval?.start} onChange={(start) => patch({ interval: { start, end: draft.interval?.end ?? "" } })} />
        <JstDateTimeField label="対象区間の終了（日本時間）" value={draft.interval?.end} onChange={(end) => patch({ interval: { start: draft.interval?.start ?? "", end } })} />
        {draft.kind === "conversion" && <>
          <WholeNumberField label="換算前の1日相当時間" value={draft.conversion_old_hours} onChange={(conversion_old_hours) => patch({ conversion_old_hours })} />
          <WholeNumberField label="換算後の1日相当時間" value={draft.conversion_new_hours} onChange={(conversion_new_hours) => patch({ conversion_new_hours })} />
        </>}
        <RecordEvidenceFields value={draft.evidence} onChange={(next) => patch({ evidence: { ...draft.evidence, ...next } })} />
        <p className="ideal-note">予約と取得は別の記録です。残高・単位・区間がこのイベントを許すかどうかは、サーバーが台帳の照合で判定します。</p>
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">保存内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { restart(); steps.moveTo("content"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {against !== null && <ConfirmSurface level={4} title="2. 保存前の確認"
      changes={[...changedFacts(null, facts), { label: "付与台帳の版", before: version(against), after: `第${against + 1}版` }]}
      version={{ from: 0, to: 1 }}
      notified={LEDGER_NOTICE}
      risk={`保存前の時点では検出されていません。保存時にサーバーが、付与台帳が${version(against)}のままであることと、追加後の残高を照合します。違っていれば何も追加せず、競合または理由として知らせます。イベントの追加と付与台帳の版の更新は、一度に行われます。`}
      outcome={conflictOutcome(send.outcome, (now) => ({ currentRevision: now?.revision ?? null, rows: [
        { label: "付与台帳の版", base: version(against), current: version(now?.revision), proposed: `${version(against)}に追加` },
        ...facts.map((fact) => ({ label: fact.label, base: "（なし）", current: "（なし）", proposed: fact.text, ...(fact.verbatim && { verbatim: true as const }) })),
      ] }))} busy={send.busy}
      confirmLabel="このイベントを記録する"
      onConfirm={() => void save()} onBack={() => { send.clear(); setAgainst(null); setRebased(false); steps.moveTo("content"); }} onReviewed={reviewed}>
      {rebased && <p className="ideal-note" role="status">現在の付与台帳（{version(against)}）に追加するイベントとして確認し直します。ほかの予約・取得で残高が変わっていないか確かめて、もう一度記録してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
