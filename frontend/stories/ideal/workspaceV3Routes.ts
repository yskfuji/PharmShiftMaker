import type { FetchRoute } from "../../.storybook/fetchMock";

const period = { start: "2026-10-01T00:00:00+09:00", end: "2026-11-01T00:00:00+09:00" };
const people = [
  { person_id: "synthetic-admin", name: "佐藤 美咲" },
  { person_id: "synthetic-leader", name: "鈴木 悠斗" },
  { person_id: "synthetic-pharmacist", name: "高橋 葵" },
];
const assignments = [
  { duty_id: "synthetic-duty-1", person_id: "synthetic-pharmacist", kind: "日勤", task: "病棟", location: "本館", start: "2026-10-12T08:30:00+09:00", end: "2026-10-12T17:30:00+09:00" },
  { duty_id: "synthetic-duty-2", person_id: "synthetic-leader", kind: "遅番", task: "調剤", location: "薬剤部", start: "2026-10-12T10:30:00+09:00", end: "2026-10-12T19:30:00+09:00" },
];
const publication = { publication_id: "synthetic-publication-12", version: 12, period: `${period.start}|${period.end}`, input_hash: "synthetic-input-12", assignments, validation_status: "verified_at_publication" };
const input = { input_hash: "synthetic-input-12", input_revision: 12, publication_version: 12, stale: false, snapshot: { schema_version: 3, period, people, contracts: [], candidates: assignments, leaves: [], employments: [], demands: [], facility_id: "synthetic", department_id: "clinical-pharmacy" } };
const workflow = { input_hash: input.input_hash, role: "ADMIN", people, contracts: [], employments: [], establishments: [], capabilities: [], duty_options: [{ kind: "日勤", task: "病棟", location: "本館" }], records: [], publications: [publication], actuals: [], can_correct_actuals: true };

/** Synthetic responses for the exact production feature components used by v3 stories. */
export const workspaceV3Routes: FetchRoute[] = [
  { path: "/planning/change-cases", body: [] },
  { path: "/planning/daily-operations", body: { scope_id: "synthetic/clinical-pharmacy", day: "2026-10-12", observed_at: "2026-10-12T08:16:00+09:00", visibility: "department", scheduled_assignments: assignments, scheduled_count: assignments.length, open_case_count: 0, absence_case_count: 0, coverage_finding_count: 0, undelivered_notification_count: 1, limitations: ["予定上の勤務であり、在席実績ではありません。"] } },
  { path: "/planning/notifications", body: [{ event_id: "notice-1", category: "schedule", kind: "公開版が更新されました", publication_id: publication.publication_id, version: 12, read: false, created_at: "2026-10-12T07:42:00+09:00" }] },
  { path: "/planning/inputs/latest", body: input },
  { path: /\/planning\/drafts\/synthetic-draft-[123]$/, body: { draft_id: "synthetic-draft-1", input_hash: input.input_hash, version: 1, review_hash: null, status: "DRAFT", proposal: { duty_ids: assignments.map((item) => item.duty_id), leave_ids: [] } } },
  { path: "/planning/plan-comparison", body: { input_hash: input.input_hash, plans: [1, 2, 3].map((number) => ({ draft_id: `synthetic-draft-${number}`, findings: { violation: 0, unverified: 0, unsupported: 0 }, publishable: true, changes_from_previous: 10 + number, changes_from_publication: 10 + number, preference_cost: number, preferences_met: 9 + number, preferences_total: 12, work_seconds_total: 288000, work_seconds_spread: 1800 * number, assignment_count: assignments.length, proposal_hash: `synthetic-${number}`, duplicate_of: null, solver: { job_id: `job-${number}`, status: "FEASIBLE", random_seed: number - 1, objective_by_level: [], proven_levels: 2 } })), pairs: [{ a: "synthetic-draft-1", b: "synthetic-draft-2", differing_duties: 2, affected_people: 2 }], order: ["synthetic-draft-1", "synthetic-draft-2", "synthetic-draft-3"], order_rule: "違反、変更数、希望、勤務時間差の順", meaning: "合成総合点は使用せず、同じサーバー定義の数値だけを比較します。" } },
  { path: "/planning/inputs", body: [{ input_hash: input.input_hash, period, stale: false }] },
  { path: "/planning/publications", body: [publication] },
  { path: "/planning/scopes", body: [{ scope_id: "synthetic/clinical-pharmacy", person_id: "synthetic-admin", role: "ADMIN", input_revision: 12 }] },
  { path: "/planning/memberships", body: [
    { membership_id: "synthetic-admin-membership", issuer: "mock", subject: "synthetic-admin", person_id: "synthetic-admin", scope_id: "synthetic/clinical-pharmacy", role: "ADMIN", active: true, revision: 1 },
    { membership_id: "synthetic-pharmacist-membership", issuer: "mock", subject: "synthetic-pharmacist", person_id: "synthetic-pharmacist", scope_id: "synthetic/clinical-pharmacy", role: "PHARMACIST", active: true, revision: 1 },
  ] },
  { path: "/planning/lifecycle-cases", body: [{ case_id: "lifecycle-1", person_id: "synthetic-pharmacist", kind: "ONBOARD", effective_date: "2026-10-01", status: "IN_PROGRESS", version: 2, tasks: [{ key: "contract", source: "SYSTEM", status: "COMPLETED", can_complete: false, completed_at: "2026-10-01T09:00:00+09:00", blocked_reason: null }, { key: "balance_review", source: "MANUAL", status: "PENDING", can_complete: true, completed_at: null, blocked_reason: null }] }] },
  { path: "/planning/scope-settings", body: { scope_id: "synthetic/clinical-pharmacy", absence_replacement_consent: { enabled: false, revision: 2, history: [{ revision: 2, enabled: false, reason: "運用確認", reference: "SYNTHETIC-2", actor: "ADMIN", at: "2026-10-01T09:00:00+09:00" }] } } },
  { path: "/planning/audit-timeline", body: { entries: [{ at: "2026-10-12T07:42:00+09:00", category: "schedule", kind: "schedule.published", actor_role: "LEADER", subject_count: 3, version: 12 }], next_cursor: null, limits: ["氏名・職員IDは表示しません。"] } },
  { path: "/planning/compliance/recovery-status", body: { state: "REPLAYED", manifest_hash: "synthetic-manifest-sha256", note: "隔離復旧演習で消去制御を再適用しました。" } },
  { path: "/planning/compliance/records", body: [] },
  { path: "/planning/compliance/privacy", body: { people, rules: [], holds: [], cases: [] } },
  { path: "/planning/compliance/leave-report", body: { balances: [], obligations: [], findings: [] } },
  { path: "/planning/compliance/workflow-context", body: workflow },
  { path: "/planning/compliance/declaration-context", body: { people, employers: [], establishments: [], declarations: [] } },
  { path: "/planning/compliance/copies/context", body: { people } },
  { path: "/planning/compliance/grant-assessments/context", body: { accounts: [], candidates: [], findings: [] } },
  { path: "/planning/compliance/flex-adoptions", body: { viewer: "admin", scopes: [{ scope_id: "synthetic/clinical-pharmacy", role: "ADMIN" }], establishments: [], adoptions: [], consents: [], settlements: [], histories: [] } },
  { path: "/planning/requests", body: [] },
  { path: "/planning/leave-balances", body: [] },
];
