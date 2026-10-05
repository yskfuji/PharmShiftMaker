import { OPEN_CASE } from "@/ideal/live/format";
import type { IdealRole, ScheduleChangeCase } from "@/ideal/types";
import { asksMe, type Verb } from "../shared/changeCases/cases";

/** What the request routes offer on one of the viewer's cases: answer a consent asked of
 * them, or withdraw an open case. The server checks every change again. */
export function requestVerbs(c: ScheduleChangeCase, personId: string, role: IdealRole): Verb[] {
  return [
    ...(asksMe(c, personId) ? ["consent", "decline"] as const : []),
    ...(OPEN_CASE.includes(c.status) && (role !== "PHARMACIST" || c.created_by !== "") ? ["withdraw"] as const : []),
  ];
}
