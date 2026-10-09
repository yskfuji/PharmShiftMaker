"use client";

import { useId, useLayoutEffect, useState, type ReactNode } from "react";
import type { IdealClient } from "@/ideal/api/client";
import WorkspaceLink from "../../../shell/WorkspaceLink";
import JstDateTimeField from "../../../shared/JstDateTimeField";
import { CheckField, WholeNumberField } from "../../../shared/records/fields";
import type { Versioned } from "../../../shared/records/staged";
import type { RecordVersion } from "../../../shared/records/useRecordSave";
import { routeOf } from "../../../shell/routeTypes";
import { peopleApi } from "../../api";
import { durationText, rosterOf, type Roster } from "../model";

/** What the route gives each record task: the records as last read, the person chosen on
 * the route ("" when none), and how the task opens when a step started it. */
export type EditorProps = { roster: Roster; personId: string; opening?: { initialTarget: string; focusOnMount: boolean } };

/** Said after a save, from the server's answer. Every one of these saves makes the input
 * version of the plan out of date: the input has to be derived again before planning. */
export const savedNotice = (noun: string) => function Saved(result: { revision: number }): ReactNode {
  return <>{noun}を第{result.revision}版として保存しました。計画の入力には自動で反映されません。計画に使う前に、<WorkspaceLink className="ideal-inline-link" route={routeOf("plan/input").route}>計画の「前提・取込」</WorkspaceLink>で入力を再導出してください。</>;
};

/** On demand, after a conflict: the saved record as the server has it now. */
export const currentRecord = <P,>(client: Pick<IdealClient, "request">, scopeId: string, find: (roster: Roster, payload: P) => Versioned<P> | undefined) =>
  async (payload: P): Promise<RecordVersion<P> | null> => {
    const found = find(rosterOf(await peopleApi(client).rosterContext(scopeId)), payload);
    return found && found.revision > 0 ? { revision: found.revision, payload: found.payload } : null;
  };

/** An entry slip, not a judgement: the server refuses a period that does not run forward. */
export const runsForward = (payload: { start: string; end: string }) => (Date.parse(payload.start) >= Date.parse(payload.end) ? "適用終了は、適用開始より後にしてください。" : null);

export function PeriodFields({ start, end, onChange }: { start: string; end: string; onChange: (patch: { start?: string; end?: string }) => void }) {
  return <>
    <JstDateTimeField label="適用開始（日本時間）" value={start} onChange={(value) => onChange({ start: value })} required />
    <JstDateTimeField label="適用終了（日本時間）" value={end} onChange={(value) => onChange({ end: value })} required />
  </>;
}

/** A length of time, entered in whole seconds as the records keep it; the hours and
 * minutes it makes are shown beside it. What it may be is the server's rule. */
export function SecondsField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <>
    <WholeNumberField label={`${label}（秒）`} value={value} onChange={onChange} />
    <p className="ideal-note">{label}：{durationText(value)}</p>
  </>;
}

/** Several of the listed values. `sorted`: kept in ascending order, as weekdays are. */
export function ChoiceGroup<T extends string | number>({ legend, options, selected, onChange, sorted = false, empty }: {
  legend: string; options: Array<{ value: T; label: string }>; selected: T[]; onChange: (next: T[]) => void; sorted?: boolean; empty?: string;
}) {
  return <fieldset className="ideal-fieldset">
    <legend>{legend}</legend>
    {options.length === 0 && empty && <p className="ideal-note">{empty}</p>}
    {options.map((option) => <CheckField key={option.value} label={option.label} checked={selected.includes(option.value)} onChange={(checked) => {
      const next = checked ? [...selected, option.value] : selected.filter((value) => value !== option.value);
      onChange(sorted ? [...next].sort() : next);
    }} />)}
  </fieldset>;
}

/** One item per line. A line that cannot be read is named and is not part of the record;
 * `report` tells the owner which lines those are, so nothing is confirmed while one remains. */
export function LinesField<T>({ label, help, initial, read, onItems, report }: {
  label: string; help: string; initial: string; read: (parts: string[]) => T | null; onItems: (items: T[]) => void; report: (unreadable: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  const parsed = readLines(text, read);
  // One line each, so the effect runs again only when the unreadable lines change.
  const unreadable = parsed.unreadable.join("\n");
  useLayoutEffect(() => { report(unreadable ? unreadable.split("\n") : []); return () => report([]); }, [unreadable, report]);
  return <>
    <label htmlFor={id}>{label}</label>
    <textarea id={id} className="ideal-input" rows={4} aria-describedby={`${id}-help`} value={text} onChange={(event) => { setText(event.target.value); onItems(readLines(event.target.value, read).items); }} />
    <p id={`${id}-help`} className="ideal-note">{help}</p>
    {parsed.unreadable.length > 0 && <p className="ideal-note" role="alert">読み取れない行：{parsed.unreadable.join("、")}</p>}
  </>;
}

/** Splits the text into lines and each line at its spaces; an empty line is skipped. */
export function readLines<T>(text: string, read: (parts: string[]) => T | null): { items: T[]; unreadable: string[] } {
  const items: T[] = [];
  const unreadable: string[] = [];
  text.split("\n").forEach((line, index) => {
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return;
    const item = read(parts);
    if (item === null) unreadable.push(`${index + 1}行目（${line.trim()}）`); else items.push(item);
  });
  return { items, unreadable };
}

/** One calendar day per line, kept as written (the server reads and checks the dates). */
export function DayLinesField({ label, initial, onDays }: { label: string; initial: string[]; onDays: (days: string[]) => void }) {
  const id = useId();
  const [text, setText] = useState(() => initial.join("\n"));
  return <>
    <label htmlFor={id}>{label}（1行に1日、YYYY-MM-DD）</label>
    <textarea id={id} className="ideal-input" rows={4} value={text} onChange={(event) => { setText(event.target.value); onDays(event.target.value.split("\n").map((line) => line.trim()).filter(Boolean)); }} />
  </>;
}

/** One of a fixed set of values; there is always one chosen. */
export function OneOfField<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  const id = useId();
  return <>
    <label htmlFor={id}>{label}</label>
    <select id={id} className="ideal-input" value={String(value)} onChange={(event) => onChange(options.find((option) => String(option.value) === event.target.value)!.value)}>
      {options.map((option) => <option key={option.value} value={String(option.value)}>{option.label}</option>)}
    </select>
  </>;
}

/** A whole number that may be left empty (kept as null then). */
export function OptionalNumberField({ label, value, onChange }: { label: string; value: number | null | undefined; onChange: (value: number | null) => void }) {
  return <WholeNumberField label={label} required={false} value={value ?? null} onChange={(next) => onChange(Number.isFinite(next) ? next : null)} />;
}
