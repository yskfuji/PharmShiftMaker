// Each record kind as the lines a person reads: the confirmation of a save and the review
// of a conflict compare these lines, so every field a form can change has one.
import { regimeLabel, workingTimeSystemLabel } from "@/lib/regimeLabels";
import { jstText } from "../../shared/jst";
import { EVIDENCE_STATUS, evidenceFacts } from "../../shared/records/evidence";
import type { Fact } from "../../shared/records/facts";
import type {
  AccountingTransitionPayload, AgreementPayload, AnnualCalendarPayload, CapabilityAmendmentPayload, CapabilityPayload, ContractPayload, EmployerPayload,
  EmploymentPayload, EstablishmentPayload, ManagementModelPayload, PersonPayload, RuleDecisionPayload, RuleReviewPayload, SiteAttributionDecisionPayload,
} from "../api";
import {
  ACTIVITY, BASIS, DECISION, ENGAGEMENT, HOLIDAY_SYSTEM, METHOD, NONE, READING, TIME_CATEGORY, WEEKDAYS, agreementLabel, calendarLabel, capabilityLabel,
  dayPeriodText, daysByMonth, durationText, employerName, employmentLabel, personName, reviewLabel, siteName, type Roster,
} from "./model";

const text = (value: unknown) => (typeof value === "string" && value ? value : NONE);
const instant = (value: unknown) => jstText(value) || NONE;
const person = (roster: Roster, personId: string) => (personId ? personName(roster, personId) : NONE);
const employer = (roster: Roster, employerId: string) => (employerId ? employerName(roster, employerId) : NONE);
const weekdays = (days: number[] | undefined) => (days?.length ? days.map((day) => WEEKDAYS[day] ?? "不明").join("・") : NONE);
const period = (start: string, end: string): Fact[] => [{ label: "適用開始（日本時間）", text: instant(start) }, { label: "適用終了（日本時間）", text: instant(end) }];

export const personFacts = (item: PersonPayload): Fact[] => [{ label: "職員の氏名", text: text(item.name), verbatim: true }];

export const employerFacts = (item: EmployerPayload): Fact[] => [{ label: "雇用主の正式名称", text: text(item.name), verbatim: true }, ...evidenceFacts("原本確認", item.evidence)];

export const establishmentFacts = (roster: Roster, item: EstablishmentPayload): Fact[] => [
  { label: "事業場の雇用主", text: employer(roster, item.employer_id) },
  ...period(item.start, item.end),
  ...evidenceFacts("原本確認", item.evidence),
];

export const managementModelFacts = (roster: Roster, item: ManagementModelPayload): Fact[] => [
  { label: "対象職員", text: person(roster, item.person_id) },
  { label: "先契約の雇用主", text: employer(roster, item.first_employer) },
  { label: "後契約の雇用主", text: employer(roster, item.second_employer) },
  ...period(item.start, item.end),
  { label: "管理モデルの月起算日", text: text(item.month_anchor) },
  { label: "先契約側の法定外時間上限", text: durationText(item.first_month_limit_seconds) },
  { label: "後契約側の総労働時間上限", text: durationText(item.second_month_limit_seconds) },
  ...evidenceFacts("先契約の雇用主の合意", item.first_consent),
  ...evidenceFacts("後契約の雇用主の合意", item.second_consent),
  ...evidenceFacts("通知の確認", item.notification),
];

/** The employment relationship a revision belongs to, said by its employer and first start. */
export function relationshipText(roster: Roster, relationshipId: string, exceptRevision?: string): string {
  const revisions = roster.employments.map((entry) => entry.payload).filter((entry) => entry.relationship_id === relationshipId && entry.revision_id !== exceptRevision);
  if (!revisions.length) return "新しい雇用関係";
  const first = revisions.reduce((a, b) => (Date.parse(a.start) <= Date.parse(b.start) ? a : b));
  return `${employerName(roster, first.employer_id)}との雇用関係（${jstText(first.start) || "開始未入力"}から）`;
}

