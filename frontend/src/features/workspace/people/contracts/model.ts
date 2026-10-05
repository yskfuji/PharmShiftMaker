// The records of staff, facility and rules as the contracts route lists and chooses them.
// Display and entry only: whether a record is lawful, whether a person is qualified and
// whether staffing is covered are the server's (its staging issues are passed through as
// it reports them).
import { jstText } from "../../shared/jst";
import { stagedRecords, type StoredRow, type Versioned } from "../../shared/records/staged";
import type {
  AccountingTransitionPayload, AgreementPayload, AnnualCalendarPayload, CapabilityAmendmentPayload, CapabilityPayload, ContractPayload, EmployerPayload,
  EmploymentPayload, EstablishmentPayload, ManagementModelPayload, PersonPayload, RosterContext, RuleDecisionPayload, RuleReviewPayload, SiteAttributionDecisionPayload,
} from "../api";

export type Duty = { kind: string; task: string; location: string };
/** Only what the route shows of the workflow context, as plain data (it crosses from the
 * server read to the client islands). */
export type Roster = {
  staging: { valid: boolean; issues: Array<{ location: string; message: string }> };
  /** The rule revision the latest input version was made under. */
  ruleRevision: string;
  duties: Duty[];
  people: Versioned<PersonPayload>[];
  employments: Versioned<EmploymentPayload>[];
  contracts: Versioned<ContractPayload>[];
  capabilities: Versioned<CapabilityPayload>[];
  /** The saved qualifications a withdrawal or an expiry can name, by their content hash. */
  capabilityTargets: Versioned<CapabilityPayload>[];
  capabilityAmendments: Versioned<CapabilityAmendmentPayload>[];
  employers: Versioned<EmployerPayload>[];
  /** Every employer a record names, whether its name is registered or not. */
  employerIds: string[];
  establishments: Versioned<EstablishmentPayload>[];
  managementModels: Versioned<ManagementModelPayload>[];
  agreements: Versioned<AgreementPayload>[];
  ruleReviews: Versioned<RuleReviewPayload>[];
  ruleDecisions: Versioned<RuleDecisionPayload>[];
  accountingTransitions: Versioned<AccountingTransitionPayload>[];
  siteDecisions: Versioned<SiteAttributionDecisionPayload>[];
  annualCalendars: Versioned<AnnualCalendarPayload>[];
};

/** A value with the keys of its objects in one order. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered((value as Record<string, unknown>)[key])]));
  return value;
}
/** Two payloads hold the same content, whatever the order of their keys. */
export const sameContent = (a: unknown, b: unknown) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

/** A qualification has no identifier of its own: its saved record is found by its content.
 * A staged value without a saved record (a period shortened by a withdrawal, for example)
 * is listed with revision 0. */
function capabilityRecords(staged: CapabilityPayload[], rows: StoredRow[]): Versioned<CapabilityPayload>[] {
  const saved = rows.filter((row) => row.kind === "capability");
  const listed = staged.map((payload, index) => {
    const row = saved.find((item) => sameContent(item.payload, payload));
    return { key: row?.entity_id ?? `staged:${index}`, revision: row?.revision ?? 0, payload: (row?.payload ?? payload) as CapabilityPayload };
  });
  const others = saved.filter((row) => !listed.some((item) => item.key === row.entity_id)).map((row) => ({ key: row.entity_id, revision: row.revision, payload: row.payload as CapabilityPayload }));
  return [...listed, ...others];
}

