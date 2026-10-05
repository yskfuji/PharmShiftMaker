"use client";

import { useEffect, useEffectEvent, useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import WorkspaceLink from "../../shell/WorkspaceLink";
import ErrorSummary, { type SummaryIssue } from "../../shared/ErrorSummary";
import { changedFacts, threeWayRows } from "../../shared/records/facts";
import { refusalIssues } from "../../shared/records/refusal";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { routeOf } from "../../shell/routeTypes";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type ActualRow, type ActualSaveBody, type ActualSaved, type Piece } from "../api";
import IntervalFields from "./IntervalFields";
import { actualBody, actualFacts, draftOfActual, editOf, employmentLabel, isFlextime, personName, taskContextOf, type ActualDraft, type ActualEdit, type ActualTaskContext, type StoredTerms } from "./model";

/** What the server holds after a conflict: the actual (null when there is none) and the
 * scheduled hours stored for it, with the names and revisions to read them with. */
type Current = { row: ActualRow | null; terms: StoredTerms | null; context: ActualTaskContext };

/** Said after a save, from the server's answer. The plan's input takes the actual in on
 * its own route. */
export function ActualSavedNotice({ revision }: { revision: number }) {
  return <>実績を第{revision}版として保存し、所定区分も保存しました。この実績を含む計画は、再検証の対象になります。<WorkspaceLink className="ideal-inline-link" route={routeOf("plan/input").route}>計画の入力に反映する</WorkspaceLink></>;
}

/**
 * The content and the confirmation of one actual: its work, breaks and scheduled hours and
 * the employment revisions it is counted under. Nothing is sent before the confirmation.
 * The edit starts from the revisions the draft was made from; a 409 never rebases it.
 * Only presence and the order of an interval's ends are checked here (the server refuses
 * both as well); everything else is the server's to refuse, in its own words.
 */
