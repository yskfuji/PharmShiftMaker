"use client";

import { useRef, useState } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import RecordEvidenceFields from "../../../shared/RecordEvidenceFields";
import { EMPTY_RECORD_EVIDENCE } from "../../../shared/records/evidence";
import { DayField, SelectField } from "../../../shared/records/fields";
import { RECORD_SAVE_NOTICE, recordRisk } from "../../../shared/records/notices";
import RecordEditor from "../../../shared/records/RecordEditor";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { peopleApi, type RecordSaved, type RuleDecisionPayload, type RuleImpact } from "../../api";
import { ruleDecisionFacts } from "../facts";
import { DECISION, reviewLabel } from "../model";
import ImpactList from "./ImpactList";
import { OneOfField, currentRecord, savedNotice, type EditorProps } from "./parts";

/**
 * Records whether a revised rule is published or held, after what the earlier revision
 * decided was looked at. The decision is bound to the server's impact list: the list is
 * read for the chosen review, read again when the save is confirmed, shown there, and its
 * size and check value are saved with the decision. The server refuses a decision whose
 * list has changed since.
 */
export default function RuleDecisionEditor({ roster, opening }: EditorProps) {
  const live = useLive();
  const api = peopleApi(live.client);
  const [impact, setImpact] = useState<RuleImpact | null>(null);
  const [problem, setProblem] = useState<ProblemModel | null>(null);
  const [reading, setReading] = useState(false);
  // The review whose list was asked for last: a slower answer for another one is dropped.
  const asked = useRef("");
  async function read(reviewId: string) {
    asked.current = reviewId;
    setImpact(null); setProblem(null);
    if (!reviewId) return;
    setReading(true);
    try {
      const answer = await api.ruleImpact(live.scopeId, reviewId);
      if (asked.current === reviewId) setImpact(answer);
    } catch (error) {
      if (asked.current === reviewId) setProblem(problemFrom(error, "read"));
    } finally {
      if (asked.current === reviewId) setReading(false);
    }
  }
  const reviews = roster.ruleReviews.filter((item) => item.payload.source_sha256);
  return <RecordEditor<RuleDecisionPayload, RecordSaved>
    noun="改定規則の公開判断" contentTitle="判断の内容と根拠を入力する"
    records={roster.ruleDecisions.map((item) => ({ ...item, label: `${item.payload.rule_id} ${DECISION[item.payload.decision] ?? "判断"}（影響 ${item.payload.impact_count}件・判断日 ${item.payload.decided_on}）` }))}
    create={() => ({ decision_id: crypto.randomUUID(), review_id: "", rule_id: "", source_sha256: "", decision: "hold", impact_hash: "", impact_count: 0, decided_on: "", evidence: { ...EMPTY_RECORD_EVIDENCE } })}
    facts={(payload) => ruleDecisionFacts(roster, payload)}
    fields={({ value, onChange }) => <>
      <SelectField label="判断する制度確認（資料のハッシュ付き）" value={value.review_id} options={reviews.map((item) => ({ value: item.key, label: reviewLabel(item.payload) }))}
        onChange={(review_id) => { onChange({ review_id, rule_id: "", source_sha256: "", impact_hash: "", impact_count: 0 }); void read(review_id); }} />
      {reviews.length === 0 && <p className="ideal-note">資料のハッシュを記録した「規則の適用確認」がありません。先にそれを登録してください。</p>}
      {impact && impact.review_id === value.review_id ? <ImpactList impact={impact} />
        : problem ? <InlineProblem problem={problem} />
          : value.review_id && <p className="ideal-note" role="status">{reading ? "サーバーから影響の一覧を読み込んでいます。" : "保存内容を確認するときに、サーバーの現在の影響の一覧を読み込みます。"}</p>}
      {value.review_id && <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" disabled={reading} onClick={() => void read(value.review_id)}>影響の一覧を読み直す</button></div>}
      <OneOfField label="判断" value={value.decision} options={(Object.entries(DECISION) as Array<[RuleDecisionPayload["decision"], string]>).map(([key, label]) => ({ value: key, label }))} onChange={(decision) => onChange({ decision })} />
      <DayField label="判断日" value={value.decided_on} onChange={(decided_on) => onChange({ decided_on })} />
      <RecordEvidenceFields value={value.evidence} onChange={(patch) => onChange({ evidence: { ...value.evidence, ...patch } })} />
      <p className="ideal-note">判断は、サーバーが返した影響の一覧に結び付けて保存します。一覧が変わると、サーバーは保存も公開も止めます。判断日が確認日と合うかどうかも、サーバーが確かめます。</p>
    </>}
    // The list the decision is bound to is the one the server returns now.
    prepare={async (payload) => {
      const answer = await api.ruleImpact(live.scopeId, payload.review_id);
      asked.current = payload.review_id;
      setImpact(answer); setProblem(null); setReading(false);
      return { ...payload, rule_id: answer.rule_id, source_sha256: answer.source_sha256, impact_hash: answer.impact_hash, impact_count: answer.impact_count };
    }}
    confirmation={(payload) => impact && impact.review_id === payload.review_id && <ImpactList impact={impact} bound />}
    mutation={(payload) => `record:rule_decision:${payload.decision_id}`}
    send={(body) => api.saveRuleDecision(live.scopeId, body)}
    readCurrent={currentRecord(live.client, live.scopeId, (fresh, payload) => fresh.ruleDecisions.find((item) => item.key === payload.decision_id))}
    notified={RECORD_SAVE_NOTICE} risk={recordRisk("公開判断")} saved={savedNotice("改定規則の公開判断")} {...opening} />;
}