export function employmentFacts(roster: Roster, item: EmploymentPayload): Fact[] {
  const system = item.working_time_system ?? "standard";
  const calendar = roster.annualCalendars.find((entry) => entry.key === item.annual_calendar_id)?.payload;
  const agreement = roster.agreements.find((entry) => entry.key === item.agreement_id)?.payload;
  return [
    { label: "対象職員", text: person(roster, item.person_id) },
    { label: "雇用関係の履歴", text: relationshipText(roster, item.relationship_id, item.revision_id) },
    { label: "雇用先の事業場", text: item.establishment_id ? siteName(roster, item.establishment_id) : NONE },
    ...period(item.start, item.end),
    { label: "契約締結順", text: item.contract_order === null ? "未確認" : `${item.contract_order}番目` },
    { label: "活動の区分", text: ACTIVITY[item.activity] ?? item.activity },
    { label: "時間管理方式", text: METHOD[item.method] ?? item.method },
    { label: "週の起算曜日", text: `${WEEKDAYS[item.week_start] ?? "不明"}曜日` },
    { label: "法定休日の日付", text: daysByMonth(item.statutory_holidays ?? []) },
    { label: "週起算と法定休日の原本照合", text: item.calendar_confirmed ? "照合した" : "照合していない" },
    { label: "法定休日の与え方", text: HOLIDAY_SYSTEM[item.holiday_system ?? "weekly"] },
    { label: "変形休日制の起算日", text: text(item.four_week_start) },
    { label: "労働時間制度", text: workingTimeSystemLabel(system) },
    { label: "変形期間の起算日", text: text(item.variable_anchor) },
    { label: "変形期間の日数", text: item.variable_period_days == null ? NONE : `${item.variable_period_days}日` },
    { label: "適用するカレンダー", text: calendar ? calendarLabel(roster, calendar) : NONE },
    { label: "清算期間の起算日", text: text(item.flex_anchor) },
    { label: "清算期間の長さ", text: item.flex_months == null ? NONE : `${item.flex_months}か月` },
    { label: "完全週休2日制の特例", text: item.flex_full_two_day_weekend ? "適用する" : "適用しない" },
    { label: "毎週の所定休日", text: weekdays(item.flex_rest_weekdays) },
    { label: "その他の所定休日", text: daysByMonth(item.flex_other_rest_days ?? []) },
    { label: "雇用関係に適用する協定", text: agreement ? agreementLabel(roster, agreement) : NONE },
    ...evidenceFacts("兼業申告の確認", item.declaration),
    ...evidenceFacts("変形労働時間制の根拠（就業規則・労使協定）", item.variable_evidence),
  ];
}

export function contractFacts(roster: Roster, item: ContractPayload): Fact[] {
  const agreement = roster.agreements.find((entry) => entry.key === item.overtime_agreement_id)?.payload;
  return [
    { label: "対象職員", text: person(roster, item.person_id) },
    { label: "適用する雇用関係", text: item.relationship_id ? relationshipText(roster, item.relationship_id) : NONE },
    { label: "契約の雇用主", text: employer(roster, item.employer_id) },
    ...period(item.start, item.end),
    { label: "雇用形態", text: ENGAGEMENT[item.engagement] ?? item.engagement },
    { label: "有期契約", text: item.fixed_term ? "有期" : "無期" },
    { label: "勤務時間区分", text: TIME_CATEGORY[item.time_category] ?? item.time_category },
    { label: "労働時間制度", text: regimeLabel(item.regime) },
    { label: "勤務できる曜日", text: weekdays(item.allowed_weekdays) },
    { label: "勤務できる種類", text: item.allowed_kinds?.length ? item.allowed_kinds.join("・") : NONE, verbatim: true },
    { label: "対象期間の契約下限", text: durationText(item.period_min_seconds) },
    { label: "対象期間の契約上限", text: durationText(item.period_max_seconds) },
    { label: "週の所定労働時間", text: durationText(item.contractual_week_seconds) },
    { label: "勤務間休息時間", text: durationText(item.rest_seconds) },
    { label: "最大連続勤務日数", text: `${item.max_consecutive_days}日` },
    { label: "兼業の有無と勤務情報", text: item.external_work_confirmed ? "確認した" : "確認していない" },
    { label: "適用する協定", text: agreement ? agreementLabel(roster, agreement) : item.overtime_agreement_id ? "現在の契約に指定された協定" : NONE },
    { label: "派遣を認める業務", text: item.dispatch_tasks?.length ? item.dispatch_tasks.join("・") : NONE, verbatim: true },
    ...evidenceFacts("原本確認", item.evidence),
    ...evidenceFacts("労働時間制度の確認", item.regime_evidence),
    ...evidenceFacts("派遣の適用根拠", item.dispatch_evidence),
  ];
}

