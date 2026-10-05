import { regimeLabel } from "@/lib/regimeLabels";
import { EVIDENCE_STATUS, type RecordEvidence } from "../../shared/records/evidence";
import {
  BASIS, DECISION, ENGAGEMENT, READING, TIME_CATEGORY, dayPeriodText, employerName, employmentLabel, periodText, personName, siteLabel, siteName, versionText, type Roster,
} from "./model";
import RecordTable from "./RecordTable";

export const evidenceState = (evidence: RecordEvidence | null | undefined) => (evidence ? EVIDENCE_STATUS[evidence.status] ?? "未確認" : "資料なし");

/** Every contract of the scope with its period, its regime and the state of each of its
 * two pieces of evidence, as registered. Nothing is combined into a verdict here. */
export function ContractOverview({ roster }: { roster: Roster }) {
  return <RecordTable label="この部署の契約の一覧" empty="登録されている契約はありません。"
    columns={["職員", "雇用", "勤務区分", "制度", "適用期間（日本時間）", "原本確認", "制度の根拠", "版"]}
    rows={roster.contracts.map((item) => ({ key: item.key, cells: [
      personName(roster, item.payload.person_id), ENGAGEMENT[item.payload.engagement] ?? "未登録の区分", TIME_CATEGORY[item.payload.time_category] ?? "未登録の区分", regimeLabel(item.payload.regime),
      periodText(item.payload.start, item.payload.end), evidenceState(item.payload.evidence), evidenceState(item.payload.regime_evidence), versionText(item.revision),
    ] }))} />;
}

/** The records of the facility: employers, their sites and the management models of side work. */
export function FacilityRecords({ roster }: { roster: Roster }) {
  return <>
    <h4 className="ideal-v3-heading">雇用主</h4>
    <RecordTable label="登録されている雇用主" empty="名称を登録した雇用主はありません。" columns={["雇用主の正式名称", "原本確認", "版"]}
      rows={roster.employers.map((item) => ({ key: item.key, cells: [item.payload.name || "名称未登録の雇用主", evidenceState(item.payload.evidence), versionText(item.revision)] }))} />
    <h4 className="ideal-v3-heading">事業場</h4>
    <RecordTable label="登録されている事業場" empty="登録されている事業場はありません。" columns={["雇用主", "適用期間（日本時間）", "原本確認", "版"]}
      rows={roster.establishments.map((item) => ({ key: item.key, cells: [employerName(roster, item.payload.employer_id), periodText(item.payload.start, item.payload.end), evidenceState(item.payload.evidence), versionText(item.revision)] }))} />
    <h4 className="ideal-v3-heading">兼業の管理モデル</h4>
    <RecordTable label="登録されている兼業の管理モデル" empty="登録されている兼業の管理モデルはありません。" columns={["職員", "先契約・後契約の雇用主", "適用期間（日本時間）", "合意・通知の確認", "版"]}
      rows={roster.managementModels.map((item) => ({ key: item.key, cells: [
        personName(roster, item.payload.person_id), `${employerName(roster, item.payload.first_employer)}・${employerName(roster, item.payload.second_employer)}`, periodText(item.payload.start, item.payload.end),
        `先 ${evidenceState(item.payload.first_consent)}／後 ${evidenceState(item.payload.second_consent)}／通知 ${evidenceState(item.payload.notification)}`, versionText(item.revision),
      ] }))} />
    {(roster.employerIds.length > 0 || roster.establishments.length > 0) && <details className="ideal-v3-disclosure">
      <summary>雇用主・事業場の識別情報</summary>
      <ul className="ideal-note-list">
        {roster.employerIds.map((id) => <li key={`employer:${id}`}>雇用主（{employerName(roster, id)}）：{id}</li>)}
        {roster.establishments.map((item) => <li key={`site:${item.key}`}>事業場（{siteLabel(roster, item.payload)}）：{item.key}</li>)}
      </ul>
    </details>}
  </>;
}

/** The records of rules: agreements, rule reviews and decisions, and the decisions on how
 * time is counted. */
