"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { threeWayRows } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type ActualReviewBody, type ActualReviewed, type ActualRow } from "../api";
import { actualLabel, reviewFacts } from "./model";

const noteState = (row: ActualRow) => (row.reviewed ? "現在の版に記録あり" : "未記録");

/**
 * Records a reconciliation note against the current revision of one actual: choose the
 * actual, read what it holds, write what was compared and why it differs, confirm. The
 * note changes no hours and creates no revision; the server refuses it when the actual
 * has changed since it was read here.
 */
export default function ReviewActual({ actuals, names }: { actuals: ActualRow[]; names: Record<string, string> }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const [chosen, setChosen] = useState("");
  const [reason, setReason] = useState("");
  const [base, setBase] = useState<ActualRow | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<ActualReviewBody, ActualReviewed, ActualRow>({
    name: `actual-review:${chosen}`,
    send: (body, key) => api.reviewActual(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: async () => (await api.actualsContext(live.scopeId)).actuals.find((item) => item.external_id === chosen) ?? null,
  });
  const row = actuals.find((item) => item.external_id === chosen);
  useUnsavedNavigation(Boolean(row) && reason !== "");

  function choose(target: string) { setChosen(target); setReason(""); setBase(null); setRebased(false); setDone(null); send.clear(); }
  function leave() { setBase(null); setRebased(false); send.clear(); steps.moveTo("content"); }
  async function save() {
    if (!base) return;
    const result = await send.run({ expected_revision: base.revision, payload: { external_id: base.external_id, reason } });
    if (!result.done) return;
    choose("");
    setDone(`照合内容を、実績の第${result.result.revision}版に対して記録しました。`);
    steps.moveTo("target");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    if (!now) { choose(""); setDone("この実績は、現在サーバーにありません。照合内容は記録していません。"); steps.moveTo("target"); return; }
    setBase(now); setRebased(true);
  }

  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 照合する実績を選ぶ</h3>
    {actuals.length === 0 ? <p className="ideal-note">照合する実績はありません。実績は、原本の取込か公開勤務からの記録で登録されます。</p> : <div className="ideal-form">
      <label htmlFor={`${id}-target`}>照合する実績</label>
      <select id={`${id}-target`} className="ideal-input" value={chosen} disabled={Boolean(base)} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        {actuals.map((item) => <option key={item.external_id} value={item.external_id}>{actualLabel(item, names)}・照合の記録：{noteState(item)}</option>)}
      </select>
    </div>}
    {row && !base && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. 実績を確かめ、照合内容を入力する</h3>
      <dl className="ideal-definition-list">{reviewFacts(row).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd data-verbatim={fact.verbatim ? "" : undefined}>{fact.text}</dd></div>)}</dl>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); setBase(row); }}>
        <label htmlFor={`${id}-reason`}>照合内容・差異の理由</label>
        <textarea id={`${id}-reason`} className="ideal-input" required value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">記録内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { choose(""); steps.moveTo("target"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {base && <ConfirmSurface title="3. 記録前の確認"
      changes={[{ label: "照合の記録", before: noteState(base), after: `第${base.revision}版に対する記録を1件追加` }, { label: "照合内容・差異の理由", before: "（なし）", after: reason, verbatim: true }]}
      version={{ from: base.revision, to: base.revision }}
      versionText={`実績は第${base.revision}版のままです。照合の記録を1件追加します。`}
      notified="誰にも通知されません。照合の記録（対象の版・操作した役割・時刻）は監査の履歴に残ります。理由の本文はサーバーに保存されますが、この画面と監査の履歴の一覧には表示されません。"
      risk={`記録前の時点では検出されていません。記録時にサーバーが、この実績が第${base.revision}版のままであることを照合します。違っていれば記録せず、競合として知らせます。1件の記録だけを追加するため、一部だけが記録されることはありません。`}
      outcome={conflictOutcome(send.outcome, (current) => ({ currentRevision: current?.revision ?? null, rows: threeWayRows(reviewFacts(base), current && reviewFacts(current), reviewFacts(base)) }))}
      busy={send.busy} confirmLabel="この照合内容を記録する"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      {rebased && <p className="ideal-note" role="status">現在の第{base.revision}版に対する記録として確認し直します。実績の内容が変わっていないか確かめて、もう一度記録してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
