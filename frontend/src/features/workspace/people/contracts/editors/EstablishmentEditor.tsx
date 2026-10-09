"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { SelectField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type EstablishmentPayload, type RecordSaved } from "../../api";
import { establishmentFacts } from "../facts";
import { employerOptions, siteLabel } from "../model";
import { PeriodFields, currentRecord, runsForward, savedNotice, type EditorProps } from "./parts";

/** Registers a site of an employer and the period it exists for, or revises that period.
 * Employments, agreements and calendars are tied to a site. */
export default function EstablishmentEditor({ roster, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<EstablishmentPayload, RecordSaved>
    noun="事業場" contentTitle="事業場の内容と根拠を入力する"
    records={roster.establishments.map((item) => ({ ...item, label: siteLabel(roster, item.payload) }))}
    create={() => ({ establishment_id: crypto.randomUUID(), employer_id: "", start: "", end: "", evidence: { ...EMPTY_RECORD_EVIDENCE } })}
    facts={(payload) => establishmentFacts(roster, payload)}
    fields={({ value, onChange }) => <>
      <SelectField label="事業場の雇用主" value={value.employer_id} options={employerOptions(roster)} onChange={(employer_id) => onChange({ employer_id })} />
      {roster.employerIds.length === 0 && <p className="ideal-note">先に「雇用主を登録・変更する」で雇用主を登録してください。</p>}
      <PeriodFields start={value.start} end={value.end} onChange={onChange} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
    </>}
    slip={runsForward}
    mutation={(payload) => `record:establishment:${payload.establishment_id}`}
    send={(body) => api.saveEstablishment(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.establishments.find((item) => item.key === payload.establishment_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("事業場")} saved={savedNotice("事業場")} {...opening} />;
}
