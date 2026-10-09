// Outside-work declarations as the route shows and edits them. Display and entry only:
// whether declared hours are combined with the facility's own, and whether a plan may be
// published, is decided by the server.
import { jstText } from "../../shared/jst";
import type { Fact } from "../../shared/records/facts";
import type { DeclarationContext, DeclarationPayload, DeclarationRow, DeclarationStatus, Piece } from "../api";

export const STATUS_LABEL: Record<DeclarationStatus, string> = { SUBMITTED: "照合待ち", REVIEWED: "確認済み", RETURNED: "再確認", WITHDRAWN: "取下げ済み" };
export const ACTIVITY_LABEL: Record<DeclarationPayload["activity"], string> = { employment: "雇用", nonemployment: "非雇用活動" };
const NONE = "（なし）";

export type DeclarationNames = { person: (personId: string) => string; employer: (employerId: string) => string; site: (establishmentId: string) => string };

/** Names for the identifiers a declaration holds. An employer or site the server no longer
 * lists is said to be unregistered; its identifier is not shown as a name. */
export function declarationNames(context: Pick<DeclarationContext, "employers" | "establishments">, person: (personId: string) => string): DeclarationNames {
  return {
    person,
    employer: (employerId) => context.employers.find((item) => item.employer_id === employerId)?.name ?? "未登録の雇用主",
    site: (establishmentId) => context.establishments.find((item) => item.establishment_id === establishmentId)?.name ?? "名称未登録の事業場",
  };
}

export const periodText = (item: Piece) => `${jstText(item.start) || "未入力"} 〜 ${jstText(item.end) || "未入力"}`;
const piecesText = (pieces: Piece[] | undefined) => (pieces?.length ? pieces.map(periodText).join("、") : NONE);

/** A declaration as the lines a person reads (the confirmation and the three-way review). */
export const declarationFacts = (item: DeclarationPayload, names: DeclarationNames): Fact[] => [
  { label: "本人", text: names.person(item.person_id) },
  { label: "他の雇用主・活動先", text: item.employer_id ? names.employer(item.employer_id) : NONE },
  { label: "事業場", text: item.establishment_id ? names.site(item.establishment_id) : NONE },
  { label: "活動の区分", text: ACTIVITY_LABEL[item.activity] ?? item.activity },
  { label: "契約締結順", text: item.contract_order === null ? "未記載" : String(item.contract_order) },
  { label: "適用開始（日本時間）", text: jstText(item.start) || NONE },
  { label: "適用終了（日本時間）", text: jstText(item.end) || NONE },
  { label: "所定労働区間", text: piecesText(item.scheduled_work) },
  { label: "所定外労働区間", text: piecesText(item.additional_work) },
  { label: "他社の法定休日の労働区間", text: piecesText(item.other_holiday_work) },
  { label: "労働区間の記載", text: item.work_report_complete ? "この期間の区間をすべて記載した" : "すべては記載していない" },
  { label: "照合資料", text: item.reference || NONE, verbatim: true },
  { label: "状態", text: STATUS_LABEL[item.status] ?? item.status },
  { label: "照合根拠", text: item.review_evidence?.reference || NONE, verbatim: true },
  { label: "照合担当者", text: item.review_evidence?.verified_by || NONE, verbatim: true },
  { label: "照合の有効期限", text: item.review_evidence ? jstText(item.review_evidence.valid_until) || "期限なし" : NONE },
];

export const newDeclaration = (declarationId: string, personId: string): DeclarationPayload => ({
  declaration_id: declarationId, person_id: personId, employer_id: "", establishment_id: "", contract_order: null, activity: "employment",
  start: "", end: "", reference: "", status: "SUBMITTED", review_evidence: null, work_report_complete: false,
  scheduled_work: [], additional_work: [], other_holiday_work: [],
});

/** How a declaration is named where one is chosen: whose, where, from when, and its status. */
export const declarationLabel = (row: DeclarationRow, names: DeclarationNames): string =>
  `${names.person(row.payload.person_id)}・${names.employer(row.payload.employer_id)} ${jstText(row.payload.start).slice(0, 10)}〜（${STATUS_LABEL[row.payload.status] ?? row.payload.status}）`;

export type DeclaredTotal = { period: string; scheduled: number; extra: number; holiday: number };
const HOUR = 3600000;

/**
 * The declared intervals added up as they were entered, in seconds, by the Japan-time week
 * (starting on Monday) and month in which each interval starts. A plain sum for comparing
 * with the other employer's documents: it combines nothing and judges nothing. Work on the
 * other employer's statutory holiday is counted in "extra" and shown again on its own.
 */
export function declaredTotals(item: Pick<DeclarationPayload, "scheduled_work" | "additional_work" | "other_holiday_work">): { weeks: DeclaredTotal[]; months: DeclaredTotal[] } {
  const weeks = new Map<string, DeclaredTotal>();
  const months = new Map<string, DeclaredTotal>();
  const add = (table: Map<string, DeclaredTotal>, period: string, column: "scheduled" | "extra" | "holiday", seconds: number) => {
    const row = table.get(period) ?? { period, scheduled: 0, extra: 0, holiday: 0 };
    row[column] += seconds;
    table.set(period, row);
  };
  const holiday = item.other_holiday_work ?? [];
  const columns = [["scheduled", item.scheduled_work], ["extra", [...item.additional_work, ...holiday]], ["holiday", holiday]] as const;
  for (const [column, pieces] of columns) {
    for (const piece of pieces) {
      const start = Date.parse(piece.start);
      const seconds = Math.max(0, (Date.parse(piece.end) - start) / 1000);
      const local = new Date(start + 9 * HOUR);
      const monday = new Date(local.getTime() - ((local.getUTCDay() + 6) % 7) * 24 * HOUR);
      add(weeks, monday.toISOString().slice(0, 10), column, seconds);
      add(months, local.toISOString().slice(0, 7), column, seconds);
    }
  }
  const ordered = (table: Map<string, DeclaredTotal>) => Array.from(table.values()).sort((a, b) => a.period.localeCompare(b.period));
  return { weeks: ordered(weeks), months: ordered(months) };
}

export const hoursText = (seconds: number) => `${Math.floor(seconds / 3600)}時間${Math.round((seconds % 3600) / 60)}分`;
