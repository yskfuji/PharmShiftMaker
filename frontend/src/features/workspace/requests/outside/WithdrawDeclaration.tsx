"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { confirmOutcome } from "../../shared/records/confirmOutcome";
import { changedFacts } from "../../shared/records/facts";
import { useRecordSave, type RecordVersion } from "../../shared/records/useRecordSave";
import { useStepFocus } from "../../shared/useStepFocus";
import { useLive } from "../../shell/WorkspaceRuntime";
import { requestsApi, type DeclarationContext, type DeclarationPayload, type DeclarationSaved } from "../api";
import { NOBODY_NOTIFIED, declarationRisk } from "./DeclarationEditor";
import { declarationFacts, declarationLabel, declarationNames } from "./model";

/**
 * Withdraws one declaration: choose it, then confirm. The declaration is sent back as it
 * is stored with the status "withdrawn" and without its review; the server keeps the
 * earlier versions and refuses a withdrawal whose content differs from the stored one.
 */
export default function WithdrawDeclaration({ context }: { context: DeclarationContext }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target">();
  const names = declarationNames(context, live.nameOf);
  const current = context.declarations.filter((row) => row.payload.status !== "WITHDRAWN");
  const open = current.filter((row) => row.actions.change.allowed);
  const closed = current.filter((row) => !row.actions.change.allowed);
  const [chosen, setChosen] = useState("");
  const [base, setBase] = useState<RecordVersion<DeclarationPayload> | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const record = useRecordSave<DeclarationPayload, { expected_revision: number; payload: DeclarationPayload }, DeclarationSaved>({
    name: `record:outside_declaration:${chosen}`,
    send: (body) => api.saveDeclaration(live.scopeId, body),
    readCurrent: async () => {
      const row = (await api.declarationContext(live.scopeId)).declarations.find((item) => item.entity_id === chosen);
      return row ? { revision: row.revision, payload: row.payload } : null;
    },
  });
  const facts = (payload: DeclarationPayload) => declarationFacts(payload, names);
  const withdrawn: DeclarationPayload | null = base && { ...base.payload, status: "WITHDRAWN", review_evidence: null };

  function review() {
    const row = open.find((item) => item.entity_id === chosen);
    if (!row) return;
    setDone(null); setRebased(false); record.clear();
    setBase({ revision: row.revision, payload: row.payload });
  }
  function leave() { setBase(null); setRebased(false); record.clear(); steps.moveTo("target"); }
  async function save() {
    if (!base || !withdrawn) return;
    const result = await record.save({ expected_revision: base.revision, payload: withdrawn });
    if (!result.saved) return;
    setBase(null); setChosen(""); setRebased(false);
    setDone(`申告を取り下げました（第${result.result.revision}版、取下げ済み）。以前の版は残ります。`);
    steps.moveTo("target");
  }
  function reviewed() {
    if (record.outcome.kind !== "conflict") return;
    const now = record.outcome.current;
    record.clear();
    if (!now) { leave(); setDone("この申告は、現在サーバーにありません。取下げは行っていません。"); return; }
    setBase(now); setRebased(true);
  }

  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 取り下げる申告を選ぶ</h3>
    {open.length === 0 ? <p className="ideal-note">取り下げられる申告はありません。</p> : <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
      <label htmlFor={`${id}-target`}>取り下げる申告</label>
      <select id={`${id}-target`} className="ideal-input" required value={chosen} disabled={Boolean(base)} onChange={(event) => { setChosen(event.target.value); setDone(null); }}>
        <option value="">選んでください</option>
        {open.map((row) => <option key={row.entity_id} value={row.entity_id}>{declarationLabel(row, names)}（第{row.revision}版）</option>)}
      </select>
      {!base && <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">取下げの内容を確認する</button></div>}
    </form>}
    {closed.length > 0 && <ul className="ideal-note-list" aria-label="取り下げられない申告">{closed.map((row) => <li key={row.entity_id}>{declarationLabel(row, names)}：{row.actions.change.refusal}</li>)}</ul>}
    {base && withdrawn && <ConfirmSurface title="2. 取下げ前の確認"
      changes={changedFacts(facts(base.payload), facts(withdrawn))}
      version={{ from: base.revision, to: base.revision + 1 }}
      notified={NOBODY_NOTIFIED}
      risk={declarationRisk(base.revision)}
      outcome={confirmOutcome(record.outcome, facts, facts(base.payload), facts(withdrawn))} busy={record.busy}
      confirmLabel="この申告を取り下げる" backLabel="取り下げずに戻る"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      <p className="ideal-note">取り下げた申告は、労働時間の照合の対象から外れます。内容は変えずに、状態だけを「取下げ済み」にします。</p>
      {rebased && <p className="ideal-note" role="status">現在の第{base.revision}版に対する取下げとして確認し直します。内容を確認して、もう一度操作してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
