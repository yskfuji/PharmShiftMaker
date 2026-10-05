// Actual work as the route shows, records and corrects it. Display, entry and the shape of
// what is sent only: whether an actual is acceptable (its employment revisions, its
// scheduled hours, its place in a published plan) is decided by the server.
import { jstText } from "../../shared/jst";
import type { Fact } from "../../shared/records/facts";
import type { ActualDuty, ActualRow, ActualSaveBody, ActualsContext, DutyOption, EmploymentRevision, Piece, PublishedPlan, WorkTerms } from "../api";

/** What the route keeps of the workflow context for its first view. */
export type ActualsData = { role: string; canCorrect: boolean; names: Record<string, string>; actuals: ActualRow[] };

/** The names are those of the scope's people: a checked source file may name any of them. */
export function actualsOf(context: ActualsContext): ActualsData {
  return {
    role: context.role,
    canCorrect: context.can_correct_actuals,
    names: Object.fromEntries(context.people.map((person) => [person.person_id, person.name])),
    actuals: context.actuals,
  };
}

export type StoredTerms = { dutyId: string; revision: number; payload: WorkTerms };
/** What the recording tasks read when one of them is opened. */
export type ActualTaskContext = { names: Record<string, string>; employments: EmploymentRevision[]; dutyOptions: DutyOption[]; publications: PublishedPlan[]; actuals: ActualRow[]; terms: StoredTerms[] };

export function taskContextOf(context: ActualsContext): ActualTaskContext {
  return {
    names: Object.fromEntries(context.people.map((person) => [person.person_id, person.name])),
    employments: context.employments,
    dutyOptions: context.duty_options ?? [],
    publications: context.publications,
    actuals: context.actuals,
    terms: context.records.filter((row) => row.kind === "work_terms").map((row) => ({ dutyId: row.entity_id, revision: row.revision, payload: row.payload as unknown as WorkTerms })),
  };
}

export const personName = (names: Record<string, string>, personId: string) => (Object.hasOwn(names, personId) ? names[personId] : null) ?? "名前を確認できない職員";
export const pieceText = (piece: Piece) => `${jstText(piece.start) || "未入力"} 〜 ${jstText(piece.end) || "未入力"}`;
export const piecesText = (pieces: Piece[]) => (pieces.length ? pieces.map(pieceText).join("、") : "なし");
export const actualLabel = (row: Pick<ActualRow, "revision" | "duty">, names: Record<string, string>) => `${personName(names, row.duty.person_id)} ${jstText(row.duty.start)}（第${row.revision}版）`;
/** The marker is the employment revision's own field, as the server returned it. */
export const isFlextime = (employment: EmploymentRevision | undefined) => employment?.working_time_system === "flex";
export const employmentLabel = (employment: EmploymentRevision) => `${jstText(employment.start)} 〜 ${jstText(employment.end)}${isFlextime(employment) ? "（フレックスタイム制）" : ""}`;
export const dutyOptionLabel = (option: DutyOption) => `${option.kind}・${option.task}・${option.location}`;

/** The actual being recorded or corrected, with the revisions the edit starts from
 * (`revision` 0: the server has no such actual, or no scheduled hours for it, yet). */
export type ActualDraft = { key: string; actual: { external_id: string; revision: number; duty: ActualDuty }; terms: WorkTerms; termsRevision: number };
export type ActualEdit = { work: Piece[]; breaks: Piece[]; scheduled: Piece[]; employmentIds: string[] };

export const editOf = (draft: ActualDraft): ActualEdit => ({
  work: draft.actual.duty.work, breaks: draft.actual.duty.breaks, scheduled: draft.terms.scheduled_work,
  employmentIds: draft.terms.employment_revision_ids?.length ? draft.terms.employment_revision_ids : draft.terms.employment_revision_id ? [draft.terms.employment_revision_id] : [],
});

const storedTerms = (context: ActualTaskContext, dutyId: string) => context.terms.find((item) => item.dutyId === dutyId);

/** A registered actual with the scheduled hours stored for it. */
export function draftOfActual(context: ActualTaskContext, row: ActualRow): ActualDraft {
  const stored = storedTerms(context, row.duty.duty_id);
  return { key: row.external_id, actual: row, terms: stored?.payload ?? { duty_id: row.duty.duty_id, employment_revision_id: "", scheduled_work: [] }, termsRevision: stored?.revision ?? 0 };
}

/** The actual of one published duty: the one already recorded for it, or a new one that
 * starts from the duty as published. `newDutyId` is used only for a new one. */
