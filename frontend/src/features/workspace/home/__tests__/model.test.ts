import type { PublicationRead } from "@/ideal/api/contracts";
import type { IdealRole, ScheduleCalendarView, ScheduleChangeCase } from "@/ideal/types";
import type { RouteContext } from "../../shell/routeTypes";
import { homeQueue, personalHome, teamHome } from "../model";

const duty = (id: string, person: string, start: string, end: string) => ({ duty_id: id, person_id: person, kind: "日勤", task: "調剤", location: "中央病棟", start, end });
const publication: PublicationRead = {
  publication_id: "pub-2", version: 2, period: "2026-10-12T00:00:00+09:00|2026-10-19T00:00:00+09:00", validation_status: "verified_at_publication",
  assignments: [duty("d1", "p-self", "2026-10-13T08:30:00+09:00", "2026-10-13T17:15:00+09:00"), duty("d2", "p-other", "2026-10-12T08:30:00+09:00", "2026-10-12T17:15:00+09:00")],
};
const context = (role: IdealRole, pub: PublicationRead | null = publication, observedAt = "2026-10-12T21:00:00+09:00"): RouteContext => ({
  observedAt, day: "2026-10-12", period: "2026-10", viewerName: "合成 花子",
  scope: { scope_id: "hospital/pharmacy", display_name: "合成病院 薬剤部", person_id: "p-self", role, input_revision: 3 },
  role, publications: pub ? [pub] : [], publication: pub, selectedCaseId: null, selectedPersonId: null, selectedDraftIds: [], selectedInputHash: null, names: {}, notifications: [], notificationsRead: true,
});
const nothing = { dashboard: null, daily: null, stability: null };
const calendar = (over: Partial<ScheduleCalendarView>): ScheduleCalendarView => ({
  scope_id: "hospital/pharmacy", requested_period: "2026-10", visibility: "self",
  publication: { publication_id: "pub-2", version: 2, period: publication.period, input_hash: "h", created_at: "2026-10-10T00:00:00+09:00" },
  previous_publication: null, assignments: [], changes: [], can_export_department: false, limitations: [], ...over,
});

test("the home holds only what the API returned: no stability or coverage figures", () => {
  const home = teamHome(context("LEADER"), nothing);
  expect(home.stability).toBeNull();
  expect(home.headline).toBe("公開版 v2 を表示しています");
  expect(home.detail).toBe("合成病院 薬剤部 · 最新公開版 v2");
  expect(home.eyebrow).toBe("2026年10月12日 · 月曜日");
  expect(home.metrics.map((m) => [m.label, m.value, m.detail])).toEqual([
    ["本日の予定勤務", "—", "当日情報を確認できません"],
    ["判断待ち", "—件", "欠勤・交換・申請"],
    ["未達通知", "—", "配信処理の状態"],
    ["検証", "公開時に検証済み", "入力が更新されると再検証が必要です"],
  ]);
});

test("today's counts come from the daily snapshot, else the dashboard's pending requests", () => {
  const dashboard = { scope_id: "s", period: "2026-10", role: "LEADER", visibility: "department" as const, observed_at: "x", sources: [], metrics: { pending_requests: { value: 4, state: "available" as const, reason: null } } };
  const daily = { scope_id: "s", day: "2026-10-12", observed_at: "x", visibility: "department" as const, scheduled_assignments: [], scheduled_count: 7, open_case_count: 2, absence_case_count: 1, coverage_finding_count: 0, undelivered_notification_count: 3, limitations: [] };
  expect(teamHome(context("LEADER"), { ...nothing, dashboard }).metrics[1].value).toBe("4件");
  const withDaily = teamHome(context("LEADER"), { ...nothing, dashboard, daily }).metrics;
  expect(withDaily.slice(0, 3).map((m) => m.value)).toEqual(["7件", "2件", "3件"]);
  expect(withDaily[0].detail).toBe("在席・出勤実績ではありません");
});

