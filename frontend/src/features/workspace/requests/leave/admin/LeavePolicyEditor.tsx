"use client";

import JstDateTimeField from "../../../shared/JstDateTimeField";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type LeavePolicyPayload, type RecordSaved } from "../../api";
import { CheckField, DayField, WholeNumberField } from "../../../shared/records/fields";
import { LEDGER_NOTICE, ledgerOf, ledgerRisk, newPolicy, policyFacts, policyLabel, type Ledger } from "./ledger";
import PersonEmployerFields from "./PersonEmployerFields";

/** Registers a leave rule of one person and employer, or changes a registered one. Which
 * of its lines may still change is the server's rule; a refused change is said as such. */
export default function LeavePolicyEditor({ ledger, onSaved }: { ledger: Ledger; onSaved: () => void }) {
  const live = useLive();
  const api = requestsApi(live.client);
  return <RecordEditor<LeavePolicyPayload, RecordSaved>
    noun="年休の取得規則" contentTitle="取得規則の内容を入力する"
    records={ledger.policies.map((item) => ({ ...item, label: `${ledger.person(item.payload.person_id)} ${policyLabel(item.payload)}` }))}
    create={() => newPolicy(crypto.randomUUID())}
    facts={(payload) => policyFacts(ledger, payload)}
    fields={({ value, onChange }) => <>
      <PersonEmployerFields ledger={ledger} personId={value.person_id} employerId={value.employer_id} onChange={onChange} />
      <JstDateTimeField label="適用開始（日本時間）" value={value.start} onChange={(start) => onChange({ start })} required />
      <JstDateTimeField label="適用終了（日本時間）" value={value.end} onChange={(end) => onChange({ end })} required />
      <CheckField label="時間単位年休を認める協定がある" checked={value.hourly_enabled} onChange={(hourly_enabled) => onChange({ hourly_enabled })} />
      <CheckField label="半日単位の取得を認める" checked={value.half_day_enabled} onChange={(half_day_enabled) => onChange({ half_day_enabled })} />
      <WholeNumberField label="1日に相当する時間数" value={value.hours_per_day} onChange={(hours_per_day) => onChange({ hours_per_day })} />
      <WholeNumberField label="時間年休の取得単位（時間）" value={value.hourly_quantum} onChange={(hourly_quantum) => onChange({ hourly_quantum })} />
      <WholeNumberField label="年間の時間年休上限（日相当）" value={value.hourly_cap_days} onChange={(hourly_cap_days) => onChange({ hourly_cap_days })} />
      <DayField label="時間年休上限の年起算日" value={value.hourly_year_start} onChange={(hourly_year_start) => onChange({ hourly_year_start })} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">時間数や上限が規則として成り立つかどうかは、サーバーが判定します。換算を変えるときは、新しい規則として登録してください。</p>
    </>}
    // An entry slip, not a judgement: the server refuses a period that does not run forward.
    slip={(payload) => (Date.parse(payload.start) >= Date.parse(payload.end) ? "適用終了は、適用開始より後にしてください。" : null)}
    mutation={(payload) => `record:leave_policy:${payload.policy_id}`}
    // The task's own records are read again once the server has answered.
    send={async (body) => { const result = await api.saveLeavePolicy(live.scopeId, body); onSaved(); return result; }}
    readCurrent={async (payload) => ledgerOf(await api.ledgerContext(live.scopeId)).policies.find((item) => item.key === payload.policy_id && item.revision > 0) ?? null}
    notified={LEDGER_NOTICE} risk={ledgerRisk("取得規則")}
    refusedChange="登録済みの規則で変えられる項目は、サーバーが決めています。換算や単位を変えるときは、新しい規則として登録してください。" />;
}
