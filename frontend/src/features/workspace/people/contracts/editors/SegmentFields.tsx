"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { jstOffsetText } from "../../../shared/jst";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { CheckField, DayField, WholeNumberField } from "../../../shared/records/fields";
import type { CalendarSegment } from "../../api";

/**
 * The later divisions of a calendar's period, each entered as its agreement states it:
 * its days, its working days and total time, and (once it is fixed) its fixing date with
 * the consent. Each field changes only its own value. How long a division must be, when it
 * must be fixed and whether its consent is enough are the server's to decide.
 */
export default function SegmentFields({ value, onChange }: { value: CalendarSegment[]; onChange: (segments: CalendarSegment[]) => void }) {
  const change = (index: number, patch: Partial<CalendarSegment>) => onChange(value.map((segment, place) => (place === index ? { ...segment, ...patch } : segment)));
  return <fieldset className="ideal-fieldset">
    <legend>区分期間</legend>
    {value.length === 0 && <p className="ideal-note">区分期間はありません。対象期間を分けて後から確定するときに追加します。</p>}
    {value.map((segment, index) => {
      const name = `区分期間${index + 1}`;
      return <fieldset key={index} className="ideal-fieldset">
        <legend>{name}</legend>
        <DayField label={`${name}の開始日`} value={segment.start} onChange={(start) => change(index, { start })} />
        <DayField label={`${name}の終了日（この日を含まない）`} value={segment.end} onChange={(end) => change(index, { end })} />
        <WholeNumberField label={`${name}の労働日数`} value={segment.working_days} onChange={(working_days) => change(index, { working_days })} />
        <WholeNumberField label={`${name}の総労働時間（秒）`} value={segment.total_seconds} onChange={(total_seconds) => change(index, { total_seconds })} />
        <DayField label={`${name}の確定日（任意）`} required={false} value={segment.fixed_on ?? ""} onChange={(fixed_on) => change(index, { fixed_on: fixed_on || null })} />
        <CheckField label={`${name}の同意資料を記録する`} checked={segment.consent !== null} onChange={(checked) => change(index, { consent: checked ? { ...EMPTY_RECORD_EVIDENCE } : null })} />
        {segment.consent && <RecordEvidenceFields name={`${name}の同意`} value={segment.consent}
          // The expiry is kept as Japan time with its offset, as these records are written.
          onChange={(patch) => change(index, { consent: { ...(segment.consent ?? EMPTY_RECORD_EVIDENCE), ...patch, ...(patch.valid_until ? { valid_until: jstOffsetText(patch.valid_until) } : {}) } })} />}
        <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => onChange(value.filter((_, place) => place !== index))}>{name}を削除</button></div>
      </fieldset>;
    })}
    <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => onChange([...value, { start: "", end: "", working_days: 0, total_seconds: 0, fixed_on: null, consent: null }])}>区分期間を追加</button></div>
  </fieldset>;
}
