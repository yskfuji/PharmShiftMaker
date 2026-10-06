import { regimeLabel } from "@/lib/regimeLabels";
import { StatusPill } from "@/ideal/ui/atoms";
import { EVIDENCE_STATUS, type RecordEvidence } from "../../shared/records/evidence";
import {
  BASIS, DECISION, ENGAGEMENT, READING, TIME_CATEGORY, dayPeriodText, employerName, employmentLabel, personName, siteCell, siteLabel, versionText, type Roster,
} from "./model";
import RecordGroup, { type RecordKind } from "./RecordKinds";
import RecordTable, { OneLine, Period } from "./RecordTable";
import Identifiers from "../../shared/Identifiers";

/** The state of a record's evidence in words: the shared names of the server's three
 * states; a state they do not name reads 「未確認」, and no evidence at all 「資料なし」. */
export const evidenceText = (evidence: RecordEvidence | null | undefined) => (evidence ? EVIDENCE_STATUS[evidence.status] ?? "未確認" : "資料なし");
const EVIDENCE_TONE: Record<string, "good" | "warn" | "danger"> = { verified: "good", unverified: "warn", rejected: "danger" };
/** The same state as a pill, as every other route shows it: the tone is a fixed map of the
 * server's value (confirmed is quiet, not confirmed stands out), never a verdict made here. */
export const evidenceState = (evidence: RecordEvidence | null | undefined, key = "evidence") =>
  <StatusPill key={key} tone={evidence ? EVIDENCE_TONE[evidence.status] ?? "warn" : "neutral"}>{evidenceText(evidence)}</StatusPill>;

/** Every contract of the scope with its period, its regime and the state of each of its
 * two pieces of evidence, as registered. Nothing is combined into a verdict here. */
export function ContractOverview({ roster }: { roster: Roster }) {
  return <RecordTable label="この部署の契約の一覧" empty="登録されている契約はありません。"
    columns={["職員", "雇用", "勤務区分", "制度", "適用期間（日本時間）", "原本確認", "制度の根拠", "版"]}
    rows={roster.contracts.map((item) => ({ key: item.key, cells: [
      personName(roster, item.payload.person_id), ENGAGEMENT[item.payload.engagement] ?? "未登録の区分", TIME_CATEGORY[item.payload.time_category] ?? "未登録の区分", regimeLabel(item.payload.regime),
      <Period key="period" start={item.payload.start} end={item.payload.end} />, evidenceState(item.payload.evidence), evidenceState(item.payload.regime_evidence, "regime"), versionText(item.revision),
    ] }))} />;
}

/** The records of the facility: employers, their sites and the management models of side
 * work. How many there are of each, and one reveal with their tables and identifiers. */
export function FacilityRecords({ roster }: { roster: Roster }) {
  const kinds: RecordKind[] = [
    { title: "雇用主", label: "登録されている雇用主", empty: "名称を登録した雇用主はありません。", columns: ["雇用主の正式名称", "原本確認", "版"],
      rows: roster.employers.map((item) => ({ key: item.key, cells: [item.payload.name || "名称未登録の雇用主", evidenceState(item.payload.evidence), versionText(item.revision)] })) },
    { title: "事業場", label: "登録されている事業場", empty: "登録されている事業場はありません。", columns: ["雇用主", "適用期間（日本時間）", "原本確認", "版"],
      rows: roster.establishments.map((item) => ({ key: item.key, cells: [employerName(roster, item.payload.employer_id), <Period key="period" start={item.payload.start} end={item.payload.end} />, evidenceState(item.payload.evidence), versionText(item.revision)] })) },
    { title: "兼業の管理モデル", label: "登録されている兼業の管理モデル", empty: "登録されている兼業の管理モデルはありません。", columns: ["職員", "先契約・後契約の雇用主", "適用期間（日本時間）", "合意・通知の確認", "版"],
      rows: roster.managementModels.map((item) => ({ key: item.key, cells: [
        personName(roster, item.payload.person_id), `${employerName(roster, item.payload.first_employer)}・${employerName(roster, item.payload.second_employer)}`, <Period key="period" start={item.payload.start} end={item.payload.end} />,
        <span key="consents" className="ideal-v3-contracts-marks"><span>先 {evidenceState(item.payload.first_consent)}</span><span className="sr-only">／</span><span>後 {evidenceState(item.payload.second_consent)}</span><span className="sr-only">／</span><span>通知 {evidenceState(item.payload.notification)}</span></span>, versionText(item.revision),
      ] })) },
  ];
  return <RecordGroup name="施設の記録" kinds={kinds}>
    <Identifiers summary="雇用主・事業場の識別情報" items={[
      ...roster.employerIds.map((id) => ({ key: `employer:${id}`, label: `雇用主（${employerName(roster, id)}）`, value: id })),
      ...roster.establishments.map((item) => ({ key: `site:${item.key}`, label: `事業場（${siteLabel(roster, item.payload)}）`, value: item.key })),
    ]} />
  </RecordGroup>;
}

