"use client";

import { useId, useEffect, useRef, useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import type { Draft } from "@/ideal/api/client";
import { ActionStatus, Loaded, useAction } from "@/ideal/live/parts";
import { StatusPill } from "@/ideal/ui/atoms";
import { browserNavigation } from "@/lib/browserNavigation";
import { PlanningError } from "@/lib/planningTransport";
import { dutyWhen, isReadableWhen } from "../../shared/format";
import type { Seed } from "../../shared/seed";
import { useSeededResource } from "../../shared/useSeededResource";
import { routeOf } from "../../shell/routeTypes";
import { onWorkspaceRoute, workspaceHrefWithContext } from "../../shell/workspaceHref";
import { useLive } from "../../shell/WorkspaceRuntime";
import type { DraftSource } from "./DraftsView";
import TableScrollCue from "../../shared/TableScrollCue";
import WhyDisabled from "../../shared/WhyDisabled";
import Identifiers from "../../shared/Identifiers";

/** The three changes of this route, in their order. Each is its own request. */
const STEPS = ["保存", "サーバー検証", "公開"];
/** Under the two buttons while the check is the next step: what the second button is for
 * when its name says 「再検証」 and nothing has been checked on this screen. It says nothing
 * of the plan: whether the server has checked this plan before (and with what result) is
 * not something this editor reads, so the line names the button and no state. It gives way
 * to the outcome of a save or a check, which is said in its place. */
const FIRST_CHECK = "検証は「サーバーで再検証」で行います。初めて検証するときも、このボタンを使います。";
/** How a step stands, in words: its state is never told by colour alone. */
const STEP_STATE = { done: "済み", current: "次の操作", todo: "この後" };

/**
 * The plan named by `?draft=`, as the route read it; it is read here again only after a
 * save, after a conflict and to try again after a refusal. Saving, the server's check and publishing are three
 * changes, each with its own idempotency key. A 409 on saving is never rebased silently:
 * the plan at the start of the edit, the current one and the edit are shown together, and
 * the edit is kept. The ticked duties are the draft; a passed check is kept only until the
 * next edit or the next check. A check that found something is the server's answer and is
 * said as that (the number of its findings, each of which stops the publication:
 * domain/planning.py, `publishable`); only a request whose answer never came is an unknown
 * outcome. The check is of the version on this screen: the server refuses the check of a
 * version that is no longer the plan's (application/planning.py, `review_draft`), and the
 * plan is then shown again as it is now, unchecked.
 *
 * Where the edit stands among the three changes is shown above the table and decides which
 * button is filled: an unsaved edit is saved first, a saved plan is checked next, a checked
 * plan is published from the confirmation; while a conflict is shown, continuing from it is
 * the one filled button. That is this editor's own state (`dirty`, `review`, `conflict`),
 * not a judgement of the plan: whether it may be published is the server's answer.
 */
export default function DraftEditor({ source, draftId, seed, scopeName }: { source: DraftSource; draftId: string; seed: Seed<Draft>; scopeName: string }) {
  const live = useLive();
  const id = useId();
  const draft = useSeededResource(seed, () => live.client.draft(live.scopeId, draftId));
  const [selected, setSelected] = useState<string[]>(seed.data?.proposal.duty_ids ?? []);
  const [review, setReview] = useState<{ hash: string; version: number } | null>(null);
  const [conflict, setConflict] = useState<{ base: Draft; current: Draft; proposed: string[] } | null>(null);
  // The server's answer to the last check when it found something: how many findings. The
  // server answered, so this is not an unknown outcome and is not shown as one.
  const [found, setFound] = useState<number | null>(null);
  // The plan was saved by someone else since this screen read it, found out by a check the
  // server refused for its version: the version now shown. Nothing was checked.
  const [moved, setMoved] = useState<number | null>(null);
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
    // The step to take next: 0 saving, 1 the server's check, 2 publishing.
    const next = dirty || conflict ? 0 : review ? 2 : 1;
    // Why the button that is not the next step cannot be pressed, while that is only a
    // matter of what the person has done so far (a conflict says its own, above).
    const why = conflict || review || save.busy || check.busy ? null : dirty ? "編集を保存すると「サーバーで再検証」を押せます。" : "「採用」のチェックを変えると「編集を保存」を押せます。";
    // The month the plan is for, as the route read it (YYYY-MM), for reading.
    // A duty of the plan whose day or hours cannot be read: the plan is not published from
    // here, because what would be published cannot be shown.
    const unreadable = source.candidates.some((candidate) => selected.includes(candidate.duty_id) && !isReadableWhen(candidate.start, candidate.end));
    const month = /^\d{4}-\d{2}$/.test(source.period) ? `${source.period.slice(0, 4)}年${Number(source.period.slice(5))}月` : source.period;
    return <section className="ideal-panel ideal-v3-planning-draft"><div className="ideal-panel__head ideal-v3-planning-head"><div><span className="ideal-eyebrow">勤務案 第{value.version}版</span><h2>割当を確認・編集</h2><p>保存、サーバーでの検証、公開は、別々の操作です。保存のときに別の担当者の変更と重なった場合は、上書きせずに知らせます。</p></div><StatusPill tone={dirty || found !== null ? "warn" : review ? "good" : "info"}>この勤務案：{dirty ? "未保存" : found !== null ? "指摘あり" : review ? "検証済み" : "未検証"}</StatusPill></div>
      <p className="ideal-v3-planning-process__caption">この画面での流れ</p>
      <ol className="ideal-v3-mini-process ideal-v3-planning-process" aria-label="公開までの手順">{STEPS.map((name, index) => {
        const state = index < next ? "done" : index === next ? "current" : "todo";
        return <li key={name} className={state === "done" ? "is-done" : state === "current" ? "is-current" : undefined} aria-current={state === "current" ? "step" : undefined}><span>{state === "done" ? <Check aria-hidden="true" /> : index + 1}</span><strong>{name}</strong><small>{STEP_STATE[state]}</small></li>;
      })}</ol>
      {conflict && <section className="ideal-v3-callout ideal-v3-callout--warn ideal-v3-planning-conflict" role="alert" aria-labelledby="draft-conflict-title">
        <h3 id="draft-conflict-title" className="ideal-v3-heading">勤務案の更新競合</h3>
        <p>編集中に、別の担当者がこの勤務案を保存しました。編集は保存されていません。三つの内容を確認して続けると、編集中の内容を現在の版の上に残します。</p>
        <dl className="ideal-definition-list"><div><dt>編集開始時（第{conflict.base.version}版）</dt><dd>採用 {conflict.base.proposal.duty_ids.length}件</dd></div><div><dt>現在（第{conflict.current.version}版）</dt><dd>採用 {conflict.current.proposal.duty_ids.length}件</dd></div><div><dt>編集中</dt><dd>採用 {conflict.proposed.length}件</dd></div></dl>
        <Identifiers summary="採用した勤務の識別子" items={[
          { label: `編集開始時（第${conflict.base.version}版）`, values: conflict.base.proposal.duty_ids, none: "割当なし" },
          { label: `現在（第${conflict.current.version}版）`, values: conflict.current.proposal.duty_ids, none: "割当なし" },
          { label: "編集中", values: conflict.proposed, none: "割当なし" },
        ]} />
        <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--primary" onClick={() => void (async () => {
          preserveAfterConflict.current = conflict.proposed;
          setConflict(null); setReview(null);
          await draft.reload();
        })()}>三つの勤務案を確認して編集を続ける</button></div>
      </section>}
      <p className="ideal-note">「採用」にチェックの入った勤務だけが、この勤務案の割当になります。チェックを外すと、その勤務は割当から外れます。職員や時刻は、この画面では変えられません。変更は「編集を保存」を押すまで保存されません。</p>
      <TableScrollCue />
      <div className="ideal-table-wrap" role="region" aria-label="勤務案の割当" tabIndex={0}><table className="ideal-table"><thead><tr><th scope="col">採用</th><th scope="col">職員</th><th scope="col">日時</th><th scope="col">業務・場所</th></tr></thead><tbody>{source.candidates.map((candidate) => <tr key={candidate.duty_id}><td><label className="ideal-check-target"><input type="checkbox" checked={selected.includes(candidate.duty_id)} onChange={(event) => { setReview(null); setFound(null); setMoved(null); setSelected((old) => event.target.checked ? [...old, candidate.duty_id] : old.filter((item) => item !== candidate.duty_id)); }} /><span className="sr-only">{candidate.duty_id}を採用</span></label></td><td>{live.nameOf(candidate.person_id)}</td><td>{dutyWhen(candidate.start, candidate.end)}</td><td>{candidate.task}・{candidate.location}</td></tr>)}</tbody></table></div>
      <div className="ideal-actions"><button type="button" className={dirty && !conflict ? "ideal-button ideal-button--primary" : "ideal-button ideal-button--secondary"} disabled={!dirty || save.busy || Boolean(conflict)} aria-describedby={why && !dirty ? `${id}-why` : undefined} onClick={() => { check.clear(); setFound(null); setMoved(null); void save.run(async () => {
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
      }); }}>編集を保存</button><button type="button" className={next === 1 ? "ideal-button ideal-button--primary" : "ideal-button ideal-button--secondary"} disabled={dirty || check.busy || Boolean(conflict)} aria-describedby={why && dirty ? `${id}-why` : undefined} onClick={() => { save.clear(); setFound(null); setMoved(null); setReview(null); void check.run(async () => {
        // The version on this screen is the one checked. A plan someone else has saved
        // since is refused by the server for its version (409); it is then read again and
        // shown, and nothing is checked until the person has seen it.
        const version = value.version;
        let result;
        try {
          result = await live.mutate(`draft-review:${draftId}`, { version }, (key) => live.client.review(live.scopeId, draftId, { version, idempotency_key: key }));
        } catch (error) {
          if (!(error instanceof PlanningError) || error.status !== 409) throw error;
          const current = await live.client.draft(live.scopeId, draftId);
          if (current.version === version) throw error;
          await draft.reload(); setMoved(current.version);
          return undefined;
        }
        if (!result.publishable || !result.review_hash) { setFound(result.findings.length); return undefined; }
        setReview({ hash: result.review_hash, version });
        return "サーバー検証を通過しました。公開前確認へ進めます。";
      }); }}>サーバーで再検証</button></div>
      {moved !== null && <p className="ideal-v3-callout ideal-v3-callout--warn ideal-v3-planning-found" role="alert">別の担当者がこの勤務案を保存していました。表示を第{moved}版に更新しました。検証はまだ行っていません。内容を確かめてから「サーバーで再検証」を押してください。</p>}
      {found !== null && <p className="ideal-v3-callout ideal-v3-callout--warn ideal-v3-planning-found" role="alert">サーバーの検証の結果、公開できない指摘が{found}件あります。この勤務案は、このままでは公開できません。</p>}
      {next === 1 && found === null && moved === null && !check.busy && !(save.problem ?? check.problem) && !(save.done ?? check.done) && <p className="ideal-note ideal-v3-planning-first-check">{FIRST_CHECK}</p>}
      <WhyDisabled id={`${id}-why`}>{why}</WhyDisabled>
      <ActionStatus problem={save.problem ?? check.problem} done={save.done ?? check.done} />
      {review && <div className="ideal-confirm"><ShieldCheck aria-hidden="true" /><h3>公開前の最終確認</h3>
        <dl className="ideal-definition-list"><div><dt>対象</dt><dd>{scopeName}（{month}）</dd></div><div><dt>版</dt><dd>勤務案 第{review.version}版（入力版 第{source.inputRevision}版）</dd></div><div><dt>割当</dt><dd>{selected.length}件</dd></div><div><dt>変更結果</dt><dd>実行すると既存版を上書きせず、新しい公開版を作ります。</dd></div><div><dt>通知</dt><dd>関係する職員</dd></div></dl>
        <Identifiers items={[{ label: "施設・部署", value: live.scopeId }, { label: "選択案", value: draftId }]} />
        {unreadable && <p className="ideal-v3-callout ideal-v3-callout--warn">採用した勤務に、日時を読み取れないものがあります。公開する内容を確かめられないため、この画面からは公開できません。</p>}
        <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--primary" disabled={publish.busy || unreadable} onClick={() => void publish.run(async () => {
          const body = { version: review.version, expected_publication_version: source.publicationVersion, input_hash: source.inputHash, review_hash: review.hash };
          const result = await live.mutate(`draft-publish:${draftId}`, body, (key) => live.client.publish(live.scopeId, draftId, { ...body, idempotency_key: key }));
          if (onWorkspaceRoute(browserNavigation.pathname())) {
            browserNavigation.replaceWithFlash(workspaceHrefWithContext(routeOf("schedule/index").route, { scope: live.scopeId, period: source.period, publication: result.publication_id }), "plan-published");
            return;
          }
          await live.refresh();
          return `公開版 v${result.version} を作成しました。`;
        })}>確認した案を公開</button></div>
      </div>}
      <ActionStatus problem={publish.problem} done={publish.done} />
    </section>;
  }}</Loaded>;
}