export const capabilityFacts = (roster: Roster, item: CapabilityPayload): Fact[] => [
  { label: "対象職員", text: person(roster, item.person_id) },
  { label: "担当業務", text: text(item.task), verbatim: true },
  { label: "勤務場所", text: text(item.location), verbatim: true },
  ...period(item.start, item.end),
  { label: "監督者の配置", text: item.supervision_required ? "必要" : "不要" },
  { label: "同時に監督できる人数", text: `${item.supervisor_capacity}名` },
  ...evidenceFacts("原本確認", item.evidence),
];

export function capabilityAmendmentFacts(roster: Roster, item: CapabilityAmendmentPayload): Fact[] {
  const target = roster.capabilityTargets.find((entry) => entry.key === item.target_hash)?.payload;
  return [
    { label: "取消・失効の対象資格", text: target ? capabilityLabel(roster, target) : NONE },
    { label: "資格を使用できなくなる日時（日本時間）", text: instant(item.effective_at) },
    { label: "資格の取消・失効理由", text: text(item.reason), verbatim: true },
    ...evidenceFacts("原本確認", item.evidence),
  ];
}

export const agreementFacts = (roster: Roster, item: AgreementPayload): Fact[] => [
  { label: "協定を適用する事業場", text: item.establishment_id ? siteName(roster, item.establishment_id) : employer(roster, item.employer_id) },
  ...period(item.start, item.end),
  { label: "協定年の起算日", text: text(item.year_start) },
  { label: "協定月の起算日", text: text(item.month_anchor) },
  { label: "協定の日時間外上限", text: durationText(item.daily_limit_seconds) },
  { label: "協定の月時間外上限", text: durationText(item.monthly_limit_seconds) },
  { label: "協定の年時間外上限", text: durationText(item.annual_limit_seconds) },
  { label: "特別条項の定め", text: item.special_clause ? "ある" : "ない" },
  { label: "休日労働を認める定め", text: item.holiday_work_permitted ? "ある" : "ない" },
  ...evidenceFacts("原本確認", item.evidence),
  ...evidenceFacts("特別条項の適用根拠", item.invocation_evidence),
];

export const ruleReviewFacts = (item: RuleReviewPayload): Fact[] => [
  // An identifier chosen from the revisions the server names (roster.ruleRevision): nobody typed it.
  { label: "適用を確認する規則版", text: text(item.rule_id) },
  ...period(item.start, item.end),
  { label: "一次資料のURL", text: text(item.source_url), verbatim: true },
  { label: "資料の版（改正日など）", text: text(item.document_version), verbatim: true },
  { label: "取得した資料のSHA-256", text: text(item.source_sha256), verbatim: true },
  { label: "照合した条項", text: text(item.provision), verbatim: true },
  { label: "経過措置・非該当の理由", text: text(item.transitional_provision), verbatim: true },
  { label: "今回の確認日", text: text(item.reviewed_on) },
  { label: "次回の確認期限", text: text(item.next_review_on) },
  ...evidenceFacts("原本確認", item.evidence),
];

