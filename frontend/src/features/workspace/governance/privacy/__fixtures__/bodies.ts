// The request bodies the established privacy screens sent for the entries the tests make.
// They were recorded from those screens when this route replaced them, and are what the
// rebuilt tasks must send for the same entries (the idempotency key apart).
export const UUID = "11111111-2222-4333-8444-555555555555";
export const PEOPLE = [{ person_id: "p1", name: "合成 一" }, { person_id: "p2", name: "合成 二" }];

export const REQUEST = { payload: { person_id: "p1", kind: "erase", reason: "合成の消去請求" }, expected_revision: 0 };
const identity = { reference: "本人確認資料", status: "verified", verified_by: "確認者" };
export const DECISION = { payload: { expected_revision: 2, status: "APPROVED", reason: "判断理由", result_reference: null, identity_evidence: identity }, expected_revision: 2 };
export const COMPLETION = { payload: { expected_revision: 3, status: "COMPLETED", reason: "判断理由", result_reference: "結果資料", identity_evidence: identity }, expected_revision: 3 };

export const POLICY = { category: "planning_history", purpose: "編集開始目的", anchor: "period_end", retention_days: 30, legal_minimum_days: 0, effective_from: "2026-01-01", effective_until: "2027-01-01", owner: "管理者", next_review: "2026-12-01", evidence: { reference: "原本", status: "unverified", verified_by: null } };
export const RULE = { payload: { ...POLICY, purpose: "改定後の目的", evidence: { reference: "原本", status: "verified", verified_by: "確認者" } }, expected_revision: 1 };
export const NEW_RULE = { payload: { category: "exports", purpose: "出力物の管理", anchor: "last_activity", retention_days: 90, legal_minimum_days: 30, effective_from: "2026-04-01", effective_until: "2028-04-01", owner: "管理者", next_review: "2027-04-01", evidence: { reference: "規程第3条", status: "unverified", verified_by: null } }, expected_revision: 0 };

export const HOLD = { hold_id: "hold1", person_id: "p1", revision: 1, active: true, payload: { reason: "当初の理由" } };
export const NEW_HOLD = { payload: { person_id: "p1", active: true, reason: "係争の保全" }, expected_revision: 0 };
export const DEPARTMENT_HOLD = { payload: { person_id: null, active: true, reason: "係争の保全" }, expected_revision: 0 };
export const HOLD_RELEASE = { payload: { hold_id: "hold1", person_id: "p1", active: false, reason: "解除の理由" }, expected_revision: 1 };

export const CONTROL = { expected_revision: 0, case_id: "case-1", case_revision: 1, reason: "承認を照合して制御する" };
export const PLAN = { expected_revision: 1 };
export const PLAN_ANSWER = { plan_id: "plan", revision: 1, fingerprint: "a".repeat(64), all_copies_erased: false };
export const PLAN_EXECUTION = { expected_revision: 1, plan_id: "plan", plan_revision: 1, fingerprint: "a".repeat(64) };

export const JOINT_SOURCE = {
  copy_id: "copy1", revision: 7, source_hash: "1".repeat(64), context_hash: "2".repeat(64), requires_explicit_review: true,
  context: { owners: ["p1", "p2"], participants: [{ person_id: "p1", case_id: "case1", case_revision: 3, case_hash: "a", control_hash: "b", case_reason: "本人一の承認" }, { person_id: "p2", case_id: "case2", case_revision: 4, case_hash: "c", control_hash: "d", case_reason: "本人二の承認" }], policy_key: "policy", policy_revision: 5, policy_hash: "e", policy_purpose: "期限満了の共有記録" },
};
export const JOINT = { expected_revision: 7, source_hash: "1".repeat(64), context_hash: "2".repeat(64), shared_text_reviewed: true, reason: "照合済みの判断", evidence: { reference: "原本資料", verified_by: "責任者", status: "verified" } };

export const BACKFILL_PREVIEW = { preview_hash: "f".repeat(64), changes: [{ copy_id: "copy-db", revision: 2, additional_person_ids: ["p2"] }], unresolved_copy_ids: ["copy-unknown"] };
export const BACKFILL = { payload: { preview_hash: "f".repeat(64) }, expected_revision: 0 };

