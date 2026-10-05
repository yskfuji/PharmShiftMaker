"use client";

import { useId } from "react";
import WorkspaceLink from "../../../shell/WorkspaceLink";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { CheckField, DayField, SelectField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { routeOf } from "../../../shell/routeTypes";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type EmploymentPayload, type RecordSaved, type WorkingTimeSystem } from "../../api";
import { employmentFacts } from "../facts";
import { ACTIVITY, HOLIDAY_SYSTEM, METHOD, WEEKDAY_OPTIONS, agreementLabel, calendarLabel, employerName, employmentLabel, ofPerson, periodText, personOptions, siteLabel, type Roster } from "../model";
import { ChoiceGroup, DayLinesField, OneOfField, OptionalNumberField, PeriodFields, currentRecord, runsForward, savedNotice, type EditorProps } from "./parts";

const NEW_RELATIONSHIP = "new";
const SYSTEMS: Array<{ value: WorkingTimeSystem; label: string }> = [
  { value: "standard", label: "通常の労働時間制" },
  { value: "monthly_variable", label: "1か月以内の変形労働時間制" },
  { value: "annual_variable", label: "1年単位の変形労働時間制" },
  { value: "flex", label: "フレックスタイム制" },
];
const entries = <K extends string>(labels: Record<K, string>) => (Object.entries(labels) as Array<[K, string]>).map(([value, label]) => ({ value, label }));

/** The fields of the chosen working-time system, empty; those of the other systems are
 * cleared (the server leaves out the empty ones, so a stored record keeps its form). */
const systemFields = (system: WorkingTimeSystem): Partial<EmploymentPayload> => ({
  working_time_system: system,
  variable_anchor: system === "monthly_variable" ? "" : null,
  variable_period_days: null,
  variable_evidence: system === "monthly_variable" || system === "flex" ? { ...EMPTY_RECORD_EVIDENCE } : null,
  annual_calendar_id: system === "annual_variable" ? "" : null,
  flex_anchor: system === "flex" ? "" : null,
  flex_months: system === "flex" ? 1 : null,
  flex_full_two_day_weekend: false,
  flex_rest_weekdays: [],
  flex_other_rest_days: [],
});

const newEmployment = (personId: string): EmploymentPayload => ({
  revision_id: crypto.randomUUID(), relationship_id: crypto.randomUUID(), person_id: personId, employer_id: "", establishment_id: "", start: "", end: "",
  contract_order: null, activity: "employment", method: "standard", week_start: 0, statutory_holidays: [], calendar_confirmed: false,
  declaration: { ...EMPTY_RECORD_EVIDENCE }, agreement_id: null,
});

/** The employment relationships the person already has; a revision continues one of them
 * or starts a new one. */
function RelationshipField({ roster, value, onChange }: { roster: Roster; value: EmploymentPayload; onChange: (relationshipId: string) => void }) {
  const id = useId();
  const own = roster.employments.map((item) => item.payload).filter((item) => item.person_id === value.person_id);
  const latest = Array.from(new Map(own.map((item) => [item.relationship_id, item])).values());
  const known = roster.employments.some((item) => item.payload.relationship_id === value.relationship_id);
  return <>
    <label htmlFor={id}>雇用関係の履歴</label>
    <select id={id} className="ideal-input" value={known ? value.relationship_id : NEW_RELATIONSHIP} onChange={(event) => onChange(event.target.value === NEW_RELATIONSHIP ? crypto.randomUUID() : event.target.value)}>
      <option value={NEW_RELATIONSHIP}>新しい雇用関係を作成</option>
      {latest.map((item) => <option key={item.relationship_id} value={item.relationship_id}>{employerName(roster, item.employer_id)} {periodText(item.start, item.end)}</option>)}
    </select>
  </>;
}

/** Registers or revises one revision of a person's employment: the site, the period, the
 * week and statutory holidays, the working-time system and the agreement that applies.
 * Whether the arrangement stands (the system's own conditions, the site's period, a
 * flextime adoption) is the server's to decide. */
