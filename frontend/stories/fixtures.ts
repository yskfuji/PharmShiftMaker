// Synthetic answers for stories only (no real facility, staff or evidence).
export const EVIDENCE = { reference: '合成の原本（評価用）', status: 'verified', verified_by: '合成人事担当', valid_until: null };

export const scopes = [{ scope_id: 'hospital/pharmacy', role: 'ADMIN', person_id: 'p0' }];

const future = '2027-01-01';
export const adoption = (status: 'registered' | 'confirmed' | 'withdrawn', created_by = 'admin') => ({
  adoption_id: 'flex-1', employer_id: 'hospital', establishment_id: 'site-hospital',
  start: `${future}T00:00:00+09:00`, end: '2029-01-01T00:00:00+09:00', target_scope: '薬剤部の常勤の薬剤師（合成）',
  settlement_months: 1, settlement_anchor: future, total_hours_rule: 'statutory_frame',
  agreed_total_description: '清算期間の暦日数 ÷ 7 × 40時間', standard_day_seconds: 28800,
  flexible_time: [{ start: '07:00', end: '20:00' }], core_time: [{ start: '10:00', end: '15:00' }],
  work_rules_evidence: EVIDENCE, agreement_evidence: EVIDENCE, status, created_by, created_at: '2026-09-28T00:00:00Z',
  ...(status === 'confirmed' ? { reviewed_by: 'leader', reviewed_at: '2026-09-28T01:00:00Z' } : {}),
});

export const listing = (over: Record<string, unknown> = {}) => ({
  viewer: 'admin', can_manage: true, manage_refusal: null, adoptions: [], enrollments: [],
  establishments: [{ establishment_id: 'site-hospital', employer_id: 'hospital', start: '2024-12-01T00:00:00+09:00', end: '2029-01-01T00:00:00+09:00' }],
  people: [{ person_id: 'p0', name: '合成職員A' }, { person_id: 'p1', name: '合成職員B・長い氏名の表示確認' }],
  ...over,
});

export const impact = {
  adoption_id: 'flex-1', status: 'registered',
  people: [{ person_id: 'p0', enrollment_id: 'enr-p0', start: `${future}T00:00:00+09:00`, status: 'registered', employment_revisions: ['emp-A'] }],
  timed_duties: [{ scope_id: 'hospital/pharmacy', duty_id: 'd1', person_id: 'p0', start: `${future}T09:00:00+09:00` }],
  blocking: [], next_steps: ['参加者ごとに、参加の開始日から始まるフレックスタイム制の雇用条件を登録する'],
  impact_hash: 'a'.repeat(64),
};

/** The signed-in account shown in the page frame (GET /auth/me), synthetic. */
export const identityRoute = { path: '/auth/me', body: { user_id: 'synthetic-admin', display_name: '合成管理者', global_role: 'ADMIN', identifier_kind: 'login_id' } };
