// What a change case (absence or exchange) says, read the same way by every route that
// shows one. Display only: the server decides who may consent, withdraw or approve.
import type { PublishedDuty } from "@/ideal/api/contracts";
import type { ScheduleChangeCase } from "@/ideal/types";
import { dutyWhen, isReadableWhen } from "../format";

type Validation = { findings?: unknown[]; publishable?: boolean; required_consent_person_ids?: string[]; consented_person_ids?: string[]; replacement_duty_ids?: string[] };

export type Verb = "consent" | "decline" | "withdraw" | "recommend" | "approve" | "reject";

export const validationOf = (c: ScheduleChangeCase) => (c.validation ?? {}) as Validation;

/** The duties a case adds (a planner receives the whole proposed roster). */
export function replacements(c: ScheduleChangeCase): PublishedDuty[] {
  const added = validationOf(c).replacement_duty_ids;
  const proposed = c.proposed_assignments as unknown as PublishedDuty[];
  return added ? proposed.filter((d) => added.includes(d.duty_id)) : proposed;
}

/** The case waits for this person's consent. */
export const asksMe = (c: ScheduleChangeCase, personId: string) =>
  c.status === "AWAITING_CONSENT" && (validationOf(c).required_consent_person_ids ?? []).includes(personId)
  && !(validationOf(c).consented_person_ids ?? []).includes(personId);

/** A planner's own cases: those removing or adding one of their own duties. (A pharmacist
 * receives only such cases from the server.) */
export const involves = (c: ScheduleChangeCase, personId: string) =>
  [...(c.affected_assignments as { person_id?: string }[]), ...replacements(c)].some((d) => d.person_id === personId);

/** Whose duties a case removes or adds, as the names the viewer has been given, each once
 * and in the order of the case (a pharmacist is not given other people's names: `nameOf`
 * answers for them in general words). Empty when the read carries no duty for this viewer. */
export function involvedNames(c: ScheduleChangeCase, nameOf: (personId: string) => string): string {
  const people = [...(c.affected_assignments as { person_id?: unknown }[]), ...replacements(c)].map((d) => d.person_id).filter((id): id is string => typeof id === "string");
  return Array.from(new Set(people.map(nameOf))).join("、");
}

/** The viewer's own duties in a case, as the line that tells one case from another where the
 * names cannot: a pharmacist is not given other people's names, so two cases between the
 * same two people would both read 「あなた、相手の職員」. Which of the viewer's duties the
 * case removes (「外す」) and adds (「入る」), each with its day and hours, in the order of
 * the case. The duties are the ones the read carries; nothing is paired or worked out.
 * Empty when the case holds no duty of the viewer. */
export function ownDutiesText(c: ScheduleChangeCase, personId: string): string {
  const own = (duties: Array<{ person_id?: unknown; start?: unknown; end?: unknown }>, change: string) =>
    duties.filter((d) => d.person_id === personId).map((d) => `${change} ${dutyWhen(d.start as string, d.end as string)}`);
  return [...own(c.affected_assignments as Array<{ person_id?: unknown }>, "外す"), ...own(replacements(c), "入る")].join("／");
}

/** True when a duty the case removes or adds has a start or an end that cannot be read:
 * what is being decided cannot then be shown, so nothing that moves the case forward is
 * offered (shared/changeCases/CaseActions.tsx). */
export const hasUnreadableDuty = (c: ScheduleChangeCase): boolean =>
  [...(c.affected_assignments as { start?: unknown; end?: unknown }[]), ...(replacements(c) as { start?: unknown; end?: unknown }[])].some((d) => !isReadableWhen(d.start, d.end));
