"use client";

import { useId, useState, type ReactNode } from "react";
import ConfirmSurface from "../../../shared/ConfirmSurface";
import JstDateTimeField from "../../../shared/JstDateTimeField";
import { jstOffsetText, jstText } from "../../../shared/jst";
import { changedFacts, type Fact } from "../../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../../shared/useStepFocus";
import useUnsavedNavigation from "../../../shared/useUnsavedNavigation";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type AmendmentAnswer } from "../../api";
import type { Option } from "../../../shared/records/fields";
import { LEDGER_NOTICE, ledgerOf, sourceChain, type Ledger } from "./ledger";

/** What every correction of the HR source carries besides its own content. */
export type AmendmentCommon = { amendment_id: string; person_id: unknown; external_event_id: unknown; external_revision: number; supersedes_revision: number; recorded_at: string; reason: string; evidence: { reference: string; status: "verified"; verified_by: string } };
type Basis = { recorded: string; reason: string; reference: string; verifier: string };
const NO_BASIS: Basis = { recorded: "", reason: "", reference: "", verifier: "" };

/**
 * The steps every correction of the HR source is recorded in: choose the original, enter
 * the correction and the HR evidence it rests on, confirm. The original is never
 * overwritten: a correction is a new record that names the source revision it follows.
 * That revision is read from the ledger's records and sent; whether the chain is unbroken,
 * the evidence sufficient and the balance still funded is the server's judgement. What is
 * corrected, and how, belongs to the kind of correction (one file per kind).
 */
