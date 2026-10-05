"use client";

import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { DayField, SelectField, TextField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type RecordSaved, type RuleReviewPayload } from "../../api";
import { ruleReviewFacts } from "../facts";
import { reviewLabel } from "../model";
import { PeriodFields, currentRecord, runsForward, savedNotice, type EditorProps } from "./parts";

/** Records that a rule revision was checked against its primary source for a period: the
 * source, its version and digest, the provision compared and when it is checked next. */
export default function RuleReviewEditor({ roster, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  return <RecordEditor<RuleReviewPayload, RecordSaved>
    noun="規則の適用確認" contentTitle="確認した内容と根拠を入力する"
    records={roster.ruleReviews.map((item) => ({ ...item, label: reviewLabel(item.payload) }))}
    create={() => ({ review_id: crypto.randomUUID(), rule_id: roster.ruleRevision, source_url: "", document_version: "", source_sha256: "", provision: "", transitional_provision: "", reviewed_on: "", next_review_on: "", start: "", end: "", evidence: { ...EMPTY_RECORD_EVIDENCE } })}
    facts={ruleReviewFacts}
    fields={({ value, onChange }) => {
      const revisions = Array.from(new Set([roster.ruleRevision, ...roster.ruleReviews.map((item) => item.payload.rule_id), value.rule_id].filter(Boolean)));
      return <>
        <PeriodFields start={value.start} end={value.end} onChange={onChange} />
        <SelectField label="適用を確認する規則版" value={value.rule_id} options={revisions.map((revision) => ({ value: revision, label: revision }))} onChange={(rule_id) => onChange({ rule_id })} />
        <TextField label="一次資料のURL" value={value.source_url} onChange={(source_url) => onChange({ source_url })} />
        <TextField label="資料の版（改正日など）" value={value.document_version ?? ""} onChange={(document_version) => onChange({ document_version })} />
        <TextField label="取得した資料のSHA-256（16進64桁）" value={value.source_sha256 ?? ""} onChange={(source_sha256) => onChange({ source_sha256 })} />
        <TextField label="照合した条項" value={value.provision} onChange={(provision) => onChange({ provision })} />
        <TextField label="経過措置・非該当の理由" value={value.transitional_provision} onChange={(transitional_provision) => onChange({ transitional_provision })} />
        <DayField label="今回の確認日" value={value.reviewed_on} onChange={(reviewed_on) => onChange({ reviewed_on })} />
        <DayField label="次回の確認期限" value={value.next_review_on} onChange={(next_review_on) => onChange({ next_review_on })} />
        <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
        <p className="ideal-note">資料のハッシュを記録した確認には、影響を確かめた「改定規則の公開判断」が必要になります。確認日と次回の期限の前後は、サーバーが保存時に確かめます。</p>
      </>;
    }}
    slip={runsForward}
    mutation={(payload) => `record:rule_review:${payload.review_id}`}
    send={(body) => api.saveRuleReview(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.ruleReviews.find((item) => item.key === payload.review_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("適用確認")} saved={savedNotice("規則の適用確認")} {...opening} />;
}
