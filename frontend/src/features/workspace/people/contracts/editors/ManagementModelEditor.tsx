"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { DayField, SelectField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type ManagementModelPayload, type RecordSaved } from "../../api";
import { managementModelFacts } from "../facts";
import { employerName, employersOf, ofPerson, periodText, personName, personOptions } from "../model";
import { PeriodFields, SecondsField, currentRecord, runsForward, savedNotice, type EditorProps } from "./parts";

const newModel = (personId: string): ManagementModelPayload => ({
  model_id: crypto.randomUUID(), person_id: personId, first_employer: "", second_employer: "", start: "", end: "", month_anchor: "",
  first_month_limit_seconds: 0, second_month_limit_seconds: 0,
  first_consent: { ...EMPTY_RECORD_EVIDENCE }, second_consent: { ...EMPTY_RECORD_EVIDENCE }, notification: { ...EMPTY_RECORD_EVIDENCE },
});

/** Registers the management model two employers of one person agreed on for the person's
 * side work: which employer keeps which monthly bound, with each employer's consent and
 * the notification as evidence. */
export default function ManagementModelEditor({ roster, personId, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<ManagementModelPayload, RecordSaved>
    noun="兼業の管理モデル" contentTitle="管理モデルの内容と根拠を入力する"
    records={ofPerson(roster.managementModels, personId).map((item) => ({ ...item, label: `${personName(roster, item.payload.person_id)}・${employerName(roster, item.payload.first_employer)}と${employerName(roster, item.payload.second_employer)} ${periodText(item.payload.start, item.payload.end)}` }))}
    create={() => newModel(personId)}
    facts={(payload) => managementModelFacts(roster, payload)}
    fields={({ value, onChange }) => {
      const employers = employersOf(roster, value.person_id);
      return <>
        <SelectField label="対象職員" value={value.person_id} options={personOptions(roster)} onChange={(person_id) => onChange({ person_id, first_employer: "", second_employer: "" })} />
        <PeriodFields start={value.start} end={value.end} onChange={onChange} />
        <SelectField label="先契約の雇用主" value={value.first_employer} options={employers} onChange={(first_employer) => onChange({ first_employer, second_employer: "" })} />
        <SelectField label="後契約の雇用主" value={value.second_employer} options={employers.filter((option) => option.value !== value.first_employer)} onChange={(second_employer) => onChange({ second_employer })} />
        <DayField label="管理モデルの月起算日" value={value.month_anchor} onChange={(month_anchor) => onChange({ month_anchor })} />
        <SecondsField label="先契約側の法定外時間上限" value={value.first_month_limit_seconds} onChange={(first_month_limit_seconds) => onChange({ first_month_limit_seconds })} />
        <SecondsField label="後契約側の総労働時間上限" value={value.second_month_limit_seconds} onChange={(second_month_limit_seconds) => onChange({ second_month_limit_seconds })} />
        <RecordEvidenceFields name="先契約の雇用主の合意" value={value.first_consent} onChange={(patch) => onChange({ first_consent: { ...value.first_consent, ...patch } })} />
        <RecordEvidenceFields name="後契約の雇用主の合意" value={value.second_consent} onChange={(patch) => onChange({ second_consent: { ...value.second_consent, ...patch } })} />
        <RecordEvidenceFields name="通知の確認" value={value.notification} onChange={(patch) => onChange({ notification: { ...value.notification, ...patch } })} />
        <p className="ideal-note">雇用主は、この職員に契約または雇用関係が登録されているものから選びます。この管理モデルを勤務の計算に使えるかどうかは、サーバーが検証で判定します。</p>
      </>;
    }}
    slip={runsForward}
    mutation={(payload) => `record:management_model:${payload.model_id}`}
    send={(body) => api.saveManagementModel(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.managementModels.find((item) => item.key === payload.model_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("管理モデル")} saved={savedNotice("兼業の管理モデル")}
    refusedChange="登録済みの管理モデルの対象職員は変えられません。別の職員の管理モデルは、新しく登録してください。" {...opening} />;
}