export default function AmendmentShell<T, P extends AmendmentCommon>({ ledger, onSaved, sourceKind, pickLabel, options, personOf, initial, fields, lines, payload, send, confirmLabel, contentTitle }: {
  ledger: Ledger;
  /** Reads the task's records again (after a correction, and after a conflict). */
  onSaved: () => void;
  sourceKind: "leave_account" | "leave_record";
  pickLabel: string;
  options: Option[];
  personOf: (target: string) => unknown;
  /** The kind's own entries when an original is chosen. */
  initial: (target: string) => T;
  fields: (props: { target: string; value: T; onChange: (patch: Partial<T>) => void }) => ReactNode;
  /** The lines the correction changes: as the ledger holds them now, and as corrected. */
  lines: (target: string, value: T) => { before: Fact[]; after: Fact[] };
  payload: (target: string, value: T, common: AmendmentCommon) => P;
  send: (body: { expected_revision: number; payload: P; idempotency_key: string }) => Promise<AmendmentAnswer>;
  confirmLabel: string;
  contentTitle: string;
}) {
  const live = useLive();
  const api = requestsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const [target, setTarget] = useState("");
  const [value, setValue] = useState<T | null>(null);
  const [basis, setBasis] = useState<Basis>(NO_BASIS);
  // The identity of this correction: kept while the same entries are confirmed and resent.
  const [amendmentId, setAmendmentId] = useState("");
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const read = sourceChain(ledger.rows, sourceKind, target);
  // The source revision the confirmation was opened against (the one read last, after a
  // reviewed conflict); while entering, the one the ledger's records show.
  const [against, setAgainst] = useState<number | null>(null);
  const chain = { ...read, revision: confirming && against !== null ? against : read.revision };
  const sender = useConfirmedSend<{ expected_revision: number; payload: P }, AmendmentAnswer, { revision: number }>({
    name: `amendment:${sourceKind}:${target}`,
    send: (body, key) => send({ ...body, idempotency_key: key }),
    readCurrent: async () => {
      const now = sourceChain(ledgerOf(await api.ledgerContext(live.scopeId)).rows, sourceKind, target);
      onSaved();
      return { revision: now.revision };
    },
  });
  useUnsavedNavigation(Boolean(target) && (JSON.stringify(basis) !== JSON.stringify(NO_BASIS) || JSON.stringify(value) !== JSON.stringify(initial(target))));

  function choose(next: string) {
    setTarget(next); setValue(next ? initial(next) : null); setBasis(NO_BASIS); setAmendmentId(next ? crypto.randomUUID() : "");
    setConfirming(false); setRebased(false); setDone(null); sender.clear();
  }
  const common: AmendmentCommon = {
    amendment_id: amendmentId, person_id: personOf(target), external_event_id: chain.externalEventId, external_revision: chain.revision + 1, supersedes_revision: chain.revision,
    recorded_at: jstOffsetText(basis.recorded), reason: basis.reason, evidence: { reference: basis.reference, status: "verified", verified_by: basis.verifier },
  };
  const shown = target && value ? lines(target, value) : { before: [], after: [] };
  const basisFacts: Fact[] = [
    { label: "外部人事の原本改定", text: `第${chain.revision + 1}改定` },
    { label: "訂正を把握した日時（日本時間）", text: jstText(basis.recorded) || "（なし）" },
    { label: "訂正理由", text: basis.reason || "（なし）" },
    { label: "照合した人事資料の参照", text: basis.reference || "（なし）" },
    { label: "根拠の確認者", text: basis.verifier || "（なし）" },
  ];
  const before = [...shown.before, { label: "外部人事の原本改定", text: chain.revision ? `第${chain.revision}改定` : "未登録" }];
  const after = [...shown.after, ...basisFacts];

  async function save() {
    if (!target || !value) return;
    const result = await sender.run({ expected_revision: 0, payload: payload(target, value, common) });
    if (!result.done) return;
    onSaved();
    choose("");
    setDone(result.result.requires_hr_reconciliation
      ? "訂正を記録しました。サーバーは、残高または関連する記録に人事との照合が必要な差異が残っていると答えています。"
      : "訂正を記録しました。「過去時点の年休台帳と訂正履歴を照会する」で、訂正の前後を確認できます。");
    steps.moveTo("target");
  }

  return <div className="ideal-v3-record">
    <h4 className="ideal-v3-heading" {...steps.heading("target")}>1. {pickLabel}を選ぶ</h4>
    {options.length === 0 ? <p className="ideal-note">対象になる原本はありません。</p> : <div className="ideal-form">
      <label htmlFor={`${id}-target`}>{pickLabel}</label>
      <select id={`${id}-target`} className="ideal-input" value={target} disabled={confirming} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>}
    {target && value && !confirming && <>
      <h4 className="ideal-v3-heading" {...steps.heading("content")}>2. {contentTitle}</h4>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); setAgainst(read.revision); setConfirming(true); }}>
        <p className="ideal-note">外部人事の原本：{chain.externalEventId ? String(chain.externalEventId) : "原本の記録日時が未登録"}／現在の改定 {chain.revision} → この訂正で {chain.revision + 1}。改定が連続しているかどうかは、サーバーが照合します。</p>
        {!chain.externalEventId && <p className="ideal-note">この原本には「人事原本の記録日時」が登録されていないため、訂正に必要な原本番号を送れません。先に記録日時を登録してください。</p>}
        {fields({ target, value, onChange: (patch) => setValue((old) => old && { ...old, ...patch }) })}
        <JstDateTimeField label="訂正を把握した日時（日本時間）" value={basis.recorded} onChange={(recorded) => setBasis((old) => ({ ...old, recorded }))} required />
        <label htmlFor={`${id}-reason`}>訂正理由</label>
        <textarea id={`${id}-reason`} className="ideal-input" required value={basis.reason} onChange={(event) => setBasis((old) => ({ ...old, reason: event.target.value }))} />
        <label htmlFor={`${id}-reference`}>照合した人事資料の参照</label>
        <input id={`${id}-reference`} className="ideal-input" required value={basis.reference} onChange={(event) => setBasis((old) => ({ ...old, reference: event.target.value }))} />
        <label htmlFor={`${id}-verifier`}>根拠の確認者</label>
        <input id={`${id}-verifier`} className="ideal-input" required value={basis.verifier} onChange={(event) => setBasis((old) => ({ ...old, verifier: event.target.value }))} />
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">訂正の内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { choose(""); steps.moveTo("target"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {target && value && confirming && <ConfirmSurface level={4} title="3. 記録前の確認"
      changes={changedFacts(before, after)}
      version={{ from: 0, to: 1 }}
      versionText="訂正の記録を1件追加します（第1版）。元の原本は上書きされず、そのまま残ります。"
      notified={LEDGER_NOTICE}
      risk={`保存前の時点では検出されていません。保存時にサーバーが、外部人事の原本が第${chain.revision}改定のままであること、根拠、訂正後の残高を照合します。合わなければ記録せず、理由を知らせます。訂正の記録1件だけを追加するため、一部だけが保存されることはありません。`}
      outcome={conflictOutcome(sender.outcome, (now) => ({ currentRevision: null, rows: [
        { label: "外部人事の原本改定", base: `第${chain.revision}改定`, current: now ? `第${now.revision}改定` : "（なし）", proposed: `第${chain.revision + 1}改定として追加` },
        ...shown.after.map((fact) => ({ label: fact.label, base: shown.before.find((item) => item.label === fact.label)?.text ?? "（なし）", current: "（読み直した台帳を確認してください）", proposed: fact.text })),
      ] }))} busy={sender.busy}
      confirmLabel={confirmLabel}
      onConfirm={() => void save()} onBack={() => { sender.clear(); setConfirming(false); setRebased(false); steps.moveTo("content"); }}
      onReviewed={() => { if (sender.outcome.kind === "conflict" && sender.outcome.current) setAgainst(sender.outcome.current.revision); sender.clear(); setRebased(true); }}>
      {rebased && <p className="ideal-note" role="status">読み直した台帳の改定（第{chain.revision}改定）に続く訂正として確認し直します。内容を確認して、もう一度記録してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
