// What a change case (absence or exchange) says, read the same way by every route that
// shows one. Display only: the server decides who may consent, withdraw or approve.
import type { PublishedDuty } from "@/ideal/api/contracts";
import type { ScheduleChangeCase } from "@/ideal/types";

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
