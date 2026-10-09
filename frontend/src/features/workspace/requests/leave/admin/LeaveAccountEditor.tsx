"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type LeaveAccountPayload, type RecordSaved } from "../../api";
import { DayField, TextField, WholeNumberField } from "../../../shared/records/fields";
import { LEDGER_NOTICE, accountFacts, ledgerOf, ledgerRisk, newAccount, type Ledger } from "./ledger";
import PersonEmployerFields from "./PersonEmployerFields";

/** Registers one grant as the HR source states it. A grant is only added: its days are
 * corrected by a grant correction, which keeps the original. */
export default function LeaveAccountEditor({ ledger, onSaved }: { ledger: Ledger; onSaved: () => void }) {
  const live = useLive();
  const api = requestsApi(live.client);
  return <RecordEditor<LeaveAccountPayload, RecordSaved>
    noun="年休の付与" contentTitle="付与原本の内容を入力する" appendOnly
    create={() => newAccount(crypto.randomUUID())}
    facts={(payload) => accountFacts(ledger, payload)}
    fields={({ value, onChange }) => <>
      <PersonEmployerFields ledger={ledger} personId={value.person_id} employerId={value.employer_id} onChange={onChange} />
      <DayField label="原本の付与日" value={value.granted_on} onChange={(granted_on) => onChange({ granted_on })} />
      <DayField label="失効日（この日を含まない）" value={value.expires_on} onChange={(expires_on) => onChange({ expires_on })} />
      <WholeNumberField label="原本の付与日数" value={value.granted_days} onChange={(granted_days) => onChange({ granted_days })} />
      <WholeNumberField label="うち法定付与日数" value={value.statutory_days} onChange={(statutory_days) => onChange({ statutory_days })} />
      <TextField label="外部人事の付与系列の参照（任意）" required={false} value={value.grant_cycle_id ?? ""} onChange={(text) => onChange({ grant_cycle_id: text || null })} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">付与原本は上書きできません。日数の訂正は「付与日数を訂正する」で行います。</p>
    </>}
    mutation={(payload) => `record:leave_account:${payload.account_id}`}
    // The task's own records are read again once the server has answered.
    send={async (body) => { const result = await api.saveLeaveAccount(live.scopeId, body); onSaved(); return result; }}
    readCurrent={async (payload) => ledgerOf(await api.ledgerContext(live.scopeId)).accounts.find((item) => item.key === payload.account_id && item.revision > 0) ?? null}
    notified={LEDGER_NOTICE} risk={ledgerRisk("付与")} />;
}
