"use client";

import JstDateTimeField from "../../../shared/JstDateTimeField";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { SelectField, TextField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type CapabilityAmendmentPayload, type RecordSaved } from "../../api";
import { capabilityAmendmentFacts } from "../facts";
import { capabilityLabel, ofPerson } from "../model";
import { currentRecord, savedNotice, type EditorProps } from "./parts";

/** Records from when a saved qualification can no longer be used. It is only added: the
 * qualification it names keeps its content, and its period ends at the recorded instant. */
export default function CapabilityAmendmentEditor({ roster, personId }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  const targets = ofPerson(roster.capabilityTargets, personId);
  return <RecordEditor<CapabilityAmendmentPayload, RecordSaved>
    noun="資格の取消・失効" contentTitle="取消・失効の内容と根拠を入力する" appendOnly
    create={() => ({ amendment_id: crypto.randomUUID(), person_id: "", target_hash: "", effective_at: "", reason: "", evidence: { ...EMPTY_RECORD_EVIDENCE } })}
    facts={(payload) => capabilityAmendmentFacts(roster, payload)}
    fields={({ value, onChange }) => <>
      <SelectField label="取消・失効の対象資格" value={value.target_hash} options={targets.map((item) => ({ value: item.key, label: capabilityLabel(roster, item.payload) }))}
        onChange={(target_hash) => onChange({ target_hash, person_id: targets.find((item) => item.key === target_hash)?.payload.person_id ?? "" })} />
      {targets.length === 0 && <p className="ideal-note">取消・失効の対象にできる、保存済みの資格はありません。</p>}
      <JstDateTimeField label="資格を使用できなくなる日時（日本時間）" value={value.effective_at} onChange={(effective_at) => onChange({ effective_at })} required />
      <TextField label="資格の取消・失効理由" value={value.reason} onChange={(reason) => onChange({ reason })} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">はじめから無効にするときは、資格の開始と同じ日時を入力します。元の資格の記録は残り、その有効期間だけが短くなります。日時が資格の期間に入っているかどうかは、サーバーが保存時に確かめます。</p>
    </>}
    mutation={(payload) => `record:capability_amendment:${payload.amendment_id}`}
    send={(body) => api.saveCapabilityAmendment(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.capabilityAmendments.find((item) => item.key === payload.amendment_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("取消・失効の記録")} saved={savedNotice("資格の取消・失効")} />;
}
