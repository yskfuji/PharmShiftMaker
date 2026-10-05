// The registration of an adoption as it is entered and sent. The entry is checked here for
// presence and format only, and for the order of a period's two ends (which the server
// refuses as well); whether the terms are lawful is the server's to say, and its answer is
// shown in its own words.
import type { SummaryIssue } from "../../shared/ErrorSummary";
import { EMPTY_RECORD_EVIDENCE, type RecordEvidence } from "../../shared/records/evidence";
import type { AdoptionTerms, EnrollmentRequest, FlexSite } from "../api";

export type RegistrationForm = {
  establishment_id: string; target_scope: string; settlement_months: string; settlement_anchor: string; last_day: string;
  total_hours_rule: AdoptionTerms["total_hours_rule"]; rest_weekdays: number[]; agreed_total_description: string; standard_day: string;
  flexible_start: string; flexible_end: string; core_start: string; core_end: string;
  work_rules: RecordEvidence; agreement: RecordEvidence; filed_on: string; office: string; filing: RecordEvidence; valid_until: string; participants: string[];
};
/** The controls of the form an issue can point to. */
export type RegistrationField = Exclude<keyof RegistrationForm, "flexible_end" | "core_end" | "office" | "participants">;

export const emptyForm = (): RegistrationForm => ({
  establishment_id: "", target_scope: "", settlement_months: "1", settlement_anchor: "", last_day: "", total_hours_rule: "statutory_frame", rest_weekdays: [],
  agreed_total_description: "", standard_day: "", flexible_start: "", flexible_end: "", core_start: "", core_end: "",
  work_rules: { ...EMPTY_RECORD_EVIDENCE }, agreement: { ...EMPTY_RECORD_EVIDENCE }, filed_on: "", office: "", filing: { ...EMPTY_RECORD_EVIDENCE }, valid_until: "", participants: [],
});

export const STANDARD_DAY_PATTERN = "\\d{1,2}:[0-5]\\d";
const seconds = (text: string) => { const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim()); return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 : null; };
const midnight = (day: string) => `${day}T00:00:00+09:00`;
const nextDay = (day: string) => { const at = Date.parse(`${day}T00:00:00Z`); return Number.isNaN(at) ? "" : new Date(at + 86400000).toISOString().slice(0, 10); };
const clean = (evidence: RecordEvidence): RecordEvidence => ({ ...evidence, reference: evidence.reference.trim(), verified_by: evidence.status === "verified" ? evidence.verified_by?.trim() ?? null : null });

/** What a registration sends for the entered terms. The period ends at the midnight after
 * its last day; the parts of the agreement that were not entered are left out. */
export function termsOf(form: RegistrationForm, sites: FlexSite[], adoptionId: string): AdoptionTerms {
  const months = Number(form.settlement_months);
  return {
    adoption_id: adoptionId, employer_id: sites.find((site) => site.establishment_id === form.establishment_id)?.employer_id ?? "", establishment_id: form.establishment_id,
    start: midnight(form.settlement_anchor), end: midnight(nextDay(form.last_day)), target_scope: form.target_scope.trim(), settlement_months: months, settlement_anchor: form.settlement_anchor,
    total_hours_rule: form.total_hours_rule, agreed_total_description: form.agreed_total_description.trim(), standard_day_seconds: seconds(form.standard_day),
    ...(form.total_hours_rule === "full_two_day_weekend" ? { rest_weekdays: [...form.rest_weekdays].sort() } : {}),
    ...(form.flexible_start ? { flexible_time: [{ start: form.flexible_start, end: form.flexible_end }] } : {}),
    ...(form.core_start ? { core_time: [{ start: form.core_start, end: form.core_end }] } : {}),
    work_rules_evidence: clean(form.work_rules), agreement_evidence: clean(form.agreement),
    ...(months > 1 ? { filing: { filed_on: form.filed_on, office: form.office.trim(), evidence: clean(form.filing) }, agreement_valid_until: form.valid_until } : {}),
  };
}

/** The participation of one person from the adoption's first day. */
export const firstEnrollment = (adoptionId: string, personId: string, anchor: string): EnrollmentRequest => ({ enrollment_id: `${adoptionId}-${personId}`, adoption_id: adoptionId, person_id: personId, start: midnight(anchor) });
/** A participation added later, from one of the days the server listed. */
export const laterEnrollment = (adoptionId: string, personId: string, start: string, suffix: string): EnrollmentRequest => ({ enrollment_id: `${adoptionId}-${personId}-${suffix}`, adoption_id: adoptionId, person_id: personId, start: midnight(start) });

/** Entry slips the browser's own required-field check cannot find: a period or a time
 * window whose end is not after its start. */