export function rosterOf(context: RosterContext): Roster {
  const rows = context.records;
  const employers = stagedRecords(context.employers, rows, "employer", (item) => item.employer_id);
  const establishments = stagedRecords(context.establishments, rows, "establishment", (item) => item.establishment_id);
  const employments = stagedRecords(context.employments, rows, "employment", (item) => item.revision_id);
  const contracts = stagedRecords(context.contracts, rows, "contract", (item) => item.revision_id);
  const named = [...employers, ...contracts, ...employments, ...establishments].map((item) => item.payload.employer_id);
  return {
    staging: {
      valid: context.staging_valid !== false,
      issues: (context.validation_issues ?? []).map((issue) => ({ location: Array.isArray(issue.location) ? issue.location.join(" / ") : String(issue.location), message: issue.message })),
    },
    ruleRevision: context.rule_revision ?? "",
    duties: (context.duty_options ?? []).map(({ kind, task, location }) => ({ kind, task, location })),
    people: stagedRecords(context.people, rows, "person", (item) => item.person_id),
    employments,
    contracts,
    capabilities: capabilityRecords(context.capabilities ?? [], rows),
    capabilityTargets: (context.capability_targets ?? []).map((target) => ({ key: target.target_hash, revision: target.revision, payload: target.payload })),
    capabilityAmendments: stagedRecords(context.capability_amendments, rows, "capability_amendment", (item) => item.amendment_id),
    employers,
    employerIds: Array.from(new Set(named.filter((value): value is string => typeof value === "string" && value !== ""))),
    establishments,
    managementModels: stagedRecords(context.management_models, rows, "management_model", (item) => item.model_id),
    agreements: stagedRecords(context.agreements, rows, "agreement", (item) => item.agreement_id),
    ruleReviews: stagedRecords(context.rule_reviews, rows, "rule_review", (item) => item.review_id),
    ruleDecisions: stagedRecords(context.rule_decisions, rows, "rule_decision", (item) => item.decision_id),
    accountingTransitions: stagedRecords(context.accounting_transitions, rows, "accounting_transition", (item) => item.transition_id),
    siteDecisions: stagedRecords(context.site_attribution_decisions, rows, "site_attribution_decision", (item) => item.decision_id),
    annualCalendars: stagedRecords(context.annual_calendars, rows, "annual_calendar", (item) => item.calendar_id),
  };
}

// ── Names and labels ────────────────────────────────────────────────────────
export const NONE = "（なし）";
export const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
export const versionText = (revision: number) => (revision > 0 ? `第${revision}版` : "未登録（入力版の値）");
export const periodText = (start: unknown, end: unknown) => `${jstText(start) || "未入力"} 〜 ${jstText(end) || "未入力"}`;
export const dayPeriodText = (start: unknown, end: unknown) => `${typeof start === "string" && start ? start : "未入力"} 〜 ${typeof end === "string" && end ? end : "未入力"}`;

export const personName = (roster: Roster, personId: unknown) => roster.people.find((item) => item.key === personId)?.payload.name || "氏名未登録の職員";
/** An employer by its registered name. One whose name is not registered yet is told apart
 * from the other unnamed ones by its order among them. */
export function employerName(roster: Roster, employerId: unknown): string {
  const name = roster.employers.find((item) => item.key === employerId)?.payload.name;
  if (name) return name;
  const unnamed = roster.employerIds.filter((id) => !roster.employers.find((item) => item.key === id)?.payload.name);
  const place = unnamed.indexOf(String(employerId));
  return unnamed.length > 1 && place >= 0 ? `名称未登録の雇用主（${place + 1}）` : "名称未登録の雇用主";
}
export const employerOptions = (roster: Roster) => roster.employerIds.map((value) => ({ value, label: employerName(roster, value) }));
/** The employers a person has a contract or an employment with, as registered. */
export const employersOf = (roster: Roster, personId: string) =>
  Array.from(new Set([...roster.contracts, ...roster.employments].filter((item) => item.payload.person_id === personId).map((item) => item.payload.employer_id).filter(Boolean)))
    .map((value) => ({ value, label: employerName(roster, value) }));

