"use client";

import { useId, useRef, useState } from "react";
import ConfirmSurface, { type ConfirmOutcome } from "../../../shared/ConfirmSurface";
import { useEnteredBeforeMount } from "../../../shared/hydration";
import { changedFacts, threeWayRows } from "../../../shared/records/facts";
import { useRecordSave, type RecordVersion } from "../../../shared/records/useRecordSave";
import useUnsavedNavigation from "../../../shared/useUnsavedNavigation";
import { useStepFocus } from "../../../shared/useStepFocus";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { planningApi, type DemandPayload, type DemandSaveBody, type RecordSaved } from "../../api";
import DemandFields from "./DemandFields";
import { demandFacts, demandLabel, demandRecords, newDemand, type DemandRecord } from "./model";

const NEW = "new";
/** The record being edited: its version at the start of the edit (or after a reviewed
 * conflict), and whether the server has it at all. */
type Edit = { target: string; base: RecordVersion<DemandPayload>; exists: boolean };

/**
 * Registers or changes one demand of the input version on screen, in three steps: choose
 * the record, enter its content and evidence, confirm. Nothing is sent before the
 * confirmation. The edit starts from the record as it was when it was chosen; a 409 never
 * rebases it. The chosen record, its content, and where the task stands are the draft.
 */
