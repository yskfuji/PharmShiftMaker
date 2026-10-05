"use client";

import { useEffect, useEffectEvent, useId, useState, type ReactNode } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import ConfirmSurface from "../ConfirmSurface";
import { useStepFocus } from "../useStepFocus";
import useUnsavedNavigation from "../useUnsavedNavigation";
import { confirmOutcome } from "./confirmOutcome";
import { changedFacts, type Fact } from "./facts";
import { useRecordSave, type RecordVersion } from "./useRecordSave";

export type EditorRecord<P> = { key: string; revision: number; payload: P; label: string };
export type RecordFieldsProps<P> = { value: P; exists: boolean; onChange: (patch: Partial<P>) => void };
/** The record being edited: its version at the start of the edit (or after a reviewed
 * conflict), and whether the server has it at all. */
type Edit<P> = { target: string; base: RecordVersion<P>; exists: boolean };
const NEW = "new";

/**
 * The steps every record of one kind is registered or changed in: choose the record (left
 * out when the kind is only ever added to), enter its content, confirm. Nothing is sent
 * before the confirmation. The edit starts from the record as it was when it was chosen; a
 * 409 never rebases it. What the record holds and how it reads belong to the kind: its
 * fields, its lines (`facts`) and its endpoint are given by the owner, one file per kind.
 */
