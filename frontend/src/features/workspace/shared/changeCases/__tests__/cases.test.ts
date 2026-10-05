import type { ScheduleChangeCase } from "@/ideal/types";
import { asksMe, involves, replacements, validationOf } from "../cases";

const duty = (id: string, person: string) => ({ duty_id: id, person_id: person, kind: "日勤", task: "調剤", location: "中央", start: "2026-10-13T08:30:00+09:00", end: "2026-10-13T17:15:00+09:00" });
const row = (over: Partial<ScheduleChangeCase>): ScheduleChangeCase => ({
  case_id: "c1", scope_id: "s", publication_id: "pub-1", kind: "SWAP", status: "AWAITING_CONSENT", version: 1,
  affected_assignments: [], proposed_assignments: [], validation: null, evidence: {}, created_by: "", created_at: "", updated_at: "", ...over,
});

test("a case without a validation is read as having none, never as an error", () => {
  expect(validationOf(row({}))).toEqual({});
  expect(asksMe(row({}), "p1")).toBe(false);
});

test("the duties a case adds are the ones the server names, else the whole proposal", () => {
  const proposed = [duty("r1", "p1"), duty("keep", "p2")];
  expect(replacements(row({ proposed_assignments: proposed, validation: { replacement_duty_ids: ["r1"] } })).map((d) => d.duty_id)).toEqual(["r1"]);
  expect(replacements(row({ proposed_assignments: proposed })).map((d) => d.duty_id)).toEqual(["r1", "keep"]);
});

test("a consent is asked only while the case waits and this person has not answered", () => {
  const waiting = row({ validation: { required_consent_person_ids: ["p1", "p2"], consented_person_ids: ["p2"] } });
  expect(asksMe(waiting, "p1")).toBe(true);
  expect(asksMe(waiting, "p2")).toBe(false);
  expect(asksMe(waiting, "p3")).toBe(false);
  expect(asksMe({ ...waiting, status: "READY" }, "p1")).toBe(false);
});

test("a case involves a person whose duty it removes or adds, and nobody else", () => {
  const c = row({ affected_assignments: [duty("d1", "p1")], proposed_assignments: [duty("r1", "p2"), duty("keep", "p3")], validation: { replacement_duty_ids: ["r1"] } });
  expect(involves(c, "p1")).toBe(true);
  expect(involves(c, "p2")).toBe(true);
  // p3's duty is in the proposed roster but is not one the case adds.
  expect(involves(c, "p3")).toBe(false);
});