export default function DemandEditor({ inputHash, inputRevision, records, dutyOptions }: {
  inputHash: string;
  inputRevision: number;
  records: DemandRecord[];
  dutyOptions: Array<{ task: string; location: string }>;
}) {
  const live = useLive();
  const id = useId();
  const picker = useRef<HTMLSelectElement>(null);
  const steps = useStepFocus<"target" | "content">();
  const [edit, setEdit] = useState<Edit | null>(null);
  const [draft, setDraft] = useState<DemandPayload | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rebased, setRebased] = useState(false);
  const [entryProblem, setEntryProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const api = planningApi(live.client);
  const record = useRecordSave<DemandPayload, DemandSaveBody, RecordSaved>({
    name: `record:demand:${draft?.demand_id ?? ""}`,
    send: (body) => api.saveDemand(live.scopeId, body),
    // On demand, after a conflict: the record as the server has it now.
    readCurrent: async () => demandRecords(await api.demandContext(live.scopeId, inputHash)).find((item) => item.key === draft?.demand_id) ?? null,
  });
  const dirty = Boolean(edit && draft && JSON.stringify(draft) !== JSON.stringify(edit.base.payload));
  useUnsavedNavigation(dirty);

  function choose(target: string) {
    setDone(null); setEntryProblem(null); setConfirming(false); setRebased(false); record.clear();
    const found = records.find((item) => item.key === target);
    if (!found && target !== NEW) { setEdit(null); setDraft(null); return; }
    const base = found ? { revision: found.revision, payload: found.payload } : { revision: 0, payload: newDemand(crypto.randomUUID()) };
    setEdit({ target, base, exists: Boolean(found) });
    setDraft(base.payload);
  }
  // A record chosen in the server HTML raised no event here.
  useEnteredBeforeMount(picker, (select) => { const chosen = (select as HTMLSelectElement).value; if (chosen) choose(chosen); });

  function leave() {
    setEdit(null); setDraft(null); setConfirming(false); setRebased(false); setEntryProblem(null); record.clear();
    steps.moveTo("target");
  }

  function review() {
    if (!draft) return;
    // An entry slip, not a judgement: the server refuses an interval that does not run forward.
    if (Date.parse(draft.start) >= Date.parse(draft.end)) { setEntryProblem("適用終了は、適用開始より後にしてください。"); return; }
    setEntryProblem(null); setDone(null); setConfirming(true);
  }

  async function save() {
    if (!edit || !draft) return;
    const result = await record.save({ expected_revision: edit.base.revision, payload: draft, input_hash: inputHash });
    if (!result.saved) return;
    setEdit(null); setDraft(null); setConfirming(false); setRebased(false);
    // Said from the server's answer; the route's next read arrives later.
    setDone(`必要配置を第${result.result.revision}版として保存しました。入力版が古くなるため、計画に使う前に新しい入力版を作ってください。`);
    steps.moveTo("target");
  }

  function reviewed() {
    if (record.outcome.kind !== "conflict" || !edit) return;
    const current = record.outcome.current;
    setEdit({ ...edit, base: current ?? { revision: 0, payload: edit.base.payload }, exists: Boolean(current) });
    setRebased(true);
    record.clear();
  }

  const proposed = draft ? demandFacts(draft) : [];
  const changes = edit ? changedFacts(edit.exists ? demandFacts(edit.base.payload) : null, proposed) : [];
  const revision = edit?.base.revision ?? 0;
  const outcome: ConfirmOutcome = record.outcome.kind === "conflict"
    ? { kind: "conflict", currentRevision: record.outcome.current?.revision ?? null, rows: threeWayRows(edit?.exists ? demandFacts(edit.base.payload) : null, record.outcome.current ? demandFacts(record.outcome.current.payload) : null, proposed) }
    : record.outcome;

  return <div className="ideal-v3-record">
    <h4 className="ideal-v3-heading" {...steps.heading("target")}>1. 対象を選ぶ</h4>
    <div className="ideal-form">
      <label htmlFor={`${id}-target`}>編集する対象</label>
      <select ref={picker} id={`${id}-target`} className="ideal-input" value={edit?.target ?? ""} disabled={dirty || confirming} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        <option value={NEW}>新しい必要配置を登録する</option>
        {records.map((item) => <option key={item.key} value={item.key}>{demandLabel(item)}</option>)}
      </select>
      {dirty && !confirming && <p className="ideal-note">入力中の内容があります。対象を変えるには、下の「入力を破棄して対象を選び直す」を使ってください。</p>}
    </div>
    <p className="ideal-done" role="status">{done ?? ""}</p>
    {edit && draft && !confirming && <>
      <h4 className="ideal-v3-heading" {...steps.heading("content")}>2. 配置の内容と原本確認を入力する</h4>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
        <DemandFields value={draft} dutyOptions={dutyOptions} onChange={(patch) => setDraft((old) => old && { ...old, ...patch })} onEvidence={(patch) => setDraft((old) => old && { ...old, evidence: { ...old.evidence, ...patch } })} />
        {entryProblem && <p className="ideal-note" role="alert">{entryProblem}</p>}
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">保存内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={leave}>入力を破棄して対象を選び直す</button>
        </div>
      </form>
    </>}
    {edit && draft && confirming && <ConfirmSurface level={4} title="3. 保存前の確認"
      changes={changes}
      version={{ from: revision, to: !changes.length && revision > 0 ? revision : revision + 1 }}
      notified="誰にも通知されません。保存の記録（操作した役割・版・時刻）は監査の履歴に残ります。"
      risk={`保存前の時点では検出されていません。保存時にサーバーが、${revision > 0 ? `この記録が第${revision}版のままであること` : "この記録がまだ登録されていないこと"}と、入力版 ${inputRevision} が最新であることを照合します。違っていれば保存せず、競合として知らせます。1件の記録だけを保存するため、一部だけが保存されることはありません。`}
      outcome={outcome} busy={record.busy} confirmLabel="この内容で保存する"
      onConfirm={() => void save()}
      onBack={() => { record.clear(); setConfirming(false); setRebased(false); steps.moveTo("content"); }}
      onReviewed={reviewed}>
      {rebased && <p className="ideal-note" role="status">{edit.exists ? `現在の第${revision}版との差分に更新しました。` : "現在は登録がないため、新規登録として確認し直します。"}内容を確認して、もう一度保存してください。</p>}
    </ConfirmSurface>}
  </div>;
}
