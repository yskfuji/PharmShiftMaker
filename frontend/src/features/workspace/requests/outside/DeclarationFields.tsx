"use client";

import { useId } from "react";
import JstDateTimeField from "../../shared/JstDateTimeField";
import type { RecordFieldsProps } from "../../shared/records/RecordEditor";
import type { DeclarationContext, DeclarationPayload } from "../api";
import IntervalList from "./IntervalList";

/**
 * The content of one declaration: where the other work is, what kind it is, the period it
 * covers, the declared intervals and the document it was taken from. Only presence and
 * number format are checked here. Each field reports only what it changed.
 */
export default function DeclarationFields({ value, onChange, employers, establishments }: RecordFieldsProps<DeclarationPayload> & Pick<DeclarationContext, "employers" | "establishments">) {
  const id = useId();
  const sites = establishments.filter((site) => site.employer_id === value.employer_id);
  return <>
    <p className="ideal-note">候補にない勤務先は、管理者による雇用主・事業場の登録が必要です。申告の識別子と版はサーバーが管理します。</p>
    <label htmlFor={`${id}-employer`}>他の雇用主・活動先</label>
    <select id={`${id}-employer`} className="ideal-input" required value={value.employer_id} onChange={(event) => onChange({ employer_id: event.target.value, establishment_id: "" })}>
      <option value="">選んでください</option>
      {employers.map((employer) => <option key={employer.employer_id} value={employer.employer_id}>{employer.name}</option>)}
    </select>
    <label htmlFor={`${id}-site`}>申告する事業場</label>
    <select id={`${id}-site`} className="ideal-input" required value={value.establishment_id} onChange={(event) => onChange({ establishment_id: event.target.value })}>
      <option value="">選んでください</option>
      {sites.map((site, index) => <option key={site.establishment_id} value={site.establishment_id}>{site.name ?? `名称未登録の事業場 ${index + 1}`}</option>)}
    </select>
    <label htmlFor={`${id}-activity`}>活動の区分</label>
    <select id={`${id}-activity`} className="ideal-input" value={value.activity} onChange={(event) => onChange({ activity: event.target.value as DeclarationPayload["activity"] })}>
      <option value="employment">雇用</option>
      <option value="nonemployment">非雇用活動</option>
    </select>
    <label htmlFor={`${id}-order`}>契約締結順（不明の場合は空欄）</label>
    <input id={`${id}-order`} className="ideal-input" type="number" min={1} step={1} value={value.contract_order ?? ""} onChange={(event) => onChange({ contract_order: event.target.value ? event.target.valueAsNumber : null })} />
    <JstDateTimeField label="適用開始（日本時間）" value={value.start} onChange={(start) => onChange({ start })} required />
    <JstDateTimeField label="適用終了（日本時間）" value={value.end} onChange={(end) => onChange({ end })} required />
    <IntervalList name="所定" value={value.scheduled_work} onChange={(scheduled_work) => onChange({ scheduled_work })} />
    <IntervalList name="所定外" value={value.additional_work} onChange={(additional_work) => onChange({ additional_work })} />
    <IntervalList name="他社の法定休日の" note="他社の法定休日に働いた区間です。区分と通算の扱いはサーバーが決めます。" value={value.other_holiday_work ?? []} onChange={(other_holiday_work) => onChange({ other_holiday_work })} />
    <div className="ideal-inline-field">
      <span className="ideal-check-target"><input id={`${id}-complete`} type="checkbox" checked={value.work_report_complete} onChange={(event) => onChange({ work_report_complete: event.target.checked })} /></span>
      <label htmlFor={`${id}-complete`}>この期間の労働区間をすべて記載した</label>
    </div>
    <label htmlFor={`${id}-reference`}>契約・所定時間・所定外時間の照合資料</label>
    <textarea id={`${id}-reference`} className="ideal-input" required maxLength={2000} value={value.reference} onChange={(event) => onChange({ reference: event.target.value })} />
    <p className="ideal-note">申告は、管理者が他社資料と照合するまで「照合待ち」です。労働時間に通算するかどうかは、照合後にサーバーが判定します。</p>
  </>;
}
