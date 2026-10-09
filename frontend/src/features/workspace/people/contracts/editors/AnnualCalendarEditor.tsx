"use client";

import { useCallback, useRef } from "react";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { DayField, SelectField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type AnnualCalendarPayload, type CalendarDay, type DateRange, type RecordSaved } from "../../api";
import { annualCalendarFacts } from "../facts";
import { WEEKDAY_OPTIONS, calendarLabel, siteLabel } from "../model";
import { LinesField, OneOfField, currentRecord, savedNotice, type EditorProps } from "./parts";
import SegmentFields from "./SegmentFields";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{1,4}):([0-5]\d)(?::([0-5]\d))?$/;
/** "2026-04-01 8:00": a day and the time scheduled on it, as whole seconds. */
const readDay = (parts: string[]): CalendarDay | null => {
  const time = parts.length === 2 && DAY.test(parts[0]) ? TIME.exec(parts[1]) : null;
  return time ? { day: parts[0], seconds: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3] ?? 0) } : null;
};
/** "2026-08-01 2026-08-15": the first day and the day after the last. */
const readRange = (parts: string[]): DateRange | null => (parts.length === 2 && DAY.test(parts[0]) && DAY.test(parts[1]) ? { start: parts[0], end: parts[1] } : null);
const two = (value: number) => String(value).padStart(2, "0");
const dayLine = (day: CalendarDay) => `${day.day} ${Math.floor(day.seconds / 3600)}:${two(Math.floor((day.seconds % 3600) / 60))}${day.seconds % 60 ? `:${two(day.seconds % 60)}` : ""}`;

/**
 * Registers the agreed calendar of one-year variable working hours for a site: its period,
 * the days fixed at the start with their scheduled time, the later divisions and the busy
 * periods. The lines are read into the record as written; what the period, the divisions
 * and the days must satisfy is checked by the server when it saves and when it validates.
 */
export default function AnnualCalendarEditor({ roster, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  // The lines of the two line fields that could not be read, while their form is shown.
  const unreadable = useRef<{ days: string[]; special: string[] }>({ days: [], special: [] });
  const reportDays = useCallback((lines: string[]) => { unreadable.current.days = lines; }, []);
  const reportSpecial = useCallback((lines: string[]) => { unreadable.current.special = lines; }, []);
  return <RecordEditor<AnnualCalendarPayload, RecordSaved>
    noun="1年単位の変形労働時間制のカレンダー" contentTitle="カレンダーの内容と根拠を入力する"
    records={roster.annualCalendars.map((item) => ({ ...item, label: calendarLabel(roster, item.payload) }))}
    create={() => ({ calendar_id: crypto.randomUUID(), employer_id: "", establishment_id: "", start: "", end: "", first_period_end: "", week_start: 0, days: [], segments: [], special_periods: [], evidence: { ...EMPTY_RECORD_EVIDENCE } })}
    facts={(payload) => annualCalendarFacts(roster, payload)}
    fields={({ value, onChange }) => <>
      <SelectField label="カレンダーを適用する事業場" value={value.establishment_id} options={roster.establishments.map((item) => ({ value: item.key, label: siteLabel(roster, item.payload) }))}
        onChange={(establishment_id) => onChange({ establishment_id, employer_id: roster.establishments.find((item) => item.key === establishment_id)?.payload.employer_id ?? "" })} />
      <DayField label="対象期間の初日" value={value.start} onChange={(start) => onChange({ start })} />
      <DayField label="対象期間の終了日（この日を含まない）" value={value.end} onChange={(end) => onChange({ end })} />
      <DayField label="最初の期間の終了日（この日を含まない。ここまでを日ごとに確定）" value={value.first_period_end} onChange={(first_period_end) => onChange({ first_period_end })} />
      <OneOfField label="週の起算曜日" value={value.week_start ?? 0} options={WEEKDAY_OPTIONS} onChange={(week_start) => onChange({ week_start })} />
      <LinesField key={`days-${value.calendar_id}`} label="確定した労働日と所定時間（1行に1日：YYYY-MM-DD 時:分）" help="例：2026-04-01 8:00。確定した部分で、ここに載っていない日は休日です。"
        initial={(value.days ?? []).map(dayLine).join("\n")} read={readDay} onItems={(days) => onChange({ days })} report={reportDays} />
      <SegmentFields value={value.segments ?? []} onChange={(segments) => onChange({ segments })} />
      <LinesField key={`special-${value.calendar_id}`} label="特定期間（1行に1期間：開始日 終了日）" help="特に業務が繁忙な期間です。終了日は、その日を含みません。"
        initial={(value.special_periods ?? []).map((range) => `${range.start} ${range.end}`).join("\n")} read={readRange} onItems={(special_periods) => onChange({ special_periods })} report={reportSpecial} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">対象期間の長さ、区分期間のつながりと確定の時期、1日・1週・期間の時間や連続労働の限度は、サーバーが保存時と検証で確かめます。この画面では判定しません。</p>
    </>}
    // An entry slip, not a judgement: a line that could not be read is not in the record.
    slip={() => (unreadable.current.days.length || unreadable.current.special.length ? "カレンダーの行に読み取れない内容があります。表示された行を直してください。" : null)}
    mutation={(payload) => `record:annual_calendar:${payload.calendar_id}`}
    send={(body) => api.saveAnnualCalendar(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.annualCalendars.find((item) => item.key === payload.calendar_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("カレンダー")} saved={savedNotice("カレンダー")} {...opening} />;
}