export function ruleDecisionFacts(roster: Roster, item: RuleDecisionPayload): Fact[] {
  const review = roster.ruleReviews.find((entry) => entry.key === item.review_id)?.payload;
  return [
    { label: "判断する制度確認", text: review ? reviewLabel(review) : NONE },
    { label: "判断", text: DECISION[item.decision] ?? item.decision },
    // The decision is bound to the list the server returned: its size and its check value.
    { label: "判断に結び付ける影響の一覧", text: item.impact_hash ? `${item.impact_count}件（照合値 ${item.impact_hash.slice(0, 12)}…）` : "未取得" },
    { label: "判断日", text: text(item.decided_on) },
    ...evidenceFacts("原本確認", item.evidence),
  ];
}

export function accountingTransitionFacts(roster: Roster, item: AccountingTransitionPayload): Fact[] {
  const revision = (id: string) => { const found = roster.employments.find((entry) => entry.key === id)?.payload; return found ? employmentLabel(roster, found) : NONE; };
  return [
    { label: "切替前の雇用条件", text: revision(item.before_revision_id) },
    { label: "切替後の雇用条件", text: revision(item.after_revision_id) },
    { label: "確認した集計方法", text: BASIS[item.calculation_basis] ?? item.calculation_basis },
    ...evidenceFacts("原本確認", item.evidence),
  ];
}

export const siteDecisionFacts = (roster: Roster, item: SiteAttributionDecisionPayload): Fact[] => [
  { label: "判断の対象とする雇用主", text: employer(roster, item.employer_id) },
  ...period(item.start, item.end),
  { label: "時間外を帰属させる順序", text: READING[item.reading] ?? item.reading },
  { label: "判断の理由と根拠", text: text(item.reason), verbatim: true },
  ...evidenceFacts("原本確認", item.evidence),
];

export const annualCalendarFacts = (roster: Roster, item: AnnualCalendarPayload): Fact[] => [
  { label: "カレンダーを適用する事業場", text: item.establishment_id ? siteName(roster, item.establishment_id) : NONE },
  { label: "対象期間の初日", text: text(item.start) },
  { label: "対象期間の終了日（この日を含まない）", text: text(item.end) },
  { label: "最初の期間の終了日（この日を含まない）", text: text(item.first_period_end) },
  { label: "週の起算曜日", text: item.week_start === null ? NONE : `${WEEKDAYS[item.week_start] ?? "不明"}曜日` },
  { label: "確定した労働日と所定時間", text: item.days?.length ? item.days.map((day) => `${day.day} ${durationText(day.seconds)}`).join(" ／ ") : NONE },
  // A removed segment has no line of its own left: the number of segments says it.
  { label: "区分期間の数", text: `${item.segments?.length ?? 0}件` },
  ...(item.segments ?? []).flatMap((segment, index): Fact[] => [
    { label: `区分期間${index + 1}`, text: `${dayPeriodText(segment.start, segment.end)}・労働日数 ${segment.working_days}日・総労働時間 ${durationText(segment.total_seconds)}・確定日 ${segment.fixed_on ?? "未確定"}` },
    { label: `区分期間${index + 1}の同意`, text: segment.consent
      ? `${EVIDENCE_STATUS[segment.consent.status] ?? segment.consent.status}・資料 ${segment.consent.reference || NONE}・確認責任者 ${segment.consent.verified_by || NONE}・有効期限 ${jstText(segment.consent.valid_until) || "期限なし"}`
      : "同意の資料なし", verbatim: true },
  ]),
  { label: "特定期間", text: item.special_periods?.length ? item.special_periods.map((range) => dayPeriodText(range.start, range.end)).join(" ／ ") : NONE },
  ...evidenceFacts("原本確認", item.evidence),
];
