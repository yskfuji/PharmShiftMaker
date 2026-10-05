import type { PublicationRead } from "@/ideal/api/contracts";
import type { IdealRole, ScheduleCalendarView } from "@/ideal/types";
import { scheduleModel } from "../model";

const duty = (id: string, person: string, start: string, end: string) => ({ duty_id: id, person_id: person, kind: "日勤", task: "調剤", location: "中央病棟", start, end });
const publication: PublicationRead = {
  publication_id: "pub-2", version: 2, period: "2026-10-12T00:00:00+09:00|2026-10-19T00:00:00+09:00", validation_status: "verified_at_publication",
  assignments: [duty("d1", "p-self", "2026-10-13T08:30:00+09:00", "2026-10-13T17:15:00+09:00"), duty("d2", "p-other", "2026-10-12T08:30:00+09:00", "2026-10-12T17:15:00+09:00")],
};
const build = (role: IdealRole, names: Record<string, string> = {}, pub: PublicationRead | null = publication, calendar: ScheduleCalendarView | null = null) =>
  scheduleModel({ scope: { scope_id: "hospital/pharmacy", display_name: "合成病院 薬剤部", person_id: "p-self", role, input_revision: 3 }, publication: pub, names, observedAt: "2026-10-12T21:00:00+09:00" },
    calendar, (id, format) => `https://api.example/${id}/${format}`);
const calendar = (over: Partial<ScheduleCalendarView>): ScheduleCalendarView => ({
  scope_id: "hospital/pharmacy", requested_period: "2026-10", visibility: "department",
  publication: { publication_id: "pub-2", version: 2, period: publication.period, input_hash: "h", created_at: "2026-10-10T00:00:00+09:00" },
  previous_publication: null, assignments: publication.assignments.map((item) => ({ ...item })), changes: [], can_export_department: true, limitations: [], ...over,
});

test("the schedule holds only what the API returned, one row per person in name order", () => {
  const model = build("LEADER", { "p-self": "合成 花子", "p-other": "合成 次郎" });
  expect(model.summary).toEqual([{ tone: "good", label: "公開勤務 2件" }]);
  expect(model.rows.map((r) => r.name)).toEqual(["合成 次郎", "合成 花子"].sort((a, b) => a.localeCompare(b, "ja")));
  expect(model.eyebrow).toBe("公開版 v2 · 公開済み");
  expect(model.title).toBe("2026年10月");
  expect(model.range).toBe("表示期間 10/12–10/18");
  expect(model.days.map((d) => d.label)).toEqual(["10/12 月", "10/13 火", "10/14 水", "10/15 木", "10/16 金", "10/17 土", "10/18 日"]);
  expect(model.days.filter((d) => d.weekend).map((d) => d.label)).toEqual(["10/17 土", "10/18 日"]);
  expect(model.rows.find((r) => r.id === "p-self")).toMatchObject({ badge: "本人", initial: "合" });
  // Without the calendar nothing is marked as changed and no department export is offered.
  expect(model.rows.flatMap((r) => r.cells).some((c) => c.changed)).toBe(false);
  expect(model.departmentExport).toBeNull();
});

test('a day without a published duty is shown as "—", not as leave', () => {
  const row = build("LEADER").rows.find((r) => r.id === "p-self")!;
  expect(row.cells[0]).toMatchObject({ shift: "—", time: "" });
  expect(row.cells[1]).toMatchObject({ shift: "日勤", time: "08:30–17:15" });
});

test("a pharmacist sees personal export links and no other names", () => {
  const own = { ...publication, assignments: publication.assignments.filter((d) => d.person_id === "p-self") };
  const model = build("PHARMACIST", {}, own);
  expect(model.rows.map((r) => r.name)).toEqual(["あなた"]);
  expect(model.personalExport).toEqual({ print: "https://api.example/pub-2/print", ical: "https://api.example/pub-2/ical" });
  expect(model.departmentExport).toBeNull();
});

test("without a publication nothing is invented", () => {
  const model = build("ADMIN", {}, null);
  expect(model.rows).toEqual([]);
  expect(model.personalExport).toBeNull();
  expect(model.eyebrow).toBe("公開版なし");
  expect(model.summary).toEqual([{ tone: "warn", label: "公開版がありません" }]);
  expect(model.details).toEqual({});
  expect(model.initialSelected).toBe("");
  // A week from the observed day is shown, empty, so the page still says which period it is.
  expect(model.agendas).toHaveLength(7);
  expect(JSON.stringify(model)).not.toContain("検証済み");
});

test("two duties on one day are both shown, and a pharmacist count is labelled as their own", () => {
  const night = { ...publication.assignments[0], duty_id: "d-night", kind: "夜勤", start: "2026-10-13T20:00:00+09:00", end: "2026-10-14T08:00:00+09:00" };
  const own = { ...publication, assignments: [...publication.assignments.filter((d) => d.person_id === "p-self"), night] };
  const model = build("PHARMACIST", {}, own);
  const cells = model.rows[0].cells.filter((c) => c.shift.includes("夜勤"));
  expect(cells).toHaveLength(1);
  expect(cells[0].shift.split("・")).toHaveLength(2);
  expect(cells[0].time).toBe("08:30–17:15 / 20:00–08:00");
  expect(model.details[cells[0].id].facts.some((f) => f.startsWith("夜勤 20:00–08:00"))).toBe(true);
  expect(model.summary[0].label).toMatch(/^自分の公開勤務 /);
  expect(model.agendas[1].items[0]).toMatchObject({ status: "日勤・夜勤", tone: "good" });
  expect(model.agendas[0].items[0]).toMatchObject({ status: "勤務なし", tone: "neutral" });
});

test("the calendar of the publication on screen adds its changes and the export permission", () => {
  const model = build("ADMIN", {}, publication, calendar({ changes: [{ duty_id: "d2", kind: "CHANGED" }] }));
  expect(model.rows.find((r) => r.id === "p-other")!.cells[0].changed).toBe(true);
  expect(model.rows.find((r) => r.id === "p-self")!.cells[1].changed).toBe(false);
  expect(model.departmentExport).toEqual({ scope: "hospital/pharmacy", publication: "pub-2", version: 2 });
  expect(build("LEADER", {}, publication, calendar({ can_export_department: false })).departmentExport).toBeNull();
});

test("a calendar of another publication is not mixed into the one on screen", () => {
  const other = calendar({
    publication: { publication_id: "pub-1", version: 1, period: publication.period, input_hash: "h", created_at: "x" },
    assignments: [duty("old", "p-gone", "2026-10-12T08:30:00+09:00", "2026-10-12T17:15:00+09:00")], changes: [{ duty_id: "d2", kind: "CHANGED" }],
  });
  const model = build("ADMIN", {}, publication, other);
  expect(model.rows.map((r) => r.id).sort()).toEqual(["p-other", "p-self"]);
  expect(model.rows.flatMap((r) => r.cells).some((c) => c.changed)).toBe(false);
});

test("a publication whose input changed is marked, and the first duty is the one selected", () => {
  const model = build("LEADER", {}, { ...publication, validation_status: "revalidation_required" });
  expect(model.summary).toEqual([{ tone: "good", label: "公開勤務 2件" }, { tone: "warn", label: "再検証が必要" }]);
  expect(model.initialSelected).toBe("p-other-0");
  expect(model.details["p-other-0"]).toEqual({ title: "p-other · 10月12日", facts: ["日勤 08:30–17:15", "中央病棟", "公開版 v2"], note: "公開済みの勤務です。変更は申請から行います（申請の接続は次の段です）。" });
});
