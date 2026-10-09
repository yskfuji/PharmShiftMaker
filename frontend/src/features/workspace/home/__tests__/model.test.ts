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
const nothing = { dashboard: null, daily: null, stability: null, cases: [] };
const calendar = (over: Partial<ScheduleCalendarView>): ScheduleCalendarView => ({
  scope_id: "hospital/pharmacy", requested_period: "2026-10", visibility: "self",
  publication: { publication_id: "pub-2", version: 2, period: publication.period, input_hash: "h", created_at: "2026-10-10T00:00:00+09:00" },
  previous_publication: null, assignments: [], changes: [], can_export_department: false, limitations: [], ...over,
});

test("the home holds only what the API returned: no stability or coverage figures", () => {
  const home = teamHome(context("LEADER"), nothing);
  expect(home.stability).toBeNull();
  // The heading is today; the publication on screen is the frame's to say, and is not repeated.
  expect(home.heading).toBe("2026年10月12日（月）");
  expect(home.publication).toBeNull();
  expect(JSON.stringify(home)).not.toContain("公開版");
  expect(home.metrics.map((m) => [m.label, m.value, m.detail])).toEqual([
    ["本日の予定勤務", "—", "当日情報を確認できません"],
    ["今日の勤務に関わるケース", "—", "当日情報を確認できません"],
    ["確認待ちの申請", "—", "申請の集計を確認できません"],
    ["送信待ちの記録", "—", "当日情報を確認できません"],
  ]);
});

test("each of today's counts is named by what the server counted, and the two sources are not mixed", () => {
  const dashboard = { scope_id: "s", period: "2026-10", role: "LEADER", visibility: "department" as const, observed_at: "x", sources: [], metrics: { pending_requests: { value: 4, state: "available" as const, reason: null } } };
  const daily = { scope_id: "s", day: "2026-10-12", observed_at: "x", visibility: "department" as const, scheduled_assignments: [], scheduled_count: 7, open_case_count: 2, absence_case_count: 1, coverage_finding_count: 0, undelivered_notification_count: 3, limitations: [] };
  // Without the daily snapshot the cases of the day are not replaced by the pending requests.
  const withoutDaily = teamHome(context("LEADER"), { ...nothing, dashboard }).metrics;
  expect(withoutDaily.map((m) => m.value)).toEqual(["—", "—", "4件", "—"]);
  const metrics = teamHome(context("LEADER"), { ...nothing, dashboard, daily }).metrics;
  expect(metrics.map((m) => [m.label, m.value, m.detail])).toEqual([
    ["本日の予定勤務", "7件", "在席・出勤実績ではありません"],
    ["今日の勤務に関わるケース", "2件", "進行中の欠勤・交換のうち、今日の勤務が対象のもの"],
    ["確認待ちの申請", "4件", "2026年10月にかかる申請だけの件数（休暇の画面は全期間の申請を表示）"],
    ["送信待ちの記録", "3件", "監査の送付先へまだ送られていない操作の記録（通知を含む・部署全体）。送付は運用の処理が行います"],
  ]);
  // A figure leads to the route that shows what it counts; one that no route shows in more detail leads nowhere.
  expect(metrics.map((m) => m.link)).toEqual(["today", "cases", "leave", undefined]);
  // A count the dashboard could not make says why, in the server's words.
  const unknown = { ...dashboard, metrics: { pending_requests: { value: null, state: "unknown" as const, reason: "申請の対象期間を確認できません。" } } };
  expect(teamHome(context("LEADER"), { ...nothing, dashboard: unknown }).metrics[2]).toMatchObject({ value: "—", detail: "申請の対象期間を確認できません。" });
});

test("what waits for the viewer is said in one sentence, from the cases the server returned", () => {
  const open = (id: string, status: string, asks: string[] = []): ScheduleChangeCase => ({
    case_id: id, scope_id: "hospital/pharmacy", publication_id: "pub-2", kind: "SWAP", status, version: 1, affected_assignments: [], proposed_assignments: [],
    validation: { findings: [], publishable: true, required_consent_person_ids: asks, consented_person_ids: [] }, evidence: {}, created_by: "", created_at: "", updated_at: "",
  });
  const needs = (cases: ScheduleChangeCase[] | null) => teamHome(context("LEADER"), { ...nothing, cases }).needs;
  expect(needs([])).toBe("あなたへの依頼も、承認を待つケースもありません。");
  expect(needs([open("a", "AWAITING_CONSENT", ["p-self"])])).toBe("あなたへの同意の依頼が1件あります。");
  expect(needs([open("a", "AWAITING_CONSENT", ["p-self"]), open("b", "READY"), open("c", "AWAITING_INDEPENDENT_APPROVAL"), open("d", "AWAITING_CONSENT", ["p-other"])])).toBe("あなたへの同意の依頼が1件、承認を待つケースが2件あります。");
  // Cases that could not be read: nothing is claimed about them.
  expect(needs(null)).toBe("");
});

test("recent changes are the server's own figures and its own explanation", () => {
  const stability = { scope_id: "s", observed_at: "x", window_days: 14, publication_count: 2, change_event_count: 5, days: [{ day: "2026-10-11", change_count: 2 }, { day: "2026-10-10", change_count: 0 }], meaning: "記述統計です。" };
  expect(teamHome(context("ADMIN"), { ...nothing, stability }).stability).toEqual({ value: "5件", label: "公開 2回", window: "過去14日間", changes: [{ day: "10月11日（日）", count: "2件" }], note: "記述統計です。" });
});

test("without a publication nothing is invented", () => {
  const home = teamHome(context("ADMIN", null), nothing);
  expect(home.publication).toBe("2026年10月の公開済みの勤務表は、まだありません。");
  // no verification claim without a publication
  expect(JSON.stringify(home)).not.toContain("検証済み");
  expect(personalHome(context("PHARMACIST", null), null)).toMatchObject({ title: "予定されている勤務はありません", detail: "公開版 — にあなたの勤務はありません", when: "—", countdown: "" });
});

test("a publication whose input changed is said to need revalidation, and only then is it named", () => {
  const home = teamHome(context("LEADER", { ...publication, validation_status: "revalidation_required" }), nothing);
  expect(home.publication).toBe("公開版 v2 は再検証が必要です。公開した後に、もとになった記録が変わっています。");
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