export function entrySlips(form: RegistrationForm, fieldId: (field: RegistrationField) => string): SummaryIssue[] {
  const found: SummaryIssue[] = [];
  if (form.settlement_anchor && form.last_day && form.last_day < form.settlement_anchor) found.push({ message: "採用の最終日は、起算日以降にしてください。", fieldId: fieldId("last_day") });
  if (form.flexible_start && form.flexible_end && form.flexible_start >= form.flexible_end) found.push({ message: "フレキシブルタイムの終了は、開始より後にしてください。", fieldId: fieldId("flexible_start") });
  if (form.core_start && form.core_end && form.core_start >= form.core_end) found.push({ message: "コアタイムの終了は、開始より後にしてください。", fieldId: fieldId("core_start") });
  return found;
}

// What the server answers a registration it refuses, with the control each answer is
// about. Its Japanese messages are shown as they are; the messages of its record checks
// arrive in English and are worded in Japanese here (as @/lib/findingText does for
// findings). A message that is not listed is shown unchanged. Nothing is decided here.
const ANSWERS: Array<[RegExp, string | null, RegistrationField | undefined]> = [
  [/^採用は、将来の清算期間の初日から始めてください/, null, "settlement_anchor"],
  [/^事業場と雇用主が部署の記録と一致しないか/, null, "establishment_id"],
  [/^Flextime starts at midnight on its settlement anchor day/, "採用は、起算日の午前0時（日本時間）に始まる必要があります。", "settlement_anchor"],
  [/^The full two-day weekend rule needs at least two weekly rest days/, "完全週休2日制の特例では、毎週の休日が2日以上必要です。", "rest_weekdays"],
  [/^Rest days define the frame only under the full two-day weekend rule/, "毎週の休日は、完全週休2日制の特例のときだけ定められます。", "rest_weekdays"],
  [/^Core time must be shorter than the standard working day/, "コアタイムは、標準となる1日の労働時間より短くしてください。", "core_start"],
  [/^Core time needs flexible time around it/, "コアタイムを設ける場合は、フレキシブルタイムも定めてください。", "flexible_start"],
  [/^Each core time lies strictly inside the flexible time/, "コアタイムは、フレキシブルタイムの内側に収めてください。", "core_start"],
  [/^A settlement period over one month needs the filing and a validity period/, "1か月を超える清算期間には、協定届と協定の有効期間の終了日が必要です。", "filed_on"],
  [/^Flextime cannot run beyond the agreement's validity period/, "採用の最終日は、協定の有効期間の終了日以前にしてください。", "last_day"],
  [/^A time window must end after it starts/, "時間帯の終了は、開始より後にしてください。", undefined],
  [/^Use a positive half-open interval with whole-second precision/, "採用の最終日は、起算日以降にしてください。", "last_day"],
  [/^Verified evidence requires a responsible verifier/, "確認済みの根拠には、確認した人が必要です。", undefined],
];
/** The control for a field the server's record check names (`flexible_time.0`, `filing.office`, …). */
const NAMED: Record<string, RegistrationField> = {
  establishment_id: "establishment_id", employer_id: "establishment_id", target_scope: "target_scope", settlement_months: "settlement_months", settlement_anchor: "settlement_anchor",
  start: "settlement_anchor", end: "last_day", total_hours_rule: "total_hours_rule", rest_weekdays: "rest_weekdays", agreed_total_description: "agreed_total_description",
  standard_day_seconds: "standard_day", flexible_time: "flexible_start", core_time: "core_start", work_rules_evidence: "work_rules", agreement_evidence: "agreement",
  filing: "filed_on", agreement_valid_until: "valid_until",
};

/** The messages of a record check ("N validation errors for …": a field's name on one
 * line, its message on the next, indented) with the field each one names; none when the
 * text is not such a list. */
function recordCheck(text: string): Array<{ field: string; message: string }> {
  const lines = text.split("\n");
  if (!/^\d+ validation errors? for /.test(lines[0] ?? "")) return [];
  const found: Array<{ field: string; message: string }> = [];
  lines.slice(1).forEach((line, index, rest) => {
    if (!/^ {2}\S/.test(line)) return;
    const before = rest[index - 1] ?? "";
    found.push({ field: /^\S/.test(before) ? before.trim() : "", message: line.trim().replace(/ \[type=.*$/, "").replace(/^Value error, /, "") });
  });
  return found;
}

/** The server's refusal of a registration as the lines of the summary. */
export function refusedRegistration(text: string, fieldId: (field: RegistrationField) => string): SummaryIssue[] {
  const checked = recordCheck(text);
  const answers = checked.length ? checked : [{ field: "", message: text }];
  return answers.map(({ field, message }) => {
    const known = ANSWERS.find(([pattern]) => pattern.test(message));
    const named = known?.[2] ?? NAMED[field.split(".")[0]];
    return { message: known?.[1] ?? message, fieldId: named && fieldId(named) };
  });
}
