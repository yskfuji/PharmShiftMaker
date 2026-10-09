"use client";

import { useId } from "react";
import JstDateTimeField from "../../../shared/JstDateTimeField";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import type { RecordEvidence } from "../../../shared/records/evidence";
import type { DemandPayload } from "../../api";

/** How many people: a whole number, or nothing while the field is empty. */
const count = (value: number) => (Number.isFinite(value) ? value : "");

/**
 * The content of one demand: the duty (task, then a place of that task), how many people
 * are required and wished for, the time span in Japan time, and the evidence. Only
 * presence and number format are checked here. Each field reports only what it changed.
 */
export default function DemandFields({ value, dutyOptions, onChange, onEvidence }: {
  value: DemandPayload;
  dutyOptions: Array<{ task: string; location: string }>;
  onChange: (patch: Partial<DemandPayload>) => void;
  onEvidence: (patch: Partial<RecordEvidence>) => void;
}) {
  const id = useId();
  // The record's own task and place stay selectable when the input no longer offers them.
  const tasks = Array.from(new Set([...dutyOptions.map((option) => option.task), value.task])).filter(Boolean);
  const locations = Array.from(new Set([...dutyOptions.filter((option) => option.task === value.task).map((option) => option.location), value.location])).filter(Boolean);
  return <>
    <label htmlFor={`${id}-task`}>配置する業務</label>
    <select id={`${id}-task`} className="ideal-input" required value={value.task} onChange={(event) => onChange({ task: event.target.value, location: "" })}>
      <option value="">選んでください</option>
      {tasks.map((task) => <option key={task} value={task}>{task}</option>)}
    </select>
    <label htmlFor={`${id}-location`}>配置する場所</label>
    <select id={`${id}-location`} className="ideal-input" required value={value.location} onChange={(event) => onChange({ location: event.target.value })}>
      <option value="">選んでください</option>
      {locations.map((location) => <option key={location} value={location}>{location}</option>)}
    </select>
    <label htmlFor={`${id}-minimum`}>必須の配置人数</label>
    <input id={`${id}-minimum`} className="ideal-input" type="number" min={0} step={1} required value={count(value.minimum)} onChange={(event) => onChange({ minimum: event.target.valueAsNumber })} />
    <label htmlFor={`${id}-target`}>希望する配置人数</label>
    <input id={`${id}-target`} className="ideal-input" type="number" min={0} step={1} required value={count(value.target)} onChange={(event) => onChange({ target: event.target.valueAsNumber })} />
    <JstDateTimeField label="適用開始（日本時間）" value={value.start} onChange={(start) => onChange({ start })} required />
    <JstDateTimeField label="適用終了（日本時間）" value={value.end} onChange={(end) => onChange({ end })} required />
    <RecordEvidenceFields value={value.evidence} onChange={onEvidence} />
    <p className="ideal-note">必須の人数を満たせるかどうかは、案を作るときと検証のときにサーバーが判定します。保存した内容は、新しい入力版を作るまで案の作成には使われません。</p>
  </>;
}