export const siteLabel = (roster: Roster, site: EstablishmentPayload) => `${employerName(roster, site.employer_id)}の事業場（${periodText(site.start, site.end)}）`;
export const siteName = (roster: Roster, establishmentId: unknown) => {
  const site = roster.establishments.find((item) => item.key === establishmentId)?.payload;
  return site ? siteLabel(roster, site) : NONE;
};
export const employmentLabel = (roster: Roster, item: EmploymentPayload) => `${personName(roster, item.person_id)}・${employerName(roster, item.employer_id)} ${periodText(item.start, item.end)}`;
export const contractLabel = (roster: Roster, item: ContractPayload) => `${personName(roster, item.person_id)}・${employerName(roster, item.employer_id)} ${periodText(item.start, item.end)}`;
export const capabilityLabel = (roster: Roster, item: CapabilityPayload) => `${personName(roster, item.person_id)}・${item.task}（${item.location}） ${periodText(item.start, item.end)}`;
export const agreementLabel = (roster: Roster, item: AgreementPayload) => `${employerName(roster, item.employer_id)}の36協定 ${periodText(item.start, item.end)}`;
export const reviewLabel = (item: RuleReviewPayload) => `${item.rule_id} ${item.provision}（確認日 ${item.reviewed_on || "未入力"}${item.document_version ? `・資料 ${item.document_version}` : ""}）`;
export const calendarLabel = (roster: Roster, item: AnnualCalendarPayload) => `${employerName(roster, item.employer_id)} ${dayPeriodText(item.start, item.end)}`;

export const DECISION: Record<RuleDecisionPayload["decision"], string> = { hold: "公開を保留する", publish: "影響を確認したので公開する" };
export const READING: Record<SiteAttributionDecisionPayload["reading"], string> = { scheduled_first: "所定労働を先に数え、所定外をその後に数える", time_order: "事業場をまたいで働いた順に数える" };
export const BASIS: Record<AccountingTransitionPayload["calculation_basis"], string> = { effective_calendar_windows: "各制度の有効なカレンダー区間で集計", preserve_overlapping_full_weeks: "重複する完全な週の集計を維持" };
export const ENGAGEMENT: Record<ContractPayload["engagement"], string> = { direct: "直接雇用", agency: "派遣" };
export const TIME_CATEGORY: Record<ContractPayload["time_category"], string> = { full_time: "常勤", part_time: "短時間" };
export const ACTIVITY: Record<EmploymentPayload["activity"], string> = { employment: "雇用による労働", nonemployment: "非雇用の活動" };
export const METHOD: Record<EmploymentPayload["method"], string> = { standard: "原則方式", management: "確認済み2雇用主の管理モデル" };
export const HOLIDAY_SYSTEM: Record<NonNullable<EmploymentPayload["holiday_system"]>, string> = { weekly: "毎週1日（週休制）", four_week: "4週4日（変形休日制）" };

/** Seconds as the form takes them, with the hours and minutes they make. */
export function durationText(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return NONE;
  const rest = seconds % 60;
  return `${seconds}秒（${Math.floor(seconds / 3600)}時間${Math.floor((seconds % 3600) / 60)}分${rest ? `${rest}秒` : ""}）`;
}
/** Days in the order given, grouped by month: "2026-04：1・8・15 ／ 2026-05：6". */
export function daysByMonth(days: string[]): string {
  if (!days.length) return NONE;
  const months = new Map<string, string[]>();
  for (const day of days) {
    const month = day.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), day.length === 10 ? String(Number(day.slice(8))) : day || "未入力"]);
  }
  return Array.from(months, ([month, list]) => `${month || "未入力"}：${list.join("・")}`).join(" ／ ");
}

/** Records of the kinds that belong to one person, narrowed to the person chosen on the
 * route (none chosen: everyone's). */
export const ofPerson = <P extends { person_id: string }>(records: Versioned<P>[], personId: string) =>
  (personId ? records.filter((item) => item.payload.person_id === personId) : records);

export const personOptions = (roster: Roster) => roster.people.map((item) => ({ value: item.key, label: item.payload.name || "氏名未登録の職員" }));
export const WEEKDAY_OPTIONS = WEEKDAYS.map((day, index) => ({ value: index, label: `${day}曜日` }));