export function RuleRecords({ roster }: { roster: Roster }) {
  const revision = (id: string) => { const found = roster.employments.find((item) => item.key === id)?.payload; return found ? employmentLabel(roster, found) : "未登録の雇用条件"; };
  return <>
    <h4 className="ideal-v3-heading">36協定</h4>
    <RecordTable label="登録されている36協定" empty="登録されている36協定はありません。" columns={["事業場", "適用期間（日本時間）", "特別条項", "原本確認", "版"]}
      rows={roster.agreements.map((item) => ({ key: item.key, cells: [
        item.payload.establishment_id ? siteName(roster, item.payload.establishment_id) : employerName(roster, item.payload.employer_id), periodText(item.payload.start, item.payload.end),
        item.payload.special_clause ? "ある" : "ない", evidenceState(item.payload.evidence), versionText(item.revision),
      ] }))} />
    <h4 className="ideal-v3-heading">規則の適用確認</h4>
    <RecordTable label="登録されている規則の適用確認" empty="登録されている規則の適用確認はありません。" columns={["規則版・条項", "適用期間（日本時間）", "確認日・次回の期限", "資料のハッシュ", "原本確認", "版"]}
      rows={roster.ruleReviews.map((item) => ({ key: item.key, cells: [
        `${item.payload.rule_id} ${item.payload.provision}`, periodText(item.payload.start, item.payload.end), `${item.payload.reviewed_on}・${item.payload.next_review_on}`,
        item.payload.source_sha256 ? "記録あり" : "記録なし", evidenceState(item.payload.evidence), versionText(item.revision),
      ] }))} />
    <h4 className="ideal-v3-heading">改定規則の公開判断</h4>
    <RecordTable label="登録されている改定規則の公開判断" empty="登録されている公開判断はありません。" columns={["規則版", "判断", "結び付けた影響", "判断日", "原本確認", "版"]}
      rows={roster.ruleDecisions.map((item) => ({ key: item.key, cells: [
        item.payload.rule_id, DECISION[item.payload.decision] ?? "未登録の判断", `${item.payload.impact_count}件`, item.payload.decided_on, evidenceState(item.payload.evidence), versionText(item.revision),
      ] }))} />
    <h4 className="ideal-v3-heading">制度切替の集計条件</h4>
    <RecordTable label="登録されている制度切替の集計条件" empty="登録されている制度切替の集計条件はありません。" columns={["切替前の雇用条件", "切替後の雇用条件", "集計方法", "原本確認", "版"]}
      rows={roster.accountingTransitions.map((item) => ({ key: item.key, cells: [
        revision(item.payload.before_revision_id), revision(item.payload.after_revision_id), BASIS[item.payload.calculation_basis] ?? "未登録の方法", evidenceState(item.payload.evidence), versionText(item.revision),
      ] }))} />
    <h4 className="ideal-v3-heading">事業場間の時間外の帰属の判断</h4>
    <RecordTable label="登録されている事業場間の時間外の帰属の判断" empty="登録されている帰属の判断はありません。" columns={["雇用主", "数える順序", "適用期間（日本時間）", "原本確認", "版"]}
      rows={roster.siteDecisions.map((item) => ({ key: item.key, cells: [
        employerName(roster, item.payload.employer_id), READING[item.payload.reading] ?? "未登録の順序", periodText(item.payload.start, item.payload.end), evidenceState(item.payload.evidence), versionText(item.revision),
      ] }))} />
    <h4 className="ideal-v3-heading">1年単位の変形労働時間制のカレンダー</h4>
    <RecordTable label="登録されている年間カレンダー" empty="登録されている年間カレンダーはありません。" columns={["事業場", "対象期間", "確定した労働日", "区分期間", "原本確認", "版"]}
      rows={roster.annualCalendars.map((item) => ({ key: item.key, cells: [
        siteName(roster, item.payload.establishment_id), dayPeriodText(item.payload.start, item.payload.end), `${item.payload.days?.length ?? 0}日`, `${item.payload.segments?.length ?? 0}件`,
        evidenceState(item.payload.evidence), versionText(item.revision),
      ] }))} />
  </>;
}