test("recent changes are the server's own figures and its own explanation", () => {
  const stability = { scope_id: "s", observed_at: "x", window_days: 14, publication_count: 2, change_event_count: 5, days: [{ day: "2026-10-11", change_count: 2 }, { day: "2026-10-10", change_count: 0 }], meaning: "記述統計です。" };
  expect(teamHome(context("ADMIN"), { ...nothing, stability }).stability).toEqual({ value: "5件", label: "公開 2回", bars: [2, 0], note: "記述統計です。" });
});

test("without a publication nothing is invented", () => {
  const home = teamHome(context("ADMIN", null), nothing);
  expect(home.headline).toBe("公開済みの勤務表はまだありません");
  expect(home.sealTime).toBe("—");
  // no verification claim and no "good" tone without a publication
  expect(home.metrics.find((m) => m.label === "検証")).toMatchObject({ value: "—", tone: "neutral" });
  expect(JSON.stringify(home)).not.toContain("検証済み");
  expect(personalHome(context("PHARMACIST", null), null)).toMatchObject({ title: "予定されている勤務はありません", detail: "公開版 — にあなたの勤務はありません", when: "—", countdown: "" });
});

test("a publication whose input changed is said to need revalidation", () => {
  const home = teamHome(context("LEADER", { ...publication, validation_status: "revalidation_required" }), nothing);
  expect(home.sealTime).toBe("要再検証");
  expect(home.metrics.find((m) => m.label === "検証")).toMatchObject({ value: "再検証が必要", tone: "warn" });
});

test("a pharmacist sees their next duty and how many published duties are theirs", () => {
  const own = { ...publication, assignments: publication.assignments.filter((d) => d.person_id === "p-self") };
  const home = personalHome(context("PHARMACIST", own), null);
  expect(home).toMatchObject({ title: "10月13日（火） 08:30–17:15", detail: "中央病棟 · 日勤 · 調剤", when: "明日", countdown: "出勤まで 12時間" });
  expect(home.metrics).toEqual([{ label: "公開版の自分の勤務", value: "1件", detail: "公開版 v2" }]);
  // During the duty it is "now"; after its end it is no longer the next one.
  expect(personalHome(context("PHARMACIST", own, "2026-10-13T09:00:00+09:00"), null)).toMatchObject({ when: "今日", countdown: "勤務中" });
  expect(personalHome(context("PHARMACIST", own, "2026-10-13T18:00:00+09:00"), null).title).toBe("予定されている勤務はありません");
});

test("the calendar's duties are used only when it is of the publication on screen", () => {
  const later = duty("d9", "p-self", "2026-10-15T08:30:00+09:00", "2026-10-15T17:15:00+09:00");
  expect(personalHome(context("PHARMACIST"), calendar({ assignments: [later] })).title).toBe("10月15日（木） 08:30–17:15");
  const other = calendar({ assignments: [later], publication: { publication_id: "pub-1", version: 1, period: publication.period, input_hash: "h", created_at: "x" } });
  expect(personalHome(context("PHARMACIST"), other).title).toBe("10月13日（火） 08:30–17:15");
});

test("the queue counts open cases by state and lists the consents asked of the viewer", () => {
  const row = (id: string, status: string, asks: string[] = []): ScheduleChangeCase => ({
    case_id: id, scope_id: "s", publication_id: "pub-2", kind: "SWAP", status, version: 1, affected_assignments: [], proposed_assignments: [],
    validation: { required_consent_person_ids: asks, consented_person_ids: [] }, evidence: {}, created_by: "", created_at: "", updated_at: "",
  });
  const queue = homeQueue([row("a", "READY"), row("b", "AWAITING_CONSENT", ["p-self"]), row("c", "AWAITING_CONSENT", ["p-other"]), row("d", "DRAFT"), row("e", "APPROVED"), row("f", "WITHDRAWN")], "p-self");
  expect(queue.counts).toEqual({ READY: 1, AWAITING_INDEPENDENT_APPROVAL: 0, AWAITING_CONSENT: 2, DRAFT: 1 });
  expect(queue.asked.map((c) => c.case_id)).toEqual(["b"]);
});
