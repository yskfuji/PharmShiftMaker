"use client";

import { useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type BackfillApplied, type BackfillPreview, type Named } from "../api";
import { nameIn } from "./model";

type Body = { expected_revision: 0; payload: { preview_hash: string } };

/**
 * Adds the person references that the account links say existing records lack: read the
 * server's candidates, confirm, add all of them. Nothing is guessed from names or free
 * text, and the source, its hash and its retention start are not changed.
 */
export default function Backfill({ candidates, people, onApplied }: { candidates: BackfillPreview; people: Named[]; onApplied: () => void }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const steps = useStepFocus<"content">();
  const [base, setBase] = useState<BackfillPreview | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<Body, BackfillApplied, BackfillPreview>({
    name: "copy-backfill",
    send: (body, key) => api.applyBackfill(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: () => api.backfillCandidates(live.scopeId),
  });
  const shown = base ?? candidates;
  const added = (item: BackfillPreview["changes"][number]) => item.additional_person_ids.map((person) => nameIn(people, person)).join("、") || "なし（部署の帰属だけを確定）";
  const summary = (preview: BackfillPreview | null) => (preview ? `追加候補 ${preview.changes.length}件・人物対応が未確定 ${preview.unresolved_copy_ids.length}件` : "（なし）");

  async function save() {
    if (!base) return;
    const result = await send.run({ expected_revision: 0, payload: { preview_hash: base.preview_hash } });
    if (!result.done) return;
    setBase(null); setRebased(false);
    setDone(`${result.result.updated_copies}件の記録に参照を追加しました。以前の対象者確認は無効になりました${result.result.subject_reviews_required ? "（サーバーの回答：対象者一覧の確認が必要）" : ""}。`);
    onApplied();
    steps.moveTo("content");
  }

  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("content")}>1. 追加候補を確かめる</h3>
    <p className="ideal-note">氏名や自由記述からは推測せず、アカウントの対応から人物参照の追加候補を抽出しています。原本・内容の照合値・保存の起算日は変更されません。</p>
    <dl className="ideal-definition-list">
      <div><dt>追加候補</dt><dd>{shown.changes.length}件</dd></div>
      <div><dt>人物対応が未確定の記録</dt><dd>{shown.unresolved_copy_ids.length}件</dd></div>
    </dl>
    {shown.changes.length === 0 ? <p className="ideal-note">サーバーが返した追加候補はありません。</p> : <>
      <ul className="ideal-note-list" aria-label="操作者参照の追加候補">{shown.changes.map((item, index) => <li key={item.copy_id}>記録 {index + 1}（第{item.revision}版）：追加する職員 {added(item)}</li>)}</ul>
      <details className="ideal-v3-disclosure"><summary>識別情報</summary><ul className="ideal-note-list">{shown.changes.map((item, index) => <li className="ideal-note" key={item.copy_id}>記録 {index + 1}：{item.copy_id}</li>)}</ul></details>
      {!base && <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--primary" onClick={() => { setDone(null); send.clear(); setRebased(false); setBase(candidates); }}>追加の内容を確認する</button></div>}
    </>}
    {base && <ConfirmSurface title="2. 追加前の確認"
      changes={base.changes.map((item, index) => ({ label: `記録 ${index + 1}`, before: `第${item.revision}版`, after: `第${item.revision + 1}版（追加する職員 ${added(item)}）` }))}
      version={{ from: 0, to: 1 }}
      versionText={`候補の記録 ${base.changes.length}件のそれぞれが、上の「変更内容」の版になります。対象者一覧の確認状態は、未確認に戻ります。`}
      notified="誰にも通知されません。追加を受け付けた記録は、サーバーに残ります。"
      risk="追加前の時点では検出されていません。追加時にサーバーが候補を作り直し、ここで確認した候補と同じであることを照合します。違っていれば1件も追加せず、競合として知らせます。全件を追加するか、1件も追加しないかのどちらかで、一部だけが追加されることはありません。"
      outcome={conflictOutcome(send.outcome, (current) => ({
        currentRevision: null,
        currentText: "記録が、候補を確認した後に変わりました。サーバーが作り直した候補を「現在」に示します。",
        rows: [{ label: "候補", base: summary(base), current: summary(current), proposed: summary(base) }],
      }))}
      busy={send.busy} confirmLabel="この確認版の参照を追加する" backLabel="追加せずに戻る"
      onConfirm={() => void save()} onBack={() => { setBase(null); setRebased(false); send.clear(); steps.moveTo("content"); }}
      onReviewed={() => { const now = send.outcome.kind === "conflict" ? send.outcome.current : null; send.clear(); if (now && now.changes.length) { setBase(now); setRebased(true); } else { setBase(null); onApplied(); } }}>
      {rebased && <p className="ideal-note" role="status">サーバーが作り直した候補に対する追加として確認し直します。候補を確かめて、もう一度操作してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
