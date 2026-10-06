"use client";

import { useId, useState, type ReactNode } from "react";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { CheckField } from "../../shared/records/fields";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type Named, type PreservationBody, type PreservationReviewed, type Projection } from "../api";
import { readProblem } from "./ApplyControl";
import { nameIn } from "./model";
import WhyDisabled from "../../shared/WhyDisabled";
import Identifiers from "../../shared/Identifiers";

/** The retained record as nested, labelled lines: every field and every value, nothing left out. */
function Content({ value }: { value: unknown }): ReactNode {
  if (Array.isArray(value)) return value.length ? <ol className="ideal-note-list">{value.map((item, index) => <li className="ideal-note" key={index}><Content value={item} /></li>)}</ol> : "（なし）";
  if (value && typeof value === "object") return <ul role="list" className="ideal-note-list">{Object.entries(value).map(([name, item]) => <li className="ideal-note" key={name}>{name}：<Content value={item} /></li>)}</ul>;
  return value === null || value === undefined || value === "" ? "（なし）" : String(value);
}

/**
 * The preservation decision on one shared record: read exactly what would be kept of the
 * other people once this person is removed, record that it was checked, confirm. Nothing
 * is erased here; the copies are checked again afterwards.
 */
export default function PreservationReview({ copyId, label, personId, people, onRecorded }: { copyId: string; label: string; personId: string; people: Named[]; onRecorded: (said: string) => void }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const [projection, setProjection] = useState<Projection | null>(null);
  const [problem, setProblem] = useState<ProblemModel | null>(null);
  const [reading, setReading] = useState(false);
  const [entry, setEntry] = useState({ reference: "", reviewer: "", checked: false });
  const [body, setBody] = useState<PreservationBody | null>(null);
  const send = useConfirmedSend<PreservationBody, PreservationReviewed, Projection>({
    name: `preservation:${copyId}:${personId}`,
    send: (request, key) => api.reviewPreservation(live.scopeId, { ...request, idempotency_key: key }),
    readCurrent: () => api.copyProjection(live.scopeId, copyId, personId),
  });
  useUnsavedNavigation(entry.reference !== "" || entry.reviewer !== "");

  async function load() {
    setReading(true); setProblem(null); setProjection(null); setBody(null); send.clear(); setEntry((old) => ({ ...old, checked: false }));
    try { setProjection(await api.copyProjection(live.scopeId, copyId, personId)); } catch (error) { setProblem(readProblem(error)); } finally { setReading(false); }
  }
  async function save() {
    if (!body) return;
    const result = await send.run(body);
    if (!result.done) return;
    setBody(null); setProjection(null); setEntry({ reference: "", reviewer: "", checked: false });
    onRecorded(`${label}：保全判断を記録しました（第${result.result.revision}版）。何も消去していません。コピーの残存を確認し直してください。`);
  }
  const kept = (item: Projection | null) => (item ? item.person_ids.map((person) => nameIn(people, person)).join("、") || "（なし）" : "（なし）");

  return <details className="ideal-v3-disclosure"><summary>{label}：共有記録を再構成して他の職員の履歴を保全する</summary>
    <div className="ideal-v3-record" role="group" aria-label={`${label}：共有記録を再構成して他の職員の履歴を保全する`}>
      <p className="ideal-note">この操作は消去の実行ではありません。保存する内容と自由記述を確認した後、コピーの残存を確認し直してください。再構成した後の記録は、計算の入力や公開版としては再利用できません。</p>
      {!body && <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" disabled={reading} onClick={() => void load()}>保全する内容を読み込む</button></div>}
      {problem && <InlineProblem problem={problem} />}
      {projection && !body && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); if (!entry.checked) return; send.clear(); setBody({ expected_revision: projection.revision, payload: { copy_id: copyId, person_id: personId, content_hash: projection.source_digest, projection_hash: projection.payload_hash, shared_text_reviewed: true, evidence: { reference: entry.reference, verified_by: entry.reviewer, status: "verified" } } }); }}>
        <dl className="ideal-definition-list">
          <div><dt>保全する職員</dt><dd>{kept(projection)}</dd></div>
          <div><dt>除去される内容</dt><dd>{Object.entries(projection.payload.removed_counts).filter(([, count]) => count > 0).map(([name, count]) => `${name}：${count}件`).join("、") || "なし"}</dd></div>
          <div><dt>保存する内容の項目</dt><dd>{Object.entries(projection.payload.retained).map(([name, value]) => `${name}${Array.isArray(value) ? `：${value.length}件` : ""}`).join("、") || "なし"}</dd></div>
        </dl>
        <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>再構成後に保存する全内容を確認する</summary>
          <div role="region" aria-label="再構成後に保存する全内容" tabIndex={0}><Content value={projection.payload.retained} /></div>
        </details>
        <Identifiers items={[{ label: "原本の照合値", value: projection.source_digest }, { label: "再構成後の照合値", value: projection.payload_hash }]} />
        <label htmlFor={`${id}-reference`}>保全・消去判断の根拠</label>
        <input id={`${id}-reference`} className="ideal-input" required value={entry.reference} onChange={(event) => setEntry({ ...entry, reference: event.target.value })} />
        <label htmlFor={`${id}-reviewer`}>確認者</label>
        <input id={`${id}-reviewer`} className="ideal-input" required value={entry.reviewer} onChange={(event) => setEntry({ ...entry, reviewer: event.target.value })} />
        <CheckField label="他の職員の必要な情報が保持され、自由記述・共通情報にも消去対象者の情報が残らないことを、この内容で確認した" checked={entry.checked} onChange={(checked) => setEntry({ ...entry, checked })} />
        <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={!entry.checked} aria-describedby={entry.checked ? undefined : `${id}-why`}>保全判断の内容を確認する</button></div>
        <WhyDisabled id={`${id}-why`}>{!entry.checked && "上の確認にチェックを入れると押せます。"}</WhyDisabled>
      </form>}
      {projection && body && <ConfirmSurface title={`${label}の保全判断：記録前の確認`} level={4}
        changes={[{ label: "保全判断", before: "（なし）", after: `${kept(projection)}の履歴を保全する内容を確認済みとして記録` }, { label: "保全・消去判断の根拠", before: "（なし）", after: body.payload.evidence.reference, verbatim: true }, { label: "確認者", before: "（なし）", after: body.payload.evidence.verified_by ?? "", verbatim: true }]}
        version={{ from: projection.revision, to: projection.revision + 1 }}
        notified="誰にも通知されません。保全判断の記録（保存物・操作者・時刻）は監査の履歴に残ります。"
        risk={`記録前の時点では検出されていません。記録時にサーバーが、この共有記録が第${projection.revision}版のままで内容が変わっていないこと、再構成した内容が読み込んだ時と同じであること、対象者一覧と根拠が確認済みであることを照合します。違っていれば記録せず、競合または拒否として知らせます。1件の判断だけを記録するため、一部だけが記録されることはありません。`}
        outcome={conflictOutcome(send.outcome, (current) => ({
          currentRevision: current?.revision ?? null,
          rows: [
            { label: "共有記録の版", base: `第${projection.revision}版`, current: current ? `第${current.revision}版` : "（なし）", proposed: `第${projection.revision}版に対して記録` },
            { label: "保全する職員", base: kept(projection), current: kept(current), proposed: kept(projection) },
            { label: "再構成後の照合値", base: projection.payload_hash, current: current?.payload_hash ?? "（なし）", proposed: projection.payload_hash },
          ],
        }))}
        busy={send.busy} confirmLabel="この保全判断を記録する"
        onConfirm={() => void save()} onBack={() => { setBody(null); send.clear(); }}
        onReviewed={() => { const now = send.outcome.kind === "conflict" ? send.outcome.current : null; send.clear(); setBody(null); setProjection(now); setEntry((old) => ({ ...old, checked: false })); }} />}
    </div>
  </details>;
}
