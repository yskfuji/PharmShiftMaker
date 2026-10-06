"use client";

import { useId, useState, type ReactNode } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { changedFacts, threeWayRows, type Fact } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import type { FlexAction } from "../api";
import RefusedList from "./RefusedList";

type Row = { entity_id: string; revision: number };
export type DecisionFieldsProps<R, F> = { row: R; value: F; onChange: (patch: Partial<F>) => void; id: string };

/**
 * The steps one decision on a registered record is made in: choose the record, enter what
 * the decision needs (left out when it needs nothing), confirm. Which records can be
 * chosen is the server's answer for this viewer (`action`): a record it refuses is listed
 * with the server's reason and cannot be chosen. Nothing is sent before the confirmation;
 * a 409 is reviewed against the record as the server holds it now. What the decision is
 * (its fields, its lines and its endpoint) is given by its owner, one file per decision.
 */
export default function DecisionSteps<R extends Row, F extends object, B extends { expected_revision: number }, A>({ targetTitle, targetLabel, noneText, refusedLabel, rows, action, label, typedLabel = false, content, facts, decided, body, mutation, send, readCurrent, confirmTitle, confirmLabel, confirmTone, backLabel, notified, risk, note, done: doneText }: {
  targetTitle: string;
  targetLabel: string;
  /** Said when the server lets the viewer decide none of the records. */
  noneText: string;
  /** Names the list of the records the server refuses, each with its reason. */
  refusedLabel: string;
  rows: R[];
  action: (row: R) => FlexAction;
  label: (row: R) => string;
  /** True when the label holds words a person typed (an adoption is named by whom it covers):
   * it is then shown as typed (`data-verbatim`). */
  typedLabel?: boolean;
  /** The decision's own fields, with the heading of their step (without its number). */
  content?: { title: string; empty: F; fields: (props: DecisionFieldsProps<R, F>) => ReactNode };
  /** The record as the lines a person reads. */
  facts: (row: R) => Fact[];
  /** The record as it will read once the decision is recorded. */
  decided: (row: R, value: F) => Fact[];
  body: (row: R, value: F) => B;
  /** Names the change among the viewer's pending ones. */
  mutation: (row: R) => string;
  send: (row: R, body: B, idempotencyKey: string) => Promise<A>;
  /** On demand, after a conflict: the record as the server has it now. */
  readCurrent: (row: R) => Promise<R | null>;
  confirmTitle: string;
  confirmLabel: string;
  /** `danger` for a decision the server has no step to take back. */
  confirmTone?: "primary" | "danger";
  backLabel?: string;
  /** Who is notified, in words. */
  notified: string;
  /** What the server checks when it records the decision against `revision`. */
  risk: (revision: number) => string;
  /** Said in the confirmation: what else the decision does. */
  note?: ReactNode;
  done: (answer: A, row: R, value: F) => string;
}) {
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const empty = (content?.empty ?? {}) as F;
  const [chosen, setChosen] = useState("");
  const [value, setValue] = useState<F>(empty);
  const [base, setBase] = useState<R | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const open = rows.filter((row) => action(row).allowed);
  const closed = rows.filter((row) => !action(row).allowed);
  const row = open.find((item) => item.entity_id === chosen);
  const sender = useConfirmedSend<B, A, R>({
    name: base ? mutation(base) : "",
    send: (request, key) => send(base!, request, key),
    readCurrent: async () => (base ? readCurrent(base) : null),
  });
  useUnsavedNavigation(Boolean(row) && JSON.stringify(value) !== JSON.stringify(empty));

  function choose(target: string) { setChosen(target); setValue(empty); setBase(null); setRebased(false); setDone(null); sender.clear(); }
  function review() { if (row) { setDone(null); setRebased(false); sender.clear(); setBase(row); } }
  function leave() { setBase(null); setRebased(false); sender.clear(); steps.moveTo(content ? "content" : "target"); }
  async function save() {
    if (!base) return;
    const result = await sender.run(body(base, value));
    if (!result.done) return;
    const said = doneText(result.result, base, value);
    choose(""); setDone(said);
    steps.moveTo("target");
  }
  function reviewed() {
    if (sender.outcome.kind !== "conflict") return;
    const now = sender.outcome.current;
    sender.clear();
    // The record is gone, or the server no longer lets this viewer decide it: nothing is sent.
    if (!now || !action(now).allowed) {
      choose("");
      setDone(now ? `この操作は行っていません。${action(now).refusal ?? ""}` : "この記録は、現在サーバーにありません。操作は行っていません。");
      steps.moveTo("target");
      return;
    }
    setBase(now); setRebased(true);
  }

  const number = content ? 3 : 2;
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. {targetTitle}</h3>
    {open.length === 0 ? <p className="ideal-note">{noneText}</p> : <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); if (!content) review(); }}>
      <label htmlFor={`${id}-target`}>{targetLabel}</label>
      <select id={`${id}-target`} className="ideal-input" required value={chosen} disabled={Boolean(base)} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        {open.map((item) => <option key={item.entity_id} value={item.entity_id} data-verbatim={typedLabel ? "" : undefined}>{label(item)}（第{item.revision}版）</option>)}
      </select>
      {!content && !base && <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">内容を確認する</button></div>}
    </form>}
    {closed.length > 0 && <RefusedList label={refusedLabel} items={closed.map((item) => ({ key: item.entity_id, name: label(item), typed: typedLabel, reason: action(item).refusal }))} />}
    {content && row && !base && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. {content.title}</h3>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
        {content.fields({ row, value, onChange: (patch) => setValue((old) => ({ ...old, ...patch })), id })}
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { choose(""); steps.moveTo("target"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {base && <ConfirmSurface title={`${number}. ${confirmTitle}`}
      changes={changedFacts(facts(base), decided(base, value))}
      version={{ from: base.revision, to: base.revision + 1 }}
      notified={notified}
      risk={risk(base.revision)}
      outcome={conflictOutcome(sender.outcome, (current) => ({ currentRevision: current?.revision ?? null, rows: threeWayRows(facts(base), current && facts(current), decided(base, value)) }))}
      busy={sender.busy} confirmLabel={confirmLabel} confirmTone={confirmTone} backLabel={backLabel}
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      {note}
      {rebased && <p className="ideal-note" role="status">現在の第{base.revision}版に対する操作として確認し直します。内容を確認して、もう一度操作してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
