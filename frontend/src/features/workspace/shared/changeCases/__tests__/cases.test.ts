import type { ScheduleChangeCase } from "@/ideal/types";
import { asksMe, hasUnreadableDuty, involvedNames, involves, ownDutiesText, replacements, validationOf } from "../cases";

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

test("the people of a case are named once each, in the order of the case, by the names the viewer is given", () => {
  const c = row({ affected_assignments: [duty("d1", "p1"), duty("d2", "p2")], proposed_assignments: [duty("r1", "p2"), duty("r2", "p1"), duty("keep", "p3")], validation: { replacement_duty_ids: ["r1", "r2"] } });
  expect(involvedNames(c, (id) => ({ p1: "高橋 葵", p2: "鈴木 悠斗" }[id] ?? "相手の職員"))).toBe("高橋 葵、鈴木 悠斗");
  // A pharmacist's names: nobody is named who was not named to them.
  expect(involvedNames(c, (id) => (id === "p1" ? "あなた" : "相手の職員"))).toBe("あなた、相手の職員");
  expect(involvedNames(row({}), () => "x")).toBe("");
});

test("a duty with a start or an end that cannot be read is found, on either side of the case", () => {
  expect(hasUnreadableDuty(row({ affected_assignments: [duty("d1", "p1")], proposed_assignments: [duty("r1", "p2")] }))).toBe(false);
  expect(hasUnreadableDuty(row({ affected_assignments: [{ ...duty("d1", "p1"), end: "" }] }))).toBe(true);
  expect(hasUnreadableDuty(row({ proposed_assignments: [{ ...duty("r1", "p2"), start: "soon" }], validation: { replacement_duty_ids: ["r1"] } }))).toBe(true);
});

test("the viewer's own duties in a case are said with their day and hours: what is removed, then what is added; nobody else's", () => {
  const later = { ...duty("r2", "p1"), start: "2026-10-13T10:30:00+09:00", end: "2026-10-13T19:30:00+09:00" };
  const swap = row({ affected_assignments: [duty("d1", "p1"), duty("d2", "p2")], proposed_assignments: [duty("r1", "p2"), later, duty("keep", "p3")], validation: { replacement_duty_ids: ["r1", "r2"] } });
  expect(ownDutiesText(swap, "p1")).toBe("外す 10月13日（火） 08:30–17:15／入る 10月13日（火） 10:30–19:30");
  // An absence removes the viewer's duty and adds none of theirs: the two cases read differently.
  const absence = row({ kind: "ABSENCE", affected_assignments: [duty("d1", "p1")], proposed_assignments: [duty("r1", "p2")], validation: { replacement_duty_ids: ["r1"] } });
  expect(ownDutiesText(absence, "p1")).toBe("外す 10月13日（火） 08:30–17:15");
  // A case that holds no duty of the viewer says nothing of them.
  expect(ownDutiesText(swap, "p3")).toBe("");
  expect(ownDutiesText(row({}), "p1")).toBe("");
});
