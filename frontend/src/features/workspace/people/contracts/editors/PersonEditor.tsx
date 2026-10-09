"use client";

import { TextField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type PersonPayload, type RecordSaved } from "../../api";
import { personFacts } from "../facts";
import { ofPerson } from "../model";
import { currentRecord, savedNotice, type EditorProps } from "./parts";

/** Registers a person by name, or corrects a registered name. The person's other records
 * (employment, contract, qualification) name this record. */
export default function PersonEditor({ roster, personId, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<PersonPayload, RecordSaved>
    noun="職員" contentTitle="職員の氏名を入力する"
    records={ofPerson(roster.people, personId).map((item) => ({ ...item, label: item.payload.name || "氏名未登録の職員" }))}
    create={() => ({ person_id: crypto.randomUUID(), name: "" })}
    facts={personFacts}
    fields={({ value, onChange }) => <>
      <TextField label="職員の氏名" value={value.name} onChange={(name) => onChange({ name })} />
      <p className="ideal-note">識別子は自動で発行します。氏名を訂正しても、同じ職員の記録として版が進みます。</p>
    </>}
    mutation={(payload) => `record:person:${payload.person_id}`}
    send={(body) => api.savePerson(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.people.find((item) => item.key === payload.person_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("職員")} saved={savedNotice("職員")} {...opening} />;
}
