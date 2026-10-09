"use client";

import JstDateTimeField from "../../../shared/JstDateTimeField";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type LedgerRecordingPayload, type RecordSaved } from "../../api";
import { SelectField, TextField, WholeNumberField } from "../../../shared/records/fields";
import { LEDGER_NOTICE, accountLabel, eventLabel, ledgerOf, ledgerRisk, newRecording, recordingFacts, type Ledger } from "./ledger";

/** Registers when and under which HR event number a grant or a leave event was recorded
 * at its source. A recording is only added; later revisions are recorded as corrections. */
export default function LedgerRecordingEditor({ ledger, onSaved }: { ledger: Ledger; onSaved: () => void }) {
  const live = useLive();
  const api = requestsApi(live.client);
  return <RecordEditor<LedgerRecordingPayload, RecordSaved>
    noun="人事原本の記録日時" contentTitle="原本の記録日時を入力する" appendOnly
    create={() => newRecording(crypto.randomUUID())}
    facts={(payload) => recordingFacts(ledger, payload)}
    fields={({ value, onChange }) => <>
      <SelectField label="記録日時を照合する原本の種類" value={value.object_kind} options={[{ value: "leave_account", label: "付与原本" }, { value: "leave_record", label: "予約・取得等の原本" }]}
        onChange={(kind) => onChange({ object_kind: kind as LedgerRecordingPayload["object_kind"], object_id: "" })} />
      <SelectField label="記録日時を付す原本" value={value.object_id} onChange={(object_id) => onChange({ object_id })}
        options={value.object_kind === "leave_account" ? ledger.accounts.map((item) => ({ value: item.key, label: accountLabel(ledger, item.payload) })) : ledger.events.map((item) => ({ value: item.key, label: eventLabel(item.payload) }))} />
      <TextField label="外部人事の原本イベント番号" value={value.external_event_id} onChange={(external_event_id) => onChange({ external_event_id })} />
      <WholeNumberField label="外部人事の原本改定番号" value={value.external_revision} onChange={(external_revision) => onChange({ external_revision })} />
      <JstDateTimeField label="原本を把握した日時（日本時間）" value={value.recorded_at} onChange={(recorded_at) => onChange({ recorded_at })} required />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">把握した日時と効力日は別の値です。未来の把握日時を受け付けるかどうかは、サーバーが判定します。</p>
    </>}
    mutation={(payload) => `record:ledger_recording:${payload.recording_id}`}
    // The task's own records are read again once the server has answered.
    send={async (body) => { const result = await api.saveLedgerRecording(live.scopeId, body); onSaved(); return result; }}
    readCurrent={async (payload) => ledgerOf(await api.ledgerContext(live.scopeId)).recordings.find((item) => item.key === payload.recording_id && item.revision > 0) ?? null}
    notified={LEDGER_NOTICE} risk={ledgerRisk("記録日時")} />;
}