export default function ActualEditor({ draft, context, onLeave, onDone }: { draft: ActualDraft; context: ActualTaskContext; onLeave: () => void; onDone: (revision: number) => void }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"content">();
  const [base, setBase] = useState(draft);
  /** The content the edit is compared with: none while the server has no such actual. */
  const [stored, setStored] = useState<ActualEdit | null>(draft.actual.revision > 0 ? editOf(draft) : null);
  const [edit, setEdit] = useState<ActualEdit>(() => editOf(draft));
  const [confirming, setConfirming] = useState(false);
  const [rebased, setRebased] = useState(false);
  const [slips, setSlips] = useState<SummaryIssue[]>([]);
  const [attempt, setAttempt] = useState(0);
  const send = useConfirmedSend<ActualSaveBody, ActualSaved, Current>({
    name: `actual:${draft.actual.external_id}`,
    send: (body, key) => api.saveActual(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: async () => {
      const fresh = taskContextOf(await api.actualsContext(live.scopeId));
      const row = fresh.actuals.find((item) => item.external_id === draft.actual.external_id) ?? null;
      return { row, terms: fresh.terms.find((item) => item.dutyId === (row ?? draft.actual).duty.duty_id) ?? null, context: fresh };
    },
  });
  useUnsavedNavigation(JSON.stringify(edit) !== JSON.stringify(editOf(draft)));
  const focusContent = useEffectEvent(() => steps.moveTo("content"));
  useEffect(() => focusContent(), []);

  const employments = context.employments.filter((item) => item.relationship_id === base.actual.duty.relationship_id);
  // An employment revision the server returned as flextime: its actual carries no scheduled hours.
  const withoutScheduled = edit.employmentIds.some((revisionId) => isFlextime(context.employments.find((item) => item.revision_id === revisionId)));
  const change = (patch: Partial<ActualEdit>) => setEdit((old) => ({ ...old, ...patch }));
  const refused = send.outcome.kind === "refused" ? send.outcome : null;

  function review() {
    const found: SummaryIssue[] = [];
    if (!edit.work.length) found.push({ message: "実労働の区間を1つ以上入力してください。", fieldId: `${id}-work` });
    const kinds: Array<[string, string, Piece[]]> = [["実労働", "work", edit.work], ["休憩", "breaks", edit.breaks], ...(withoutScheduled ? [] : [["所定労働", "scheduled", edit.scheduled] as [string, string, Piece[]]])];
    for (const [label, key, pieces] of kinds) {
      if (pieces.some((piece) => !piece.start || !piece.end)) found.push({ message: `${label}の区間は、開始と終了の両方を入力してください。`, fieldId: `${id}-${key}` });
      else if (pieces.some((piece) => new Date(piece.start) >= new Date(piece.end))) found.push({ message: `${label}の区間は、終了を開始より後にしてください。`, fieldId: `${id}-${key}` });
    }
    if (!edit.employmentIds.length) found.push({ message: "適用する雇用条件を選んでください。", fieldId: `${id}-employment` });
    setSlips(found); setAttempt((count) => count + 1);
    send.clear();
    if (!found.length) setConfirming(true);
  }
  async function save() {
    const result = await send.run(actualBody(base, edit, withoutScheduled));
    if (result.done) onDone(base.actual.revision + 1);
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    if (!now) return;
    // The edited content and the scheduled hours' own fields are kept; only the revisions
    // a save is sent against, and what the edit is compared with, become the current ones.
    setBase({ ...base, actual: now.row ?? { ...base.actual, revision: 0 }, termsRevision: now.terms?.revision ?? 0 });
    setStored(now.row ? editOf(draftOfActual(now.context, now.row)) : null);
    setRebased(true);
  }

  const proposed = actualFacts(base.actual.duty, edit, context);
  const before = stored && actualFacts(base.actual.duty, stored, context);
  const issues = refused ? refusalIssues(refused) : slips;
  return <>
    {(!confirming || refused) && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. 実労働・休憩・所定労働と雇用条件を入力する</h3>
      <p className="ideal-note">{personName(context.names, base.actual.duty.person_id)}：{base.actual.revision > 0 ? `実績 第${base.actual.revision}版を訂正します。` : "新しい実績として記録します。"}勤務時刻と所定労働を分けて記録します。休憩は実労働に含めません。</p>
      {issues.length > 0 && <ErrorSummary title={refused ? "サーバーが保存を受け付けませんでした" : "入力内容を確認してください"} issues={issues} attempt={attempt} />}
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
        <IntervalFields id={`${id}-work`} label="実労働" value={edit.work} onChange={(work) => change({ work })} />
        <IntervalFields id={`${id}-breaks`} label="休憩" value={edit.breaks} onChange={(breaks) => change({ breaks })} />
        {withoutScheduled
          ? <p className="ideal-note">選んだ雇用条件はフレックスタイム制として登録されているため、所定労働の区間は記録しません。サーバーは、この雇用条件の実績に所定労働の区間を受け付けません。</p>
          : <IntervalFields id={`${id}-scheduled`} label="所定労働" value={edit.scheduled} onChange={(scheduled) => change({ scheduled })} />}
        <fieldset className="ideal-fieldset" id={`${id}-employment`} tabIndex={-1}>
          <legend>適用する雇用条件（改定をまたぐ場合は、時系列の順に複数選ぶ）</legend>
          {employments.length === 0 && <p className="ideal-note">この勤務の雇用関係に、登録された雇用条件がありません。</p>}
          {employments.map((item) => <div className="ideal-inline-field" key={item.revision_id}>
            <span className="ideal-check-target"><input id={`${id}-employment-${item.revision_id}`} type="checkbox" checked={edit.employmentIds.includes(item.revision_id)}
              onChange={(event) => change({ employmentIds: event.target.checked ? [...edit.employmentIds, item.revision_id] : edit.employmentIds.filter((revisionId) => revisionId !== item.revision_id) })} /></span>
            <label htmlFor={`${id}-employment-${item.revision_id}`}>{employmentLabel(item)}</label>
          </div>)}
        </fieldset>
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">保存内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={onLeave}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {confirming && !refused && <ConfirmSurface title="3. 保存前の確認"
      changes={changedFacts(before, proposed)}
      version={{ from: base.actual.revision, to: base.actual.revision + 1 }}
      notified="誰にも通知されません。保存の記録（操作した役割・時刻）は監査の履歴に残ります。この実績を含む計画は、再検証の対象になります。"
      risk={`保存前の時点では検出されていません。保存時にサーバーが、この実績が${base.actual.revision > 0 ? `第${base.actual.revision}版のままであること` : "まだ登録されていないこと"}と、所定区分の記録が${base.termsRevision > 0 ? `第${base.termsRevision}版のままであること` : "まだ登録されていないこと"}を照合します。違っていれば保存せず、競合として知らせます。実績と所定区分は一度に保存し、片方だけが保存されることはありません。`}
      outcome={conflictOutcome(send.outcome, (current) => ({
        currentRevision: current?.row?.revision ?? null,
        rows: threeWayRows(before, current?.row ? actualFacts(current.row.duty, editOf(draftOfActual(current.context, current.row)), current.context) : null, proposed),
      }))}
      busy={send.busy} confirmLabel="この内容で保存する"
      onConfirm={() => void save()}
      onBack={() => { send.clear(); setConfirming(false); setRebased(false); steps.moveTo("content"); }}
      onReviewed={reviewed}>
      {rebased && <p className="ideal-note" role="status">{base.actual.revision > 0 ? `現在の第${base.actual.revision}版との差分に更新しました。` : "現在は登録がないため、新規登録として確認し直します。"}内容を確認して、もう一度保存してください。</p>}
    </ConfirmSurface>}
  </>;
}
