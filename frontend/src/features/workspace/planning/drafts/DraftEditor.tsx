"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { Draft } from "@/ideal/api/client";
import { ActionStatus, Loaded, useAction } from "@/ideal/live/parts";
import { StatusPill } from "@/ideal/ui/atoms";
import { browserNavigation } from "@/lib/browserNavigation";
import { PlanningError } from "@/lib/planningTransport";
import type { Seed } from "../../shared/seed";
import { useSeededResource } from "../../shared/useSeededResource";
import { routeOf } from "../../shell/routeTypes";
import { onWorkspaceRoute, workspaceHrefWithContext } from "../../shell/workspaceHref";
import { useLive } from "../../shell/WorkspaceRuntime";
import type { DraftSource } from "./DraftsView";

/**
 * The plan named by `?draft=`, as the route read it; it is read here again only after a
 * save, after a conflict and to try again after a refusal. Saving, the server's check and publishing are three
 * changes, each with its own idempotency key. A 409 on saving is never rebased silently:
 * the plan at the start of the edit, the current one and the edit are shown together, and
 * the edit is kept. The ticked duties are the draft; a passed check is kept only until the
 * next edit.
 */
export default function DraftEditor({ source, draftId, seed }: { source: DraftSource; draftId: string; seed: Seed<Draft> }) {
  const live = useLive();
  const draft = useSeededResource(seed, () => live.client.draft(live.scopeId, draftId));
  const [selected, setSelected] = useState<string[]>(seed.data?.proposal.duty_ids ?? []);
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

  return <Loaded resource={draft}>{(value) => {
    const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...value.proposal.duty_ids].sort());
    return <section className="ideal-panel"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">勤務案 版{value.version}</span><h2>割当を確認・編集</h2></div><StatusPill tone={dirty ? "warn" : review ? "good" : "info"}>{dirty ? "未保存" : review ? "検証済み" : "未検証"}</StatusPill></div>
      <p>保存、サーバー検証、公開は別の操作です。競合時は現在版を読み直して三者差分を確認します。</p>
      {conflict && <section className="ideal-inline-problem" role="alert" aria-labelledby="draft-conflict-title">
        <StatusPill tone="warn">409</StatusPill><div><h3 id="draft-conflict-title">勤務案の更新競合</h3>
          <p>編集開始時（第{conflict.base.version}版）：{conflict.base.proposal.duty_ids.join("、") || "割当なし"}</p>
          <p>現在（第{conflict.current.version}版）：{conflict.current.proposal.duty_ids.join("、") || "割当なし"}</p>
          <p>編集中：{conflict.proposed.join("、") || "割当なし"}</p>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => void (async () => {
            preserveAfterConflict.current = conflict.proposed;
            setConflict(null); setReview(null);
            await draft.reload();
          })()}>三つの勤務案を確認して編集を続ける</button>
        </div>
      </section>}
      <div className="ideal-table-wrap" role="region" aria-label="勤務案の割当" tabIndex={0}><table className="ideal-table"><thead><tr><th scope="col">採用</th><th scope="col">職員</th><th scope="col">日時</th><th scope="col">業務・場所</th></tr></thead><tbody>{source.candidates.map((candidate) => <tr key={candidate.duty_id}><td><label className="ideal-check-target"><input type="checkbox" checked={selected.includes(candidate.duty_id)} onChange={(event) => { setReview(null); setSelected((old) => event.target.checked ? [...old, candidate.duty_id] : old.filter((item) => item !== candidate.duty_id)); }} /><span className="sr-only">{candidate.duty_id}を採用</span></label></td><td>{live.nameOf(candidate.person_id)}</td><td>{candidate.start}〜{candidate.end}</td><td>{candidate.task}・{candidate.location}</td></tr>)}</tbody></table></div>
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
      }); }}>編集を保存</button><button type="button" className="ideal-button ideal-button--secondary" disabled={dirty || check.busy || Boolean(conflict)} onClick={() => { save.clear(); void check.run(async () => {
        const current = await live.client.draft(live.scopeId, draftId);
        const result = await live.mutate(`draft-review:${draftId}`, { version: current.version }, (key) => live.client.review(live.scopeId, draftId, { version: current.version, idempotency_key: key }));
        if (!result.publishable || !result.review_hash) throw new Error(`公開できない指摘が${result.findings.length}件あります。`);
        setReview({ hash: result.review_hash, version: current.version });
        return "サーバー検証を通過しました。公開前確認へ進めます。";
      }); }}>サーバーで再検証</button></div>
      <ActionStatus problem={save.problem ?? check.problem} done={save.done ?? check.done} />
      {review && <div className="ideal-confirm"><ShieldCheck aria-hidden="true" /><h3>公開前の最終確認</h3><dl className="ideal-definition-list"><div><dt>scope</dt><dd>{live.scopeId}</dd></div><div><dt>入力版</dt><dd>{source.inputRevision}</dd></div><div><dt>選択案</dt><dd>{draftId}</dd></div><div><dt>割当</dt><dd>{selected.length}件</dd></div><div><dt>通知</dt><dd>関係する職員</dd></div></dl><p>実行すると既存版を上書きせず、新しい公開版を作ります。</p><button type="button" className="ideal-button ideal-button--primary" disabled={publish.busy} onClick={() => void publish.run(async () => {
        const body = { version: review.version, expected_publication_version: source.publicationVersion, input_hash: source.inputHash, review_hash: review.hash };
        const result = await live.mutate(`draft-publish:${draftId}`, body, (key) => live.client.publish(live.scopeId, draftId, { ...body, idempotency_key: key }));
        if (onWorkspaceRoute(browserNavigation.pathname())) {
          browserNavigation.replaceWithFlash(workspaceHrefWithContext(routeOf("schedule/index").route, { scope: live.scopeId, period: source.period, publication: result.publication_id }), "plan-published");
          return;
        }
        await live.refresh();
        return `公開版 v${result.version} を作成しました。`;
      })}>確認した案を公開</button></div>}
      <ActionStatus problem={publish.problem} done={publish.done} />
    </section>;
  }}</Loaded>;
}
