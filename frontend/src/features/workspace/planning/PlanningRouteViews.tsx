"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, FileUp, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import ContextLink from "@/features/workspace/shared/ContextLink";
import ContractWorkflow from "@/features/workspace/people/ContractWorkflow";
import PublicationExport from "@/features/workspace/planning/PublicationExport";
import { PlanningError } from "@/lib/planningTransport";
import type { Draft, InputLatest } from "@/ideal/api/client";
import type { LiveApi } from "@/ideal/live/context";
import { ActionStatus, EvidenceFields, EMPTY_EVIDENCE, evidenceReady, Loaded, useAction } from "@/ideal/live/parts";
import { browserNavigation } from "@/lib/browserNavigation";
import { useResource } from "@/ideal/live/useResource";
import { StatusPill } from "@/ideal/screens/shared";

const steps = ["前提確認", "候補生成", "案比較", "確認・編集", "公開"];

function Stepper({ current }: { current: number }) {
  return <ol className="ideal-stepper" aria-label="計画の工程">{steps.map((name, index) => <li key={name} aria-current={index === current ? "step" : undefined} className={index === current ? "is-current" : index < current ? "is-done" : ""}><span>{index < current ? <Check aria-hidden="true" /> : index + 1}</span><strong>{name}</strong></li>)}</ol>;
}

function InputSummary({ input }: { input: InputLatest }) {
  const snapshot = input.snapshot;
  const rows = [
    ["対象期間", snapshot.period ? `${snapshot.period.start.slice(0, 10)}〜${snapshot.period.end.slice(0, 10)}` : "未確認"],
    ["職員", `${snapshot.people.length}名`],
    ["契約", `${snapshot.contracts?.length ?? 0}件`],
    ["資格", `${snapshot.capabilities?.length ?? 0}件`],
    ["必要配置", `${snapshot.demands?.length ?? 0}件`],
    ["勤務候補", `${snapshot.candidates?.length ?? 0}件`],
  ];
  return <dl className="ideal-definition-list">{rows.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>;
}

export function PlanningInputView({ live }: { live: LiveApi }) {
  const id = useId();
  const input = useResource(() => live.client.inputLatest(live.scopeId), live.scopeId);
  const refresh = useAction(); const derive = useAction(); const upload = useAction();
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const [preview, setPreview] = useState<{ name: string; snapshot: unknown } | null>(null);
  return <div className="ideal-stack"><Stepper current={0} /><Loaded resource={input}>{(data) => <>
    <section className="ideal-toolbar"><div><span className="ideal-eyebrow">入力版 {data.input_revision}</span><h2>生成前提を確定</h2><p>入力元、契約・資格、必要配置、古い版の有無を一つずつ確認します。</p></div><StatusPill tone={data.stale ? "warn" : "good"}>{data.stale ? "再導出が必要" : "前提は最新"}</StatusPill></section>
    <section className="ideal-panel" aria-labelledby={`${id}-check`}><h2 id={`${id}-check`}>前提チェック</h2><InputSummary input={data} />
      {data.stale && <p className="ideal-note" role="alert">申請・実績または原本が更新されています。この入力版のまま生成しないでください。</p>}
      {live.role === "ADMIN" && <button type="button" className="ideal-button ideal-button--secondary" disabled={refresh.busy} onClick={() => void refresh.run(async () => { await live.client.refreshInput(live.scopeId, data.input_revision); await input.reload(); return "最新の申請・実績を反映した入力版を作りました。"; })}>申請・実績を計画に反映</button>}
      <ActionStatus problem={refresh.problem} done={refresh.done} />
    </section>
    <details className="ideal-v3-disclosure"><summary>必要配置・資格要件を確認・編集</summary><div className="ideal-panel"><p>対象入力版に対する時間帯別の必要配置を、原本確認付きで登録します。登録後は入力版を再導出してください。</p><ContractWorkflow scope={live.scopeId} inputHash={data.input_hash} group="demand" onChanged={() => input.reload()} /></div></details>
    {live.role === "ADMIN" && <section className="ideal-panel" aria-labelledby={`${id}-derive`}><h2 id={`${id}-derive`}>契約・資格から勤務候補を再導出</h2><p>承認済みの正本だけをサーバーが使い、元の入力版を上書きせず新しい版を作ります。</p><EvidenceFields value={evidence} onChange={setEvidence} legend="再導出の根拠" /><button type="button" className="ideal-button ideal-button--primary" disabled={derive.busy || !evidenceReady(evidence)} onClick={() => void derive.run(async () => { await live.mutate("derive-candidates", { expected_version: data.input_revision, evidence }, (key) => live.client.deriveCandidates(live.scopeId, { expected_version: data.input_revision, evidence, idempotency_key: key })); setEvidence(EMPTY_EVIDENCE); await input.reload(); return "新しい不変の入力版を作りました。"; })}>新しい入力版を作る</button><ActionStatus problem={derive.problem} done={derive.done} /></section>}
    {live.role === "ADMIN" && <section className="ideal-panel" aria-labelledby={`${id}-import`}><h2 id={`${id}-import`}>入力ファイルの取込</h2><p>JSONをブラウザ内で先に読み、scope・期間・件数を確認してから登録します。</p><label className="ideal-file"><FileUp aria-hidden="true" />JSONを選ぶ<input type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { void upload.run(async () => { throw new Error("取込ファイルは5MB以内にしてください。"); }); return; } void file.text().then((text) => setPreview({ name: file.name, snapshot: JSON.parse(text) })).catch(() => void upload.run(async () => { throw new Error("JSONとして読めませんでした。"); })); }} /></label>{preview && <div className="ideal-confirm"><h3>{preview.name}</h3><p>登録前の確認です。既存入力は上書きせず、新しい入力版を作ります。</p><button type="button" className="ideal-button ideal-button--primary" disabled={upload.busy} onClick={() => void upload.run(async () => { await live.client.registerInput(live.scopeId, { snapshot: preview.snapshot, expected_revision: data.input_revision }); setPreview(null); await input.reload(); return "入力を登録しました。"; })}>この内容で登録</button><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setPreview(null)}>取り消す</button></div>}<ActionStatus problem={upload.problem} done={upload.done} /></section>}
    <ContextLink className="ideal-button ideal-button--primary" href="/workspace/plan/generate">前提を確認して候補生成へ <ChevronRight aria-hidden="true" /></ContextLink>
  </>}</Loaded></div>;
}

