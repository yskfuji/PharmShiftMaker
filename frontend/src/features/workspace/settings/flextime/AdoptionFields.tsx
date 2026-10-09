"use client";

import FieldRow, { Field } from "../../shared/FieldRow";
import RecordEvidenceFields from "../../shared/RecordEvidenceFields";
import type { FlexListing } from "../api";
import { flexNames, RULE_LABEL, WEEKDAYS } from "./model";
import { STANDARD_DAY_PATTERN, type RegistrationField, type RegistrationForm } from "./registration";

/**
 * The agreement's terms as they are entered, in the order of the agreement. Required
 * fields and formats are the browser's own checks; nothing here says whether the terms
 * are lawful. The filing is asked for when the settlement period is longer than a month
 * (the server takes it only then). `invalid` marks the controls the last answer was about.
 * Dates, times and the period's length stand two or three to a row where the form is wide
 * (shared/FieldRow); their labels and their order are those of the single column.
 */
export default function AdoptionFields({ value, onChange, listing, fieldId, invalid }: {
  value: RegistrationForm;
  onChange: (patch: Partial<RegistrationForm>) => void;
  listing: Pick<FlexListing, "viewer" | "establishments" | "people">;
  fieldId: (field: RegistrationField) => string;
  invalid: (field: RegistrationField) => true | undefined;
}) {
  const names = flexNames(listing);
  const months = Number(value.settlement_months);
  /** A label and its control, as two siblings: of the form's grid, or of a `Field` of a row. */
  const text = (field: "settlement_anchor" | "last_day" | "agreed_total_description" | "standard_day" | "flexible_start" | "core_start" | "filed_on" | "valid_until", label: string, type: string, extra: Record<string, unknown> = {}) => <>
    <label htmlFor={fieldId(field)}>{label}</label>
    <input id={fieldId(field)} className="ideal-input" type={type} aria-invalid={invalid(field)} value={value[field]} onChange={(event) => onChange({ [field]: event.target.value })} {...extra} />
  </>;
  return <>
    <p className="ideal-note">就業規則と労使協定で定めた内容を、原本のとおりに入力します。内容が法令と協定の条件を満たすかどうかは、登録のときにサーバーが検証します。</p>
    <label htmlFor={fieldId("establishment_id")}>事業場</label>
    <select id={fieldId("establishment_id")} className="ideal-input" required aria-invalid={invalid("establishment_id")} value={value.establishment_id} onChange={(event) => onChange({ establishment_id: event.target.value })}>
      <option value="">選んでください</option>
      {listing.establishments.map((site) => <option key={site.establishment_id} value={site.establishment_id}>{names.site(site.establishment_id)}</option>)}
    </select>
    <label htmlFor={fieldId("target_scope")}>対象労働者の範囲</label>
    <textarea id={fieldId("target_scope")} className="ideal-input" required maxLength={2000} aria-invalid={invalid("target_scope")} value={value.target_scope} onChange={(event) => onChange({ target_scope: event.target.value })} />
    <FieldRow>
      <Field>
        <label htmlFor={fieldId("settlement_months")}>清算期間</label>
        <select id={fieldId("settlement_months")} className="ideal-input" aria-invalid={invalid("settlement_months")} value={value.settlement_months} onChange={(event) => onChange({ settlement_months: event.target.value })}>
          <option value="1">1か月</option><option value="2">2か月</option><option value="3">3か月</option>
        </select>
      </Field>
      <Field>{text("settlement_anchor", "清算期間の起算日（採用の開始日）", "date", { required: true })}</Field>
      <Field>{text("last_day", "採用の最終日（この日を含む）", "date", { required: true })}</Field>
    </FieldRow>
    <fieldset className="ideal-fieldset" id={fieldId("total_hours_rule")} tabIndex={-1}>
      <legend>総労働時間の定め</legend>
      {(["statutory_frame", "full_two_day_weekend"] as const).map((rule) => <label className="ideal-radio" key={rule}>
        <input type="radio" name={fieldId("total_hours_rule")} checked={value.total_hours_rule === rule} onChange={() => onChange(rule === "statutory_frame" ? { total_hours_rule: rule, rest_weekdays: [] } : { total_hours_rule: rule })} />
        {RULE_LABEL[rule]}
      </label>)}
    </fieldset>
    {value.total_hours_rule === "full_two_day_weekend" && <fieldset className="ideal-fieldset" id={fieldId("rest_weekdays")} tabIndex={-1}>
      <legend>毎週の休日</legend>
      {WEEKDAYS.map((day, index) => <div className="ideal-inline-field" key={day}>
        <span className="ideal-check-target"><input id={`${fieldId("rest_weekdays")}-${index}`} type="checkbox" checked={value.rest_weekdays.includes(index)}
          onChange={(event) => onChange({ rest_weekdays: event.target.checked ? [...value.rest_weekdays, index] : value.rest_weekdays.filter((item) => item !== index) })} /></span>
        <label htmlFor={`${fieldId("rest_weekdays")}-${index}`}>{day}曜日</label>
      </div>)}
    </fieldset>}
    {text("agreed_total_description", "協定で定めた総労働時間", "text", { required: true, maxLength: 500 })}
    {text("standard_day", "標準となる1日の労働時間（「時間:分」の形。例：7:45）", "text", { required: true, pattern: STANDARD_DAY_PATTERN, inputMode: "numeric" })}
    <fieldset className="ideal-fieldset">
      <legend>フレキシブルタイムとコアタイム（定めがある場合）</legend>
      <FieldRow>
        <Field>{text("flexible_start", "フレキシブルタイムの開始", "time", { required: Boolean(value.flexible_end) })}</Field>
        <Field>
          <label htmlFor={`${fieldId("flexible_start")}-end`}>フレキシブルタイムの終了</label>
          <input id={`${fieldId("flexible_start")}-end`} className="ideal-input" type="time" required={Boolean(value.flexible_start)} value={value.flexible_end} onChange={(event) => onChange({ flexible_end: event.target.value })} />
        </Field>
      </FieldRow>
      <FieldRow>
        <Field>{text("core_start", "コアタイムの開始", "time", { required: Boolean(value.core_end) })}</Field>
        <Field>
          <label htmlFor={`${fieldId("core_start")}-end`}>コアタイムの終了</label>
          <input id={`${fieldId("core_start")}-end`} className="ideal-input" type="time" required={Boolean(value.core_start)} value={value.core_end} onChange={(event) => onChange({ core_end: event.target.value })} />
        </Field>
      </FieldRow>
    </fieldset>
    <div id={fieldId("work_rules")} tabIndex={-1}><RecordEvidenceFields name="就業規則の規定" value={value.work_rules} onChange={(patch) => onChange({ work_rules: { ...value.work_rules, ...patch } })} /></div>
    <div id={fieldId("agreement")} tabIndex={-1}><RecordEvidenceFields name="労使協定" value={value.agreement} onChange={(patch) => onChange({ agreement: { ...value.agreement, ...patch } })} /></div>
    {months > 1 && <fieldset className="ideal-fieldset">
      <legend>協定届（清算期間が1か月を超える場合）</legend>
      <FieldRow>
        <Field>{text("filed_on", "届出日", "date", { required: true })}</Field>
        <Field>
          <label htmlFor={`${fieldId("filed_on")}-office`}>届出先の労働基準監督署</label>
          <input id={`${fieldId("filed_on")}-office`} className="ideal-input" required maxLength={200} value={value.office} onChange={(event) => onChange({ office: event.target.value })} />
        </Field>
        <Field>{text("valid_until", "協定の有効期間の終了日", "date", { required: true })}</Field>
      </FieldRow>
      <div id={fieldId("filing")} tabIndex={-1}><RecordEvidenceFields name="届出の控え" value={value.filing} onChange={(patch) => onChange({ filing: { ...value.filing, ...patch } })} /></div>
    </fieldset>}
    <fieldset className="ideal-fieldset">
      <legend>参加者（起算日から参加）</legend>
      {listing.people.length === 0 && <p className="ideal-note">この部署の勤務計画の入力に職員がいません。参加者は、採用の登録の後でも追加できます。</p>}
      {listing.people.map((person) => <div className="ideal-inline-field" key={person.person_id}>
        <span className="ideal-check-target"><input id={`${fieldId("establishment_id")}-person-${person.person_id}`} type="checkbox" checked={value.participants.includes(person.person_id)}
          onChange={(event) => onChange({ participants: event.target.checked ? [...value.participants, person.person_id] : value.participants.filter((item) => item !== person.person_id) })} /></span>
        <label htmlFor={`${fieldId("establishment_id")}-person-${person.person_id}`}>{person.name}</label>
      </div>)}
    </fieldset>
  </>;
}