export default function EmploymentEditor({ roster, personId, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<EmploymentPayload, RecordSaved>
    noun="雇用関係・兼業制度" contentTitle="雇用関係の内容と根拠を入力する"
    records={ofPerson(roster.employments, personId).map((item) => ({ ...item, label: employmentLabel(roster, item.payload) }))}
    create={() => newEmployment(personId)}
    facts={(payload) => employmentFacts(roster, payload)}
    fields={({ value, onChange }) => {
      const system = value.working_time_system ?? "standard";
      const calendars = roster.annualCalendars.filter((item) => item.payload.establishment_id === value.establishment_id);
      const agreements = roster.agreements.filter((item) => item.payload.employer_id === value.employer_id && item.payload.establishment_id === value.establishment_id);
      return <>
        <SelectField label="対象職員" value={value.person_id} options={personOptions(roster)} onChange={(person_id) => onChange({ person_id })} />
        <PeriodFields start={value.start} end={value.end} onChange={onChange} />
        <RelationshipField roster={roster} value={value} onChange={(relationship_id) => onChange({ relationship_id })} />
        <SelectField label="雇用先の事業場" value={value.establishment_id ?? ""} options={roster.establishments.map((item) => ({ value: item.key, label: siteLabel(roster, item.payload) }))}
          onChange={(establishment_id) => onChange({ establishment_id, employer_id: roster.establishments.find((item) => item.key === establishment_id)?.payload.employer_id ?? "" })} />
        <OptionalNumberField label="契約締結順（未確認の場合は空欄）" value={value.contract_order} onChange={(contract_order) => onChange({ contract_order })} />
        <OneOfField label="活動の区分" value={value.activity} options={entries(ACTIVITY)} onChange={(activity) => onChange({ activity })} />
        <OneOfField label="時間管理方式" value={value.method} options={entries(METHOD)} onChange={(method) => onChange({ method })} />
        <OneOfField label="週の起算曜日" value={value.week_start} options={WEEKDAY_OPTIONS} onChange={(week_start) => onChange({ week_start })} />
        <DayLinesField key={`holidays-${value.revision_id}`} label="法定休日の日付" initial={value.statutory_holidays ?? []} onDays={(statutory_holidays) => onChange({ statutory_holidays })} />
        <CheckField label="週起算と法定休日を原本照合した" checked={value.calendar_confirmed} onChange={(calendar_confirmed) => onChange({ calendar_confirmed })} />
        <OneOfField label="法定休日の与え方" value={value.holiday_system ?? "weekly"} options={entries(HOLIDAY_SYSTEM)}
          onChange={(holiday_system) => onChange(holiday_system === "four_week" ? { holiday_system, four_week_start: "" } : { holiday_system, four_week_start: null })} />
        {value.holiday_system === "four_week" && <DayField label="変形休日制の起算日（就業規則の定め）" value={value.four_week_start ?? ""} onChange={(four_week_start) => onChange({ four_week_start })} />}
        <OneOfField label="労働時間制度" value={system} options={SYSTEMS} onChange={(next) => onChange(systemFields(next))} />
        {system === "monthly_variable" && <>
          <DayField label="変形期間の起算日" value={value.variable_anchor ?? ""} onChange={(variable_anchor) => onChange({ variable_anchor })} />
          <OptionalNumberField label="変形期間の日数（空欄なら起算日から1か月ごと）" value={value.variable_period_days} onChange={(variable_period_days) => onChange({ variable_period_days })} />
        </>}
        {system === "annual_variable" && <>
          <SelectField label="適用するカレンダー" value={value.annual_calendar_id ?? ""} options={calendars.map((item) => ({ value: item.key, label: calendarLabel(roster, item.payload) }))} onChange={(chosen) => onChange({ annual_calendar_id: chosen || null })} />
          <p className="ideal-note">選んだ事業場に登録されたカレンダーから選びます。週の起算曜日などがカレンダーと合うかどうかは、サーバーが検証します。</p>
        </>}
        {system === "flex" && <>
          <DayField label="清算期間の起算日" value={value.flex_anchor ?? ""} onChange={(flex_anchor) => onChange({ flex_anchor })} />
          <OptionalNumberField label="清算期間の長さ（月数）" value={value.flex_months} onChange={(flex_months) => onChange({ flex_months })} />
          <CheckField label="完全週休2日制の特例を適用する（労使協定による）" checked={Boolean(value.flex_full_two_day_weekend)} onChange={(flex_full_two_day_weekend) => onChange({ flex_full_two_day_weekend })} />
          {value.flex_full_two_day_weekend && <>
            <ChoiceGroup legend="毎週の所定休日" sorted options={WEEKDAY_OPTIONS.map((option) => ({ value: option.value, label: option.label.slice(0, 1) }))} selected={value.flex_rest_weekdays ?? []} onChange={(flex_rest_weekdays) => onChange({ flex_rest_weekdays })} />
            <DayLinesField key={`rest-${value.revision_id}`} label="その他の所定休日" initial={value.flex_other_rest_days ?? []} onDays={(flex_other_rest_days) => onChange({ flex_other_rest_days })} />
          </>}
          <p className="ideal-note">フレックスタイム制は、施設が採用を登録し、別の管理者が確認した後に使えます。雇用条件は、本人の参加の開始日から、採用と同じ清算期間・起算日で登録してください。採用と参加は<WorkspaceLink className="ideal-inline-link" route={routeOf("settings/flextime").route}>設定の「フレックスタイム制」</WorkspaceLink>で行います。採用の内容と合うかどうかは、サーバーが保存時に確かめます。</p>
        </>}
        <SelectField label="雇用関係に適用する協定" required={false} value={value.agreement_id ?? ""} options={agreements.map((item) => ({ value: item.key, label: agreementLabel(roster, item.payload) }))} onChange={(chosen) => onChange({ agreement_id: chosen || null })} />
        <RecordEvidenceFields name="兼業申告の確認" value={value.declaration} onChange={(patch) => onChange({ declaration: { ...value.declaration, ...patch } })} />
        {(system === "monthly_variable" || system === "flex") && <RecordEvidenceFields name="変形労働時間制の根拠（就業規則・労使協定）" value={value.variable_evidence ?? EMPTY_RECORD_EVIDENCE}
          onChange={(patch) => onChange({ variable_evidence: { ...(value.variable_evidence ?? EMPTY_RECORD_EVIDENCE), ...patch } })} />}
        <p className="ideal-note">労働時間制度ごとの条件や時間外の数え方は、サーバーが検証と計算で判定します。この画面では判定しません。</p>
      </>;
    }}
    slip={runsForward}
    mutation={(payload) => `record:employment:${payload.revision_id}`}
    send={(body) => api.saveEmployment(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.employments.find((item) => item.key === payload.revision_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("雇用関係")} saved={savedNotice("雇用関係")}
    refusedChange="登録済みの雇用関係の対象職員は変えられません。別の職員の雇用関係は、新しく登録してください。" {...opening} />;
}
