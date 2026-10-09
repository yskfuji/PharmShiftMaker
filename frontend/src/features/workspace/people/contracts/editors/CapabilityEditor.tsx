"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { CheckField, SelectField, WholeNumberField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type CapabilityPayload, type RecordSaved } from "../../api";
import { capabilityFacts } from "../facts";
import { capabilityLabel, ofPerson, personOptions, sameContent } from "../model";
import { PeriodFields, currentRecord, runsForward, savedNotice, type EditorProps } from "./parts";

const newCapability = (personId: string): CapabilityPayload => ({ person_id: personId, task: "", location: "", start: "", end: "", evidence: { ...EMPTY_RECORD_EVIDENCE }, supervision_required: false, supervisor_capacity: 0 });

/** Registers the duty a person may be assigned to and the supervision it needs. A
 * qualification is identified by its content: one whose content is changed is saved as
 * another record, and the one it started from stays as it is. */
export default function CapabilityEditor({ roster, personId, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<CapabilityPayload, RecordSaved>
    noun="資格・監督条件" contentTitle="資格の内容と根拠を入力する"
    records={ofPerson(roster.capabilities, personId).map((item) => ({ ...item, label: capabilityLabel(roster, item.payload) }))}
    create={() => newCapability(personId)}
    facts={(payload) => capabilityFacts(roster, payload)}
    fields={({ value, exists, onChange }) => {
      const tasks = Array.from(new Set([...roster.duties.map((duty) => duty.task), value.task])).filter(Boolean);
      const locations = Array.from(new Set([...roster.duties.map((duty) => duty.location), value.location])).filter(Boolean);
      return <>
        {exists && <p className="ideal-note">内容を変えると、別の新しい資格として登録されます。元の記録は変わらずに残ります。元の資格を終わらせるには「資格の取消・失効を記録する」を使ってください。</p>}
        <SelectField label="対象職員" value={value.person_id} options={personOptions(roster)} onChange={(person_id) => onChange({ person_id })} />
        <PeriodFields start={value.start} end={value.end} onChange={onChange} />
        <SelectField label="担当業務" value={value.task} options={tasks.map((task) => ({ value: task, label: task }))} onChange={(task) => onChange({ task })} />
        <SelectField label="勤務場所" value={value.location} options={locations.map((location) => ({ value: location, label: location }))} onChange={(location) => onChange({ location })} />
        <CheckField label="監督者の配置が必要" checked={value.supervision_required} onChange={(supervision_required) => onChange({ supervision_required })} />
        <WholeNumberField label="同時に監督できる人数" value={value.supervisor_capacity} onChange={(supervisor_capacity) => onChange({ supervisor_capacity })} />
        <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
        <p className="ideal-note">この資格で必要配置を満たせるかどうかは、生成と検証でサーバーが判定します。</p>
      </>;
    }}
    slip={runsForward}
    // Changed content is another record: it is sent as one that is not registered yet.
    expected={(base, payload) => (sameContent(base.payload, payload) ? base.revision : 0)}
    mutation={(payload) => `record:capability:${payload.person_id}:${payload.task}:${payload.location}:${payload.start}`}
    send={(body) => api.saveCapability(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.capabilities.find((item) => sameContent(item.payload, payload)))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("資格")} saved={savedNotice("資格")} {...opening} />;
}