export function PlanningDraftView({ live }: { live: LiveApi }) {
  const searchParams = useSearchParams();
  // Next's hook is nullable in router-free renderers (Storybook/Jest). The
  // production router still supplies the real query string; the empty value is
  // only the deterministic synthetic default used by those renderers.
  const params = useMemo(() => searchParams ?? new URLSearchParams(), [searchParams]);
  const draftId = params.get("draft") ?? (live.isSynthetic ? "synthetic-draft-1" : "");
  const input = useResource(() => live.client.inputLatest(live.scopeId), live.scopeId);
  const draft = useResource(() => draftId ? live.client.draft(live.scopeId, draftId) : Promise.resolve(null), `${live.scopeId}|${draftId}`);
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<{ hash: string; version: number } | null>(null);
  const [conflict, setConflict] = useState<{ base: Draft; current: Draft; proposed: string[] } | null>(null);
  const preserveAfterConflict = useRef<string[] | null>(null);
  const save = useAction(); const check = useAction(); const publish = useAction();
  useEffect(() => {
    if (!draft.data) return;
    const preserved = preserveAfterConflict.current;
    preserveAfterConflict.current = null;
    setSelected(preserved ?? draft.data.proposal.duty_ids);
  }, [draft.data]);
  if (!draftId) return <div className="ideal-stack"><Stepper current={3} /><section className="ideal-empty"><h2>確認する案が指定されていません</h2><ContextLink className="ideal-button ideal-button--primary" href="/workspace/plan/compare">案比較へ</ContextLink></section></div>;
  return <div className="ideal-stack"><Stepper current={3} /><Loaded resource={draft}>{(value) => value && <Loaded resource={input}>{(source) => {
    const candidates = source.snapshot.candidates ?? [];
    const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...value.proposal.duty_ids].sort());
    return <section className="ideal-panel"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">勤務案 版{value.version}</span><h2>割当を確認・編集</h2></div><StatusPill tone={dirty ? "warn" : review ? "good" : "info"}>{dirty ? "未保存" : review ? "検証済み" : "未検証"}</StatusPill></div>
      <p>保存、サーバー検証、公開は別の操作です。競合時は現在版を読み直して三者差分を確認します。</p>
      {conflict && <section className="ideal-inline-problem" role="alert" aria-labelledby="draft-conflict-title">
        <StatusPill tone="warn">409</StatusPill><div><h3 id="draft-conflict-title">勤務案の更新競合</h3>
          <p>編集開始時（第{conflict.base.version}版）：{conflict.base.proposal.duty_ids.join("、") || "割当なし"}</p>
          <p>現在（第{conflict.current.version}版）：{conflict.current.proposal.duty_ids.join("、") || "割当なし"}</p>
          <p>編集中：{conflict.proposed.join("、") || "割当なし"}</p>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => void (async () => {
            const proposed = conflict.proposed;
            preserveAfterConflict.current = proposed;
            setConflict(null); setReview(null);
            await draft.reload();
          })()}>三つの勤務案を確認して編集を続ける</button>
        </div>
      </section>}
      <div className="ideal-table-wrap" role="region" aria-label="勤務案の割当" tabIndex={0}><table className="ideal-table"><thead><tr><th scope="col">採用</th><th scope="col">職員</th><th scope="col">日時</th><th scope="col">業務・場所</th></tr></thead><tbody>{candidates.map((candidate) => <tr key={candidate.duty_id}><td><label className="ideal-check-target"><input type="checkbox" checked={selected.includes(candidate.duty_id)} onChange={(event) => { setReview(null); setSelected((old) => event.target.checked ? [...old, candidate.duty_id] : old.filter((id) => id !== candidate.duty_id)); }} /><span className="sr-only">{candidate.duty_id}を採用</span></label></td><td>{live.nameOf(candidate.person_id)}</td><td>{candidate.start}〜{candidate.end}</td><td>{candidate.task}・{candidate.location}</td></tr>)}</tbody></table></div>
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" disabled={!dirty || save.busy || Boolean(conflict)} onClick={() => { check.clear(); void save.run(async () => {
        const body = { version: value.version, proposal: { ...value.proposal, duty_ids: selected } };
        try {
          await live.mutate(`draft-edit:${draftId}`, body, (key) => live.client.updateDraft(live.scopeId, draftId, { ...body, idempotency_key: key }));
        } catch (error) {
          if (!(error instanceof PlanningError) || error.status !== 409) throw error;
          const current = await live.client.draft(live.scopeId, draftId);
          setConflict({ base: value, current, proposed: [...selected] }); setReview(null);
          return "別の担当者の変更を検出しました。三つの内容を確認してください。";
        }
        setReview(null); setConflict(null); await draft.reload(); return "編集を保存しました。検証は解除されています。";
      }); }}>編集を保存</button><button type="button" className="ideal-button ideal-button--secondary" disabled={dirty || check.busy || Boolean(conflict)} onClick={() => { save.clear(); void check.run(async () => { const current = await live.client.draft(live.scopeId, draftId); const result = await live.mutate(`draft-review:${draftId}`, { version: current.version }, (key) => live.client.review(live.scopeId, draftId, { version: current.version, idempotency_key: key })); if (!result.publishable || !result.review_hash) throw new Error(`公開できない指摘が${result.findings.length}件あります。`); setReview({ hash: result.review_hash, version: current.version }); return "サーバー検証を通過しました。公開前確認へ進めます。"; }); }}>サーバーで再検証</button></div>
      <ActionStatus problem={save.problem ?? check.problem} done={save.done ?? check.done} />
      {review && <div className="ideal-confirm"><ShieldCheck aria-hidden="true" /><h3>公開前の最終確認</h3><dl className="ideal-definition-list"><div><dt>scope</dt><dd>{live.scopeId}</dd></div><div><dt>入力版</dt><dd>{source.input_revision}</dd></div><div><dt>選択案</dt><dd>{draftId}</dd></div><div><dt>割当</dt><dd>{selected.length}件</dd></div><div><dt>通知</dt><dd>関係する職員</dd></div></dl><p>実行すると既存版を上書きせず、新しい公開版を作ります。</p><button type="button" className="ideal-button ideal-button--primary" disabled={publish.busy} onClick={() => void publish.run(async () => { const body = { version: review.version, expected_publication_version: source.publication_version, input_hash: source.input_hash, review_hash: review.hash }; const result = await live.mutate(`draft-publish:${draftId}`, body, (key) => live.client.publish(live.scopeId, draftId, { ...body, idempotency_key: key })); if (browserNavigation.pathname().startsWith("/workspace/")) { const period = source.snapshot.period.start.slice(0, 7); const query = new URLSearchParams({ scope: live.scopeId, period, publication: result.publication_id }); browserNavigation.replaceWithFlash(`/workspace/schedule?${query}`, "plan-published"); return; } live.refresh(); return `公開版 v${result.version} を作成しました。`; })}>確認した案を公開</button></div>}
      <ActionStatus problem={publish.problem} done={publish.done} />
    </section>;
  }}</Loaded>}</Loaded></div>;
}