export default function RecordEditor<P, R extends { revision: number }>({ noun, contentTitle, level = 4, appendOnly = false, records = [], create, facts, fields, prepare, mutation, send, readCurrent, notified, risk, saved, slip, refusedChange, expected, initialTarget, focusOnMount = false, confirmation }: {
  /** What one record of the kind is called, e.g. 年休の取得規則. */
  noun: string;
  /** The heading of the content step, without its number. */
  contentTitle: string;
  /** The level of the step headings: one below the heading the editor sits under. */
  level?: 3 | 4;
  /** The kind is only added to: there is no record to choose, the content step comes first. */
  appendOnly?: boolean;
  /** The records that may be changed. */
  records?: EditorRecord<P>[];
  /** A new, empty record with its identity. */
  create: () => P;
  /** The record as the lines a person reads (the confirmation and the three-way review). */
  facts: (payload: P) => Fact[];
  fields: (props: RecordFieldsProps<P>) => ReactNode;
  /** What a save of the entered content sends, when that is more than the fields hold
   * (a correction that returns the record to its first status, for example). When it has
   * to be read from the server first, the confirmation is shown once the answer is there;
   * a failed read is shown with the fields and nothing is confirmed. */
  prepare?: (payload: P) => P | Promise<P>;
  /** Names the change among the viewer's pending ones, e.g. `record:leave_policy:<id>`. */
  mutation: (payload: P) => string;
  send: (body: { expected_revision: number; payload: P; idempotency_key: string }) => Promise<R>;
  /** On demand, after a conflict: the record as the server has it now. */
  readCurrent: (payload: P) => Promise<RecordVersion<P> | null>;
  /** Who is notified of the save, in words. */
  notified: string;
  /** What the server checks when it saves against `revision` (0: not registered yet). */
  risk: (revision: number) => string;
  saved?: (result: R, payload: P) => ReactNode;
  /** An entry slip the server refuses as well (presence or format only); null when none. */
  slip?: (payload: P) => string | null;
  /** Said when the server answers "conflict" although its version is the one the edit
   * started from: what to do with a change the server does not take for this kind. */
  refusedChange?: string;
  /** The revision a save is sent against, when that is not always the one the edit started
   * from (a kind whose identity is its content: changed content is another record). */
  expected?: (base: RecordVersion<P>, payload: P) => number;
  /** The edit the editor opens with: "new", or the key of one of `records`. */
  initialTarget?: string;
  /** Focus moves to the step the editor opens with (a task started from another control). */
  focusOnMount?: boolean;
  /** Shown in the confirmation: what the server answered for the content being confirmed. */
  confirmation?: (payload: P) => ReactNode;
}) {
  const id = useId();
  const Heading = `h${level}` as const;
  const steps = useStepFocus<"target" | "content">();
  const fresh = (): Edit<P> => ({ target: NEW, base: { revision: 0, payload: create() }, exists: false });
  const [edit, setEdit] = useState<Edit<P> | null>(() => {
    if (appendOnly || initialTarget === NEW) return fresh();
    const found = records.find((item) => item.key === initialTarget);
    return found ? { target: found.key, base: { revision: found.revision, payload: found.payload }, exists: true } : null;
  });
  const [draft, setDraft] = useState<P | null>(() => edit?.base.payload ?? null);
  const [confirming, setConfirming] = useState(false);
  const [rebased, setRebased] = useState(false);
  const [entryProblem, setEntryProblem] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareProblem, setPrepareProblem] = useState<ProblemModel | null>(null);
  const [done, setDone] = useState<ReactNode>(null);
  const record = useRecordSave<P, { expected_revision: number; payload: P }, R>({
    name: draft ? mutation(draft) : "",
    send,
    readCurrent: async () => (draft ? readCurrent(draft) : null),
  });
  const dirty = Boolean(edit && draft && JSON.stringify(draft) !== JSON.stringify(edit.base.payload));
  useUnsavedNavigation(dirty);
  const first = appendOnly ? "content" : "target";
  const focusOpening = useEffectEvent(() => { if (focusOnMount) steps.moveTo(edit ? "content" : first); });
  useEffect(() => focusOpening(), []);
  const number = (step: 1 | 2 | 3) => (appendOnly ? step - 1 : step);

  function start(next: Edit<P> | null) {
    setEdit(next); setDraft(next ? next.base.payload : null);
    setConfirming(false); setRebased(false); setEntryProblem(null); setPrepareProblem(null); record.clear();
  }
  function choose(target: string) {
    setDone(null);
    const found = records.find((item) => item.key === target);
    start(found ? { target, base: { revision: found.revision, payload: found.payload }, exists: true } : target === NEW ? fresh() : null);
  }
  function leave() {
    start(appendOnly ? fresh() : null);
    steps.moveTo(first);
  }
  function review() {
    if (!draft) return;
    const problem = slip?.(draft) ?? null;
    setEntryProblem(problem); setPrepareProblem(null);
    if (problem) return;
    const show = (next: P) => { setDraft(next); setDone(null); setConfirming(true); };
    const prepared = prepare ? prepare(draft) : draft;
    if (!(prepared instanceof Promise)) { show(prepared); return; }
    setPreparing(true);
    void prepared.then(show, (error: unknown) => setPrepareProblem(problemFrom(error, "read"))).finally(() => setPreparing(false));
  }
  async function save() {
    if (!edit || !draft) return;
    const result = await record.save({ expected_revision: sendRevision, payload: draft });
    if (!result.saved) return;
    start(appendOnly ? fresh() : null);
    // Said from the server's answer; the route's next read arrives later.
    setDone(saved ? saved(result.result, draft) : `${noun}を第${result.result.revision}版として保存しました。`);
    steps.moveTo(first);
  }
  function reviewed() {
    if (record.outcome.kind !== "conflict" || !edit) return;
    const current = record.outcome.current;
    setEdit({ ...edit, base: current ?? { revision: 0, payload: edit.base.payload }, exists: Boolean(current) });
    setRebased(true);
    record.clear();
  }

  const proposed = draft ? facts(draft) : [];
  const base = edit?.exists ? facts(edit.base.payload) : null;
  const changes = edit ? changedFacts(base, proposed) : [];
  const revision = edit?.base.revision ?? 0;
  const sendRevision = edit && draft && expected ? expected(edit.base, draft) : revision;
  const current = record.outcome.kind === "conflict" ? record.outcome.current : null;
  const sameVersion = Boolean(current && edit?.exists && current.revision === revision && JSON.stringify(current.payload) === JSON.stringify(edit.base.payload));

  return <div className="ideal-v3-record">
    {!appendOnly && <>
      <Heading className="ideal-v3-heading" {...steps.heading("target")}>1. 対象を選ぶ</Heading>
      <div className="ideal-form">
        <label htmlFor={`${id}-target`}>編集する対象</label>
        <select id={`${id}-target`} className="ideal-input" value={edit?.target ?? ""} disabled={dirty || confirming || preparing} onChange={(event) => choose(event.target.value)}>
          <option value="">選んでください</option>
          <option value={NEW}>新しい{noun}を登録する</option>
          {records.map((item) => <option key={item.key} value={item.key}>{item.label}（第{item.revision}版）</option>)}
        </select>
        {dirty && !confirming && <p className="ideal-note">入力中の内容があります。対象を変えるには、下の「入力を破棄する」を使ってください。</p>}
      </div>
    </>}
    {edit && draft && !confirming && <>
      <Heading className="ideal-v3-heading" {...steps.heading("content")}>{number(2)}. {contentTitle}</Heading>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
        {fields({ value: draft, exists: edit.exists, onChange: (patch) => setDraft((old) => old && { ...old, ...patch }) })}
        {entryProblem && <p className="ideal-note" role="alert">{entryProblem}</p>}
        {prepareProblem && <InlineProblem problem={prepareProblem} />}
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary" disabled={preparing}>保存内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" disabled={preparing} onClick={leave}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {edit && draft && confirming && <ConfirmSurface level={level} title={`${number(3)}. 保存前の確認`}
      changes={changes}
      version={{ from: sendRevision, to: !changes.length && sendRevision > 0 ? sendRevision : sendRevision + 1 }}
      notified={notified}
      risk={risk(sendRevision)}
      outcome={confirmOutcome(record.outcome, facts, base, proposed)} busy={record.busy} confirmLabel="この内容で保存する"
      onConfirm={() => void save()}
      onBack={() => { record.clear(); setConfirming(false); setRebased(false); steps.moveTo("content"); }}
      onReviewed={reviewed}>
      {confirmation?.(draft)}
      {sameVersion && <p className="ideal-note">サーバーにある版は、編集を始めたときと同じ第{revision}版です。それでも競合と答えたため、サーバーはこの記録のこの変更を受け付けていません。{refusedChange}</p>}
      {rebased && <p className="ideal-note" role="status">{edit.exists ? `現在の第${revision}版との差分に更新しました。` : "現在は登録がないため、新規登録として確認し直します。"}内容を確認して、もう一度保存してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
