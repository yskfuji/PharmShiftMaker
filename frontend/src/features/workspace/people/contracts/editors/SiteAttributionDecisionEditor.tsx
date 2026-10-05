"use client";

import { useId } from "react";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { SelectField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type RecordSaved, type SiteAttributionDecisionPayload } from "../../api";
import { siteDecisionFacts } from "../facts";
import { READING, employerName, employerOptions, periodText } from "../model";
import { OneOfField, PeriodFields, currentRecord, runsForward, savedNotice, type EditorProps } from "./parts";

/** Records the facility's decision on how overtime is attributed between the sites of one
 * employer for a period, with its reason. Where the decision applies is the server's. */
export default function SiteAttributionDecisionEditor({ roster, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  const reasonId = useId();
  return <RecordEditor<SiteAttributionDecisionPayload, RecordSaved>
    noun="事業場間の時間外の帰属の判断" contentTitle="判断の内容と根拠を入力する"
    records={roster.siteDecisions.map((item) => ({ ...item, label: `${employerName(roster, item.payload.employer_id)} ${periodText(item.payload.start, item.payload.end)}` }))}
    create={() => ({ decision_id: crypto.randomUUID(), employer_id: "", reading: "scheduled_first", reason: "", start: "", end: "", evidence: { ...EMPTY_RECORD_EVIDENCE } })}
    facts={(payload) => siteDecisionFacts(roster, payload)}
    fields={({ value, onChange }) => <>
      <PeriodFields start={value.start} end={value.end} onChange={onChange} />
      <SelectField label="判断の対象とする雇用主" value={value.employer_id} options={employerOptions(roster)} onChange={(employer_id) => onChange({ employer_id })} />
      <OneOfField label="時間外を帰属させる順序" value={value.reading} options={(Object.entries(READING) as Array<[SiteAttributionDecisionPayload["reading"], string]>).map(([key, text]) => ({ value: key, label: text }))} onChange={(reading) => onChange({ reading })} />
      <label htmlFor={reasonId}>判断の理由と根拠（人事・法務）</label>
      <textarea id={reasonId} className="ideal-input" rows={4} required value={value.reason} onChange={(event) => onChange({ reason: event.target.value })} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">同じ雇用主の複数の事業場で働いた日の時間外を、どの順序で数えるかの判断です。この判断を計算に使える範囲は、サーバーが検証で決め、使えない範囲は未確認として残します。</p>
    </>}
    slip={runsForward}
    mutation={(payload) => `record:site_attribution_decision:${payload.decision_id}`}
    send={(body) => api.saveSiteAttributionDecision(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.siteDecisions.find((item) => item.key === payload.decision_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("判断")} saved={savedNotice("事業場間の時間外の帰属の判断")} {...opening} />;
}
