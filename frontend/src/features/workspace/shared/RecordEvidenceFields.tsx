"use client";

import { useId } from "react";
import JstDateTimeField from "./JstDateTimeField";
import { EVIDENCE_STATUS, type RecordEvidence } from "./records/evidence";

/**
 * The source document of one record: where it is, whether it was verified and by whom,
 * and until when it is valid (optional). `name` says which evidence this is when a record
 * has several. Each field reports only what it changed, so the owner merges the patch into
 * its latest draft. Presence is all that is checked here (a reference, and a verifier once
 * "verified" is chosen); the server decides whether the evidence is sufficient.
 */
export default function RecordEvidenceFields({ name = "原本確認", value, onChange }: { name?: string; value: RecordEvidence; onChange: (patch: Partial<RecordEvidence>) => void }) {
  const id = useId();
  return <fieldset className="ideal-fieldset">
    <legend>{name}</legend>
    <label htmlFor={`${id}-reference`}>{name}の資料名・参照先</label>
    <input id={`${id}-reference`} className="ideal-input" required value={value.reference} onChange={(event) => onChange({ reference: event.target.value })} />
    <label htmlFor={`${id}-status`}>{name}の状態</label>
    <select id={`${id}-status`} className="ideal-input" value={value.status} onChange={(event) => {
      const status = event.target.value as RecordEvidence["status"];
      // A verifier belongs to "verified" only.
      onChange(status === "verified" ? { status } : { status, verified_by: null });
    }}>{Object.entries(EVIDENCE_STATUS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
    {value.status === "verified" && <>
      <label htmlFor={`${id}-verifier`}>{name}の確認責任者</label>
      <input id={`${id}-verifier`} className="ideal-input" required value={value.verified_by ?? ""} onChange={(event) => onChange({ verified_by: event.target.value })} />
    </>}
    <JstDateTimeField label={`${name}の有効期限（任意・日本時間）`} value={value.valid_until} onChange={(next) => onChange({ valid_until: next || null })} />
  </fieldset>;
}
