"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type LeaveObligationPayload, type RecordSaved } from "../../api";
import { CheckField, DayField, SelectField, WholeNumberField } from "../../../shared/records/fields";
import { LEDGER_NOTICE, OBLIGATION_METHOD, ledgerOf, ledgerRisk, newObligation, obligationFacts, type Ledger } from "./ledger";
import PersonEmployerFields from "./PersonEmployerFields";

/** Registers or changes the period in which one person's five days are managed, and the
 * grants the period rests on. Whether the period and its quantity stand is accounted by
 * the server and shown with the ledger. */
export default function LeaveObligationEditor({ ledger, onSaved }: { ledger: Ledger; onSaved: () => void }) {
  const live = useLive();
  const api = requestsApi(live.client);
  return <RecordEditor<LeaveObligationPayload, RecordSaved>
    noun="年5日の管理期間" contentTitle="管理期間の内容を入力する"
    records={ledger.obligations.map((item) => ({ ...item, label: `${ledger.person(item.payload.person_id)} ${item.payload.start}〜${item.payload.end}` }))}
    create={() => newObligation(crypto.randomUUID())}
    facts={(payload) => obligationFacts(ledger, payload)}
    fields={({ value, onChange }) => {
      const grants = ledger.accounts.filter((item) => item.payload.person_id === value.person_id && item.payload.employer_id === value.employer_id);
      return <>
        <PersonEmployerFields ledger={ledger} personId={value.person_id} employerId={value.employer_id} onChange={(patch) => onChange({ ...patch, qualifying_grant_ids: [] })} />
        <DayField label="管理期間の開始日" value={value.start} onChange={(start) => onChange({ start })} />
        <DayField label="管理期間の終了日（この日を含まない）" value={value.end} onChange={(end) => onChange({ end })} />
        <WholeNumberField label="必要な取得量（半日を1として記録）" value={value.required_half_days} onChange={(required_half_days) => onChange({ required_half_days })} />
        <SelectField label="基準日が重なる場合の管理方法" value={value.method} options={Object.entries(OBLIGATION_METHOD).map(([key, label]) => ({ value: key, label }))} onChange={(method) => onChange({ method: method as LeaveObligationPayload["method"] })} />
        <SelectField label="取得管理の単位" value={value.rounding_unit} options={[{ value: "day", label: "日単位" }, { value: "half_day", label: "本人請求を確認した半日単位" }]}
          onChange={(unit) => onChange(unit === "half_day" ? { rounding_unit: "half_day", half_day_request_evidence: value.half_day_request_evidence ?? { ...EMPTY_RECORD_EVIDENCE } } : { rounding_unit: "day" })} />
        <fieldset className="ideal-fieldset">
          <legend>対象判定に用いた付与原本</legend>
          {grants.length === 0 && <p className="ideal-note">この職員と雇用主に登録された付与はありません。</p>}
          {grants.map((grant) => <CheckField key={grant.key} label={`${grant.payload.granted_on}付与 法定${grant.payload.statutory_days}日`} checked={value.qualifying_grant_ids.includes(grant.key)}
            onChange={(checked) => onChange({ qualifying_grant_ids: checked ? [...value.qualifying_grant_ids, grant.key] : value.qualifying_grant_ids.filter((item) => item !== grant.key) })} />)}
        </fieldset>
        <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
        {value.rounding_unit === "half_day" && <RecordEvidenceFields name="半日取得の本人請求確認" value={value.half_day_request_evidence ?? EMPTY_RECORD_EVIDENCE}
          onChange={(patch) => onChange({ half_day_request_evidence: { ...(value.half_day_request_evidence ?? EMPTY_RECORD_EVIDENCE), ...patch } })} />}
        <p className="ideal-note">対象者や必要な取得量が成り立つかどうかは、サーバーが台帳の照合で判定し、「現在の状態」に表示します。</p>
      </>;
    }}
    mutation={(payload) => `record:leave_obligation:${payload.obligation_id}`}
    // The task's own records are read again once the server has answered.
    send={async (body) => { const result = await api.saveLeaveObligation(live.scopeId, body); onSaved(); return result; }}
    readCurrent={async (payload) => ledgerOf(await api.ledgerContext(live.scopeId)).obligations.find((item) => item.key === payload.obligation_id && item.revision > 0) ?? null}
    notified={LEDGER_NOTICE} risk={ledgerRisk("管理期間")} />;
}