/** The records of rules: agreements, rule reviews and decisions, and the decisions on how
 * time is counted. How many there are of each, and one reveal with their tables. */
export function RuleRecords({ roster }: { roster: Roster }) {
  const revision = (id: string) => { const found = roster.employments.find((item) => item.key === id)?.payload; return found ? employmentLabel(roster, found) : "未登録の雇用条件"; };
  const kinds: RecordKind[] = [
    { title: "36協定", label: "登録されている36協定", empty: "登録されている36協定はありません。", columns: ["事業場", "適用期間（日本時間）", "特別条項", "原本確認", "版"],
      rows: roster.agreements.map((item) => ({ key: item.key, cells: [
        item.payload.establishment_id ? siteCell(roster, item.payload.establishment_id) : employerName(roster, item.payload.employer_id), <Period key="period" start={item.payload.start} end={item.payload.end} />,
        item.payload.special_clause ? "ある" : "ない", evidenceState(item.payload.evidence), versionText(item.revision),
      ] })) },
    { title: "規則の適用確認", label: "登録されている規則の適用確認", empty: "登録されている規則の適用確認はありません。", columns: ["規則版・条項", "適用期間（日本時間）", "確認日・次回の期限", "資料の照合値（ハッシュ）", "原本確認", "版"],
      rows: roster.ruleReviews.map((item) => ({ key: item.key, cells: [
        <span key="rule"><code>{item.payload.rule_id}</code> <span data-verbatim>{item.payload.provision}</span></span>, <Period key="period" start={item.payload.start} end={item.payload.end} />, <OneLine key="dates">{item.payload.reviewed_on}・{item.payload.next_review_on}</OneLine>,
        item.payload.source_sha256 ? "記録あり" : "記録なし", evidenceState(item.payload.evidence), versionText(item.revision),
      ] })) },
    { title: "改定規則の公開判断", label: "登録されている改定規則の公開判断", empty: "登録されている公開判断はありません。", columns: ["規則版", "判断", "結び付けた影響", "判断日", "原本確認", "版"],
      rows: roster.ruleDecisions.map((item) => ({ key: item.key, cells: [
        <code key="rule">{item.payload.rule_id}</code>, DECISION[item.payload.decision] ?? "未登録の判断", `${item.payload.impact_count}件`, item.payload.decided_on, evidenceState(item.payload.evidence), versionText(item.revision),
      ] })) },
    { title: "制度切替の集計条件", label: "登録されている制度切替の集計条件", empty: "登録されている制度切替の集計条件はありません。", columns: ["切替前の雇用条件", "切替後の雇用条件", "集計方法", "原本確認", "版"],
      rows: roster.accountingTransitions.map((item) => ({ key: item.key, cells: [
        revision(item.payload.before_revision_id), revision(item.payload.after_revision_id), BASIS[item.payload.calculation_basis] ?? "未登録の方法", evidenceState(item.payload.evidence), versionText(item.revision),
      ] })) },
    { title: "事業場間の時間外の帰属の判断", label: "登録されている事業場間の時間外の帰属の判断", empty: "登録されている帰属の判断はありません。", columns: ["雇用主", "数える順序", "適用期間（日本時間）", "原本確認", "版"],
      rows: roster.siteDecisions.map((item) => ({ key: item.key, cells: [
        employerName(roster, item.payload.employer_id), READING[item.payload.reading] ?? "未登録の順序", <Period key="period" start={item.payload.start} end={item.payload.end} />, evidenceState(item.payload.evidence), versionText(item.revision),
      ] })) },
    { title: "1年単位の変形労働時間制のカレンダー", label: "登録されている年間カレンダー", empty: "登録されている年間カレンダーはありません。", columns: ["事業場", "対象期間", "確定した労働日", "区分期間", "原本確認", "版"],
      rows: roster.annualCalendars.map((item) => ({ key: item.key, cells: [
        siteCell(roster, item.payload.establishment_id), <OneLine key="dates">{dayPeriodText(item.payload.start, item.payload.end)}</OneLine>, `${item.payload.days?.length ?? 0}日`, `${item.payload.segments?.length ?? 0}件`,
        evidenceState(item.payload.evidence), versionText(item.revision),
      ] })) },
  ];
  return <RecordGroup name="規則・協定・判断" kinds={kinds} />;
}