export const COPY_PREVIEW = { payload: { person_id: "p1" }, expected_revision: 0 };
export const COPY_PLAN = {
  plan_id: "plan-1", fingerprint: "b".repeat(64), revision: 1, person_id: "p1",
  targets: [
    { copy_id: "db1", revision: 2, medium: "database", state: "PRESENT", blockers: [], expires_at: "2026-01-01T00:00:00+00:00", will_process: true },
    { copy_id: "ext1", revision: 4, medium: "external", state: "PRESENT", blockers: ["external_confirmation_required"], expires_at: null, will_process: false },
    { copy_id: "copy1", revision: 1, medium: "file", state: "PRESENT", blockers: ["shared_copy_requires_separate_preservation_decision"], expires_at: null, preservation: { payload_hash: "hash2" }, will_process: false },
  ],
  unverified_copies: ["unknown-1"], database_records_remaining: ["retained-1", "retained-2"],
  database_inventory: { control_records_remaining: [{ table: "erased_subjects", object: "erased_subjects:p1", subject_relation: "person_or_plan_reference", purpose: "再作成の防止", retention_status: "RULE_MISSING", reason: "保存規則が必要です。" }] },
};
export const EXTERNAL_CONFIRMATION = { payload: { copy_id: "ext1", evidence: { reference: "処理確認書", status: "verified", verified_by: "担当者" } }, expected_revision: 4 };
export const COPY_EXECUTION = { payload: { plan_id: "plan-1", fingerprint: "b".repeat(64) }, expected_revision: 1 };

export const PROJECTION = { copy_id: "copy1", revision: 1, source_digest: "hash1", payload_hash: "hash2", person_ids: ["p2"], payload: { archive_format: "partial", replayable: false, retained: { people: [{ person_id: "p2", name: "合成 二" }], note: "共通の注記" }, removed_counts: { people: 1, duties: 0 } } };
export const PRESERVATION = { payload: { copy_id: "copy1", person_id: "p1", content_hash: "hash1", projection_hash: "hash2", shared_text_reviewed: true, evidence: { reference: "保全根拠", verified_by: "確認者", status: "verified" } }, expected_revision: 1 };

const registration = { copy_id: UUID, category: "exports", medium: "external", relative_path: "給与担当の隔離保管", content_hash: "07".repeat(32), person_ids: ["p1"], anchor: "last_activity", anchor_at: "2026-09-01T00:00:07.000Z" };
export const REGISTRATION = { payload: { ...registration, subject_status: "UNVERIFIED", evidence: { reference: "合成受渡し記録", status: "unverified", verified_by: null } }, expected_revision: 0 };
export const VERIFIED_REGISTRATION = { payload: { ...registration, subject_status: "VERIFIED", evidence: { reference: "合成受渡し記録", status: "verified", verified_by: "確認者" } }, expected_revision: 0 };

// The erasure of a superseded planning input (the established screen held it in a branch
// no route showed; the bodies are the ones that branch sent).
export const INPUT_HASH = "a".repeat(64);
export const INPUT_PREVIEW = { payload: { input_hash: INPUT_HASH }, expected_revision: 0 };
export const INPUT_PLAN = {
  plan_id: "erasure-plan", fingerprint: "c".repeat(64), erasable: true, input_hash: INPUT_HASH, scope_id: "hospital/pharmacy", rule_key: "rule",
  targets: [{ table: "planning_outbox", key: "event-1", hash: "h1" }, { table: "planning_drafts", key: "draft-1", hash: "h2" }, { table: "planning_drafts", key: "draft-2", hash: "h3" }, { table: "planning_inputs", key: INPUT_HASH, hash: "h4" }],
  blockers: [] as string[], irreversible: true, limitations: ["保全台帳・バックアップ内の識別子は別の保存規則で管理します。", "匿名加工情報を生成する操作ではありません。"],
};
export const INPUT_EXECUTION = { payload: { plan_id: "erasure-plan", fingerprint: "c".repeat(64) }, expected_revision: 0 };