export function PlanningPublicationsView({ live }: { live: LiveApi }) {
  const publications = useResource(() => live.client.publications(live.scopeId), live.scopeId);
  const notices = useResource(() => live.client.notifications(live.scopeId), live.scopeId);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const cancel = useAction();
  return <div className="ideal-stack"><Stepper current={4} /><section className="ideal-panel"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">公開履歴</span><h2>公開版と通知</h2></div></div><Loaded resource={publications}>{(items) => items.length ? <div className="ideal-record-list">{items.map((item) => <article key={item.publication_id}><div><strong>公開版 v{item.version}</strong><StatusPill tone={item.validation_status === "revalidation_required" ? "warn" : "good"}>{item.validation_status === "revalidation_required" ? "再検証が必要" : "公開時に検証済み"}</StatusPill></div><p>{item.period.replace("|", " 〜 ")} · {item.assignments.length}件</p><PublicationExport scope={live.scopeId} publication={item.publication_id} version={item.version} /><div className="ideal-actions"><button type="button" className="ideal-button ideal-button--danger" onClick={() => { setTarget(item.publication_id); setReason(""); }}>公開を取り消す</button></div>{target === item.publication_id && <div className="ideal-confirm"><h3>公開取消の確認</h3><p>勤務の再調整と関係者への通知が必要です。取消前の版と監査記録は残ります。</p><label>理由<textarea className="ideal-input" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="ideal-button ideal-button--danger" disabled={!reason.trim() || cancel.busy} onClick={() => void cancel.run(async () => { const body = { expected_version: item.version, reason }; await live.mutate(`publication-cancel:${item.publication_id}`, body, (key) => live.client.cancelPublication(live.scopeId, item.publication_id, { ...body, idempotency_key: key })); setTarget(null); setReason(""); await publications.reload(); await notices.reload(); browserNavigation.replaceWithFlash(browserNavigation.pathAndSearch(), "publication-cancelled"); })}>理由を記録して公開取消</button><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTarget(null)}>やめる</button></div>}</article>)}</div> : <p className="ideal-note">公開版はありません。</p>}</Loaded><ActionStatus problem={cancel.problem} done={cancel.done} /></section>
    <section className="ideal-panel"><h2>公開通知</h2><Loaded resource={notices}>{(items) => items.length ? <ol className="ideal-timeline">{items.map((item) => <li key={item.event_id}><span /><div><strong>{item.kind}</strong><p>公開版 {item.version ?? "—"} · {item.read ? "確認済み" : "未確認"}</p></div><time>{item.created_at}</time></li>)}</ol> : <p className="ideal-note">公開通知はありません。</p>}</Loaded></section></div>;
}
