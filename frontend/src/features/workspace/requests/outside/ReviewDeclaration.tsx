"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import JstDateTimeField from "../../shared/JstDateTimeField";
import { confirmOutcome } from "../../shared/records/confirmOutcome";
import { changedFacts, type Fact } from "../../shared/records/facts";
import { useRecordSave, type RecordVersion } from "../../shared/records/useRecordSave";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { requestsApi, type DeclarationContext, type DeclarationPayload, type DeclarationSaved } from "../api";
import { declarationRisk } from "./DeclarationEditor";
import DeclarationTotals from "./DeclarationTotals";
import { STATUS_LABEL, declarationFacts, declarationLabel, declarationNames } from "./model";

type Decision = { status: "REVIEWED" | "RETURNED"; reference: string; validUntil: string };
const EMPTY: Decision = { status: "REVIEWED", reference: "", validUntil: "" };

/**
 * The administrator's comparison of one declaration with the other employer's documents:
 * choose the declaration, read its declared totals, record "compared" or "ask again" with
 * the evidence, confirm. The reviewer is the signed-in administrator; the server records it.
 */
export default function ReviewDeclaration({ context }: { context: DeclarationContext }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const names = declarationNames(context, live.nameOf);
  const rows = context.declarations.filter((row) => row.payload.status !== "WITHDRAWN");
  const [chosen, setChosen] = useState("");
  const [decision, setDecision] = useState<Decision>(EMPTY);
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
  const row = rows.find((item) => item.entity_id === chosen);
  useUnsavedNavigation(Boolean(row) && JSON.stringify(decision) !== JSON.stringify(EMPTY));
  const reviewedPayload = (from: DeclarationPayload): DeclarationPayload => ({
    ...from, status: decision.status,
    review_evidence: { reference: decision.reference, verified_by: null, status: "verified", valid_until: decision.validUntil || null },
  });
  // The reviewer is not entered here: say who the server records instead of "none".
  const facts = (payload: DeclarationPayload): Fact[] => declarationFacts(payload, names);
  const proposedFacts = (payload: DeclarationPayload): Fact[] => facts(payload).map((fact) => (fact.label === "照合担当者" ? { ...fact, text: "サインイン中の管理者（サーバーが記録）" } : fact));

  function choose(target: string) { setChosen(target); setDecision(EMPTY); setBase(null); setRebased(false); setDone(null); record.clear(); }
  function leave() { setBase(null); setRebased(false); record.clear(); steps.moveTo("content"); }
  async function save() {
    if (!base) return;
    const result = await record.save({ expected_revision: base.revision, payload: reviewedPayload(base.payload) });
    if (!result.saved) return;
    choose("");
    setDone(`照合判断を第${result.result.revision}版として記録しました（${STATUS_LABEL[result.result.status] ?? result.result.status}）。`);
    steps.moveTo("target");
  }
  function reviewed() {
    if (record.outcome.kind !== "conflict") return;
    const now = record.outcome.current;
    record.clear();
    if (!now) { choose(""); setDone("この申告は、現在サーバーにありません。判断は記録していません。"); steps.moveTo("target"); return; }
    setBase(now); setRebased(true);
  }

  const proposed = base && reviewedPayload(base.payload);
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 照合する申告を選ぶ</h3>
    {rows.length === 0 ? <p className="ideal-note">照合する申告はありません。</p> : <div className="ideal-form">
      <label htmlFor={`${id}-target`}>照合する申告</label>
      <select id={`${id}-target`} className="ideal-input" value={chosen} disabled={Boolean(base)} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        {rows.map((item) => <option key={item.entity_id} value={item.entity_id}>{declarationLabel(item, names)}（第{item.revision}版）</option>)}
      </select>
    </div>}
    {row && !base && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. 申告内容を確かめ、判断と根拠を入力する</h3>
      <dl className="ideal-definition-list">{facts(row.payload).slice(0, 13).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.text}</dd></div>)}</dl>
      <DeclarationTotals declaration={row.payload} />
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); setBase({ revision: row.revision, payload: row.payload }); }}>
        <label htmlFor={`${id}-status`}>判断</label>
        <select id={`${id}-status`} className="ideal-input" value={decision.status} onChange={(event) => setDecision({ ...decision, status: event.target.value as Decision["status"] })}>
          <option value="REVIEWED">照合済み</option>
          <option value="RETURNED">再確認を依頼</option>
        </select>
        <label htmlFor={`${id}-reference`}>照合根拠</label>
        <input id={`${id}-reference`} className="ideal-input" required value={decision.reference} onChange={(event) => setDecision({ ...decision, reference: event.target.value })} />
        <JstDateTimeField label="照合の有効期限（空欄なら期限なし）" value={decision.validUntil} onChange={(validUntil) => setDecision({ ...decision, validUntil })} />
        <p className="ideal-note">照合担当者は、サインイン中の管理者としてサーバーが記録します。</p>
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">判断の内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { choose(""); steps.moveTo("target"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {base && proposed && <ConfirmSurface title="3. 記録前の確認"
      changes={changedFacts(facts(base.payload), proposedFacts(proposed))}
      version={{ from: base.revision, to: base.revision + 1 }}
      notified="誰にも通知されません。判断後の状態は、本人と管理者のこの画面の一覧に表示されます。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。"
      risk={declarationRisk(base.revision)}
      outcome={confirmOutcome(record.outcome, facts, facts(base.payload), proposedFacts(proposed))} busy={record.busy}
      confirmLabel="この判断を記録する"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      {rebased && <p className="ideal-note" role="status">現在の第{base.revision}版に対する判断として確認し直します。申告内容が変わっていないか確かめて、もう一度記録してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
