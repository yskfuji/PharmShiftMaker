"use client";

import { useId, useState } from "react";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { CheckField } from "../../shared/records/fields";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type JointReview as Review, type JointReviewBody, type Named } from "../api";
import { readProblem } from "./ApplyControl";
import { nameIn } from "./model";

const ownersText = (review: Review | null, people: Named[]) => (review ? review.context.owners.map((owner) => nameIn(people, owner)).join("、") : "（なし）");

/**
 * The joint decision on one shared file copy: read every owner with their current
 * decision and the rule that applies, record that all of it was compared with the source,
 * confirm. It approves nothing by itself and erases nothing; the plan is made again afterwards.
 */
export default function JointReview({ copyId, label, people, onRecorded }: { copyId: string; label: string; people: Named[]; onRecorded: () => void }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const [review, setReview] = useState<Review | null>(null);
  const [problem, setProblem] = useState<ProblemModel | null>(null);
  const [reading, setReading] = useState(false);
  const [entry, setEntry] = useState({ reason: "", reference: "", reviewer: "", compared: false });
  const [body, setBody] = useState<JointReviewBody | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<JointReviewBody, Record<string, unknown>, Review>({
    name: `joint-review:${copyId}`,
    send: (request, key) => api.saveJointReview(live.scopeId, copyId, { ...request, idempotency_key: key }),
    readCurrent: () => api.jointReview(live.scopeId, copyId),
  });
  useUnsavedNavigation(entry.reason !== "" || entry.reference !== "" || entry.reviewer !== "");

  async function load() {
    setReading(true); setProblem(null); setReview(null); setBody(null); setDone(null); send.clear();
    try { setReview(await api.jointReview(live.scopeId, copyId)); } catch (error) { setProblem(readProblem(error)); } finally { setReading(false); }
  }
  async function save() {
    if (!body) return;
    const result = await send.run(body);
    if (!result.done) return;
    setBody(null); setReview(null); setEntry({ reason: "", reference: "", reviewer: "", compared: false });
    setDone("共同消去の判断を記録しました。保存物は消去していません。消去計画を作り直してください。");
    onRecorded();
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear(); setBody(null); setReview(now); setEntry((old) => ({ ...old, compared: false }));
  }

  return <details className="ideal-v3-disclosure"><summary>{label}の共同消去判断</summary>
    <div className="ideal-v3-record" role="group" aria-label={`${label}の共同消去判断`}>
      <p className="ideal-note">全所有者の判断を確認します。自動で承認することも、消去を実行することもありません。共同の自由記述も、原本と根拠資料で確認してください。</p>
      {!body && <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" disabled={reading} onClick={() => void load()}>全所有者と現在の判断を取得する</button></div>}
      {problem && <InlineProblem problem={problem} />}
      {review && !body && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); if (!entry.compared) return; setDone(null); send.clear(); setBody({ expected_revision: review.revision, source_hash: review.source_hash, context_hash: review.context_hash, shared_text_reviewed: true, reason: entry.reason, evidence: { reference: entry.reference, verified_by: entry.reviewer, status: "verified" } }); }}>
        <ul className="ideal-note-list" aria-label="全所有者と本人対応判断">{review.context.owners.map((owner) => {
          const participant = review.context.participants.find((item) => item.person_id === owner);
          return <li key={owner}>{nameIn(people, owner)}：{participant?.case_reason ?? "判断理由は原本で照合してください"}（判断 {participant ? `第${participant.case_revision}版` : "未確認"}）</li>;
        })}</ul>
        <p className="ideal-note">現在の保存規則：{review.context.policy_purpose ?? "利用目的は原本で照合してください"}（第{review.context.policy_revision}版）</p>
        <details className="ideal-v3-disclosure"><summary>識別情報</summary>
          <ul className="ideal-note-list">{review.context.participants.map((item) => <li className="ideal-note" key={item.person_id}>{nameIn(people, item.person_id)}：人物参照 {item.person_id}／本人対応参照 {item.case_id}／判断の照合値 {item.case_hash}／制御の照合値 {item.control_hash}</li>)}</ul>
          <p className="ideal-note">規則参照 {review.context.policy_key}／規則の照合値 {review.context.policy_hash}／原本の照合値 {review.source_hash}</p>
        </details>
        <label htmlFor={`${id}-reason`}>共同消去の判断理由</label>
        <textarea id={`${id}-reason`} className="ideal-input" required maxLength={2000} value={entry.reason} onChange={(event) => setEntry({ ...entry, reason: event.target.value })} />
        <label htmlFor={`${id}-reference`}>全所有者と原本を照合した資料</label>
        <input id={`${id}-reference`} className="ideal-input" required value={entry.reference} onChange={(event) => setEntry({ ...entry, reference: event.target.value })} />
        <label htmlFor={`${id}-reviewer`}>共同消去の確認者</label>
        <input id={`${id}-reviewer`} className="ideal-input" required value={entry.reviewer} onChange={(event) => setEntry({ ...entry, reviewer: event.target.value })} />
        <CheckField label="全所有者・現在の判断・保存規則・共同自由記述を原本と照合した" checked={entry.compared} onChange={(compared) => setEntry({ ...entry, compared })} />
        <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={!entry.compared}>共同判断の内容を確認する</button></div>
      </form>}
      {review && body && <ConfirmSurface title={`${label}の共同判断：記録前の確認`} level={4}
        changes={[{ label: "共同消去の判断", before: "（なし）", after: `全所有者（${ownersText(review, people)}）の判断を原本と照合済みとして記録` }, { label: "共同消去の判断理由", before: "（なし）", after: body.reason }, { label: "照合した資料", before: "（なし）", after: body.evidence.reference }, { label: "共同消去の確認者", before: "（なし）", after: body.evidence.verified_by ?? "" }]}
        version={{ from: review.revision, to: review.revision }}
        versionText={`保存物（第${review.revision}版）に、共同消去の判断を1件記録します。保存物は消去されません。`}
        notified="誰にも通知されません。共同判断の記録（操作者・時刻）は監査の履歴に残ります。"
        risk={`記録前の時点では検出されていません。記録時にサーバーが、保存物が第${review.revision}版のままであること、所有者・各自の判断・保存規則が取得した時から変わっていないことを照合します。違っていれば記録せず、競合として知らせます。1件の判断だけを記録するため、一部だけが記録されることはありません。`}
        outcome={conflictOutcome(send.outcome, (current) => ({
          currentRevision: current?.revision ?? null,
          rows: [
            { label: "保存物の版", base: `第${review.revision}版`, current: current ? `第${current.revision}版` : "（なし）", proposed: `第${review.revision}版に対して記録` },
            { label: "所有者", base: ownersText(review, people), current: ownersText(current, people), proposed: ownersText(review, people) },
            { label: "所有者・判断・規則の照合値", base: review.context_hash, current: current?.context_hash ?? "（なし）", proposed: review.context_hash },
          ],
        }))}
        busy={send.busy} confirmLabel="この共同判断を記録する"
        onConfirm={() => void save()} onBack={() => { setBody(null); send.clear(); }} onReviewed={reviewed} />}
      <p className="ideal-done" role="status">{done ?? ""}</p>
    </div>
  </details>;
}