export function draftOfPublishedDuty(context: ActualTaskContext, plan: PublishedPlan, duty: ActualDuty, newDutyId: string): ActualDraft {
  const externalId = `manual:${plan.publication_id}:${duty.duty_id}`;
  const actual = context.actuals.find((row) => row.external_id === externalId) ?? { external_id: externalId, revision: 0, duty: { ...duty, duty_id: newDutyId, source: "actual" } };
  const stored = storedTerms(context, actual.duty.duty_id);
  return {
    key: externalId, actual, termsRevision: stored?.revision ?? 0,
    terms: stored?.payload ?? { duty_id: actual.duty.duty_id, employment_revision_id: "", scheduled_work: duty.work, planned_publication_id: plan.publication_id, planned_duty_id: duty.duty_id },
  };
}

/** A new actual without a published duty, under one employment revision. No hours are
 * proposed: they are entered from the person's own record. */
export function draftOfUnplanned(employment: EmploymentRevision, option: DutyOption, ids: { external: string; duty: string }): ActualDraft {
  const externalId = `flex:${ids.external}`;
  return {
    key: externalId, termsRevision: 0,
    actual: { external_id: externalId, revision: 0, duty: { duty_id: ids.duty, person_id: employment.person_id, relationship_id: employment.relationship_id, kind: option.kind, task: option.task, location: option.location, start: "", end: "", work: [], breaks: [], source: "actual" } },
    terms: { duty_id: ids.duty, employment_revision_id: employment.revision_id, scheduled_work: [] },
  };
}

const at = (iso: string) => new Date(iso).getTime();

/** What a save sends: the duty spans its work and breaks, and the scheduled hours are
 * left out when `withoutScheduled` (an employment revision registered as flextime). */
export function actualBody(draft: ActualDraft, edit: ActualEdit, withoutScheduled: boolean): ActualSaveBody {
  const pieces = [...edit.work, ...edit.breaks];
  return {
    expected_revision: draft.actual.revision,
    payload: {
      external_id: draft.actual.external_id, revision: draft.actual.revision + 1,
      duty: { ...draft.actual.duty, source: "actual", work: edit.work, breaks: edit.breaks, start: new Date(Math.min(...pieces.map((piece) => at(piece.start)))).toISOString(), end: new Date(Math.max(...pieces.map((piece) => at(piece.end)))).toISOString() },
      work_terms: { ...draft.terms, employment_revision_id: edit.employmentIds[0], employment_revision_ids: edit.employmentIds.length > 1 ? edit.employmentIds : [], scheduled_work: withoutScheduled ? [] : edit.scheduled },
      expected_work_terms_revision: draft.termsRevision,
    },
  };
}

/** An actual as the lines a person reads (the confirmation and the three-way review). */
export function actualFacts(duty: Pick<ActualDuty, "person_id" | "kind" | "task" | "location">, edit: ActualEdit, context: Pick<ActualTaskContext, "names" | "employments">): Fact[] {
  const chosen = edit.employmentIds.map((id) => context.employments.find((item) => item.revision_id === id));
  return [
    { label: "職員", text: personName(context.names, duty.person_id) },
    { label: "業務・場所", text: dutyOptionLabel(duty) },
    { label: "実労働（日本時間）", text: piecesText(edit.work) },
    { label: "休憩（日本時間）", text: piecesText(edit.breaks) },
    { label: "所定労働（日本時間）", text: chosen.some(isFlextime) ? "記録しません（フレックスタイム制の雇用条件）" : piecesText(edit.scheduled) },
    { label: "適用する雇用条件", text: chosen.length ? chosen.map((item) => (item ? employmentLabel(item) : "一覧にない雇用条件")).join(" → ") : "未選択" },
  ];
}

/** What a reconciliation note is recorded against. */
export const reviewFacts = (row: Pick<ActualRow, "revision" | "duty">): Fact[] => [
  { label: "実績の版", text: `第${row.revision}版` },
  { label: "実労働（日本時間）", text: piecesText(row.duty.work) },
  { label: "休憩（日本時間）", text: piecesText(row.duty.breaks) },
];

export type RowError = { row: number; code: string; message: string };

/** The rows the server could not accept, when a refused file names them (`detail.row_errors`). */
export function rowErrorsOf(error: unknown): RowError[] {
  if (!(error instanceof Error)) return [];
  try {
    const detail = (JSON.parse(error.message.replace(/^\d{3}: /, "")) as { detail?: { row_errors?: unknown } }).detail;
    return Array.isArray(detail?.row_errors) ? (detail.row_errors as RowError[]).filter((item) => typeof item?.row === "number" && typeof item?.message === "string") : [];
  } catch {
    return [];
  }
}
