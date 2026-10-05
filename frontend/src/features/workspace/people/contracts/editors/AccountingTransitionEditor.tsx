"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { SelectField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type AccountingTransitionPayload, type RecordSaved } from "../../api";
import { accountingTransitionFacts } from "../facts";
import { BASIS, employmentLabel } from "../model";
import { OneOfField, currentRecord, savedNotice, type EditorProps } from "./parts";

/** Records how working time is counted across a change of a person's employment terms:
 * the revision before, the revision after and the confirmed way of counting. Which pairs
 * of revisions may be joined is the server's rule; it reports a pair it does not accept. */
export default function AccountingTransitionEditor({ roster, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  const revisions = roster.employments.map((item) => ({ value: item.key, label: employmentLabel(roster, item.payload) }));
  const label = (item: AccountingTransitionPayload) => { const before = roster.employments.find((entry) => entry.key === item.before_revision_id)?.payload; return `${before ? employmentLabel(roster, before) : "切替前の雇用条件が未登録"} から`; };
  return <RecordEditor<AccountingTransitionPayload, RecordSaved>
    noun="制度切替の集計条件" contentTitle="切替の内容と根拠を入力する"
    records={roster.accountingTransitions.map((item) => ({ ...item, label: label(item.payload) }))}
    create={() => ({ transition_id: crypto.randomUUID(), before_revision_id: "", after_revision_id: "", calculation_basis: "effective_calendar_windows", evidence: { ...EMPTY_RECORD_EVIDENCE } })}
    facts={(payload) => accountingTransitionFacts(roster, payload)}
    fields={({ value, onChange }) => <>
      <SelectField label="切替前の雇用条件" value={value.before_revision_id} options={revisions} onChange={(before_revision_id) => onChange({ before_revision_id, after_revision_id: "" })} />
      <SelectField label="切替後の雇用条件" value={value.after_revision_id} options={revisions} onChange={(after_revision_id) => onChange({ after_revision_id })} />
      <OneOfField label="確認した集計方法" value={value.calculation_basis} options={(Object.entries(BASIS) as Array<[AccountingTransitionPayload["calculation_basis"], string]>).map(([key, text]) => ({ value: key, label: text }))} onChange={(calculation_basis) => onChange({ calculation_basis })} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">登録されている雇用条件のすべてから選べます。切替前と切替後の組み合わせとして成り立つかどうかは、サーバーが検証し、成り立たない組み合わせは「現在の状態」の検証結果に表示されます。</p>
    </>}
    mutation={(payload) => `record:accounting_transition:${payload.transition_id}`}
    send={(body) => api.saveAccountingTransition(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.accountingTransitions.find((item) => item.key === payload.transition_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("集計条件")} saved={savedNotice("制度切替の集計条件")} {...opening} />;
}
