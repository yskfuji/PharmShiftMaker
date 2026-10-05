import { asksMe, type Verb } from "../../shared/changeCases/cases";
import type { ScheduleChangeCase } from "@/ideal/types";

/** What same-day operations offers on an open case. The server names the approval step
 * and whether a rejection is possible, and checks every change again. */
export function operationVerbs(c: ScheduleChangeCase, personId: string): Verb[] {
  const approval = c.approval_action ?? (c.status === "READY" ? "APPROVE" : null);
  return [
    ...(approval === "RECOMMEND" ? ["recommend"] as const : []),
    ...(approval === "APPROVE" ? ["approve"] as const : []),
    ...(c.can_reject ? ["reject"] as const : []),
    ...(asksMe(c, personId) ? ["consent", "decline"] as const : []),
    "withdraw",
  ];
}
