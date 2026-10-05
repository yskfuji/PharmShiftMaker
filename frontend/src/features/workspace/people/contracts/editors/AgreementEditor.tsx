"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { CheckField, DayField, SelectField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type AgreementPayload, type RecordSaved } from "../../api";
import { agreementFacts } from "../facts";
import { agreementLabel, siteLabel } from "../model";
import { PeriodFields, SecondsField, currentRecord, runsForward, savedNotice, type EditorProps } from "./parts";

const newAgreement = (): AgreementPayload => ({
  agreement_id: crypto.randomUUID(), employer_id: "", establishment_id: "", start: "", end: "", year_start: "", month_anchor: "",
  daily_limit_seconds: 0, monthly_limit_seconds: 0, annual_limit_seconds: 0, special_clause: false, holiday_work_permitted: false,
  evidence: { ...EMPTY_RECORD_EVIDENCE }, invocation_evidence: null,
});

/** Registers the overtime agreement of one site as its document states it: its period, its
 * anchors, its bounds and whether it has a special clause. Whether those bounds are
 * allowed is the server's rule; an agreement it does not accept is refused in its words. */
export default function AgreementEditor({ roster, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<AgreementPayload, RecordSaved>
    noun="36協定" contentTitle="協定の内容と根拠を入力する"
    records={roster.agreements.map((item) => ({ ...item, label: agreementLabel(roster, item.payload) }))}
    create={newAgreement}
    facts={(payload) => agreementFacts(roster, payload)}
    fields={({ value, onChange }) => <>
      <PeriodFields start={value.start} end={value.end} onChange={onChange} />
      <SelectField label="協定を適用する事業場" value={value.establishment_id ?? ""} options={roster.establishments.map((item) => ({ value: item.key, label: siteLabel(roster, item.payload) }))}
        onChange={(establishment_id) => onChange({ establishment_id, employer_id: roster.establishments.find((item) => item.key === establishment_id)?.payload.employer_id ?? "" })} />
      <DayField label="協定年の起算日" value={value.year_start} onChange={(year_start) => onChange({ year_start })} />
      <DayField label="協定月の起算日" value={value.month_anchor} onChange={(month_anchor) => onChange({ month_anchor })} />
      <SecondsField label="協定の日時間外上限" value={value.daily_limit_seconds} onChange={(daily_limit_seconds) => onChange({ daily_limit_seconds })} />
      <SecondsField label="協定の月時間外上限" value={value.monthly_limit_seconds} onChange={(monthly_limit_seconds) => onChange({ monthly_limit_seconds })} />
      <SecondsField label="協定の年時間外上限" value={value.annual_limit_seconds} onChange={(annual_limit_seconds) => onChange({ annual_limit_seconds })} />
      <CheckField label="特別条項の定めがある" checked={value.special_clause} onChange={(special_clause) => onChange({ special_clause })} />
      <CheckField label="休日労働を認める定めがある" checked={value.holiday_work_permitted} onChange={(holiday_work_permitted) => onChange({ holiday_work_permitted })} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      {value.special_clause && <RecordEvidenceFields name="特別条項の適用根拠" value={value.invocation_evidence ?? EMPTY_RECORD_EVIDENCE}
        onChange={(patch) => onChange({ invocation_evidence: { ...(value.invocation_evidence ?? EMPTY_RECORD_EVIDENCE), ...patch } })} />}
      <p className="ideal-note">協定書に書かれた上限を、そのまま秒数で入力します。上限が法令の範囲に収まるかどうかは、サーバーが保存時に判定し、収まらない協定は理由を示して受け付けません。協定の上限と、兼業を通算する上限は、別々に検証されます。</p>
    </>}
    slip={runsForward}
    mutation={(payload) => `record:agreement:${payload.agreement_id}`}
    send={(body) => api.saveAgreement(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.agreements.find((item) => item.key === payload.agreement_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("協定")} saved={savedNotice("36協定")} {...opening} />;
}
