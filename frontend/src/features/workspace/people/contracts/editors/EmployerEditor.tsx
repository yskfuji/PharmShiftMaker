"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { TextField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type EmployerPayload, type RecordSaved } from "../../api";
import { employerFacts } from "../facts";
import { currentRecord, savedNotice, type EditorProps } from "./parts";

/** Registers an employer by its formal name, or corrects the name. Sites, employments and
 * agreements name this record. */
export default function EmployerEditor({ roster, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<EmployerPayload, RecordSaved>
    noun="雇用主" contentTitle="雇用主の名称と根拠を入力する"
    records={roster.employers.map((item) => ({ ...item, label: item.payload.name || "名称未登録の雇用主" }))}
    create={() => ({ employer_id: crypto.randomUUID(), name: "", evidence: { ...EMPTY_RECORD_EVIDENCE } })}
    facts={employerFacts}
    fields={({ value, onChange }) => <>
      <TextField label="雇用主の正式名称" value={value.name} onChange={(name) => onChange({ name })} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">識別子は自動で発行します。名称を変えても、同じ雇用主の記録として版が進みます。</p>
    </>}
    mutation={(payload) => `record:employer:${payload.employer_id}`}
    send={(body) => api.saveEmployer(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.employers.find((item) => item.key === payload.employer_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("雇用主")} saved={savedNotice("雇用主")} {...opening} />;
}
