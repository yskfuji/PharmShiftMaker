// Personal-data requests, retention rules, holds and copies as the privacy route lists and
// names them. Display and entry only: which decision a request accepts next, which decision
// a person control accepts, what can be erased and why something stays are the server's
// answers and are passed through as it gives them. The label tables translate the server's
// codes for reading; nothing is decided from a code.
import type { Fact } from "../../shared/records/facts";
import type { CaseDecision, CopyInventory, CopyTarget, LegalHold, Named, PrivacyCase, PrivacyListing, RetentionPolicy, RetentionRule } from "../api";

/** What the route keeps of its one read, as plain data (it crosses from the server read to
 * the client islands). */
export type PrivacyData = { cases: PrivacyCase[]; rules: RetentionRule[]; holds: LegalHold[]; people: Named[] };

export const privacyOf = (listing: PrivacyListing): PrivacyData => ({
  cases: listing.cases.map((item) => ({
    case_id: item.case_id, revision: item.revision, status: item.status,
    payload: { person_id: item.payload.person_id, kind: item.payload.kind, reason: item.payload.reason, decision_history: item.payload.decision_history ?? [] },
    allowed_next: item.allowed_next, result_reference_required: item.result_reference_required,
  })),
  rules: listing.rules, holds: listing.holds, people: listing.people,
});

/** The `id` of the task that decides a request: the header's count leads to it. It is
 * declared here, outside the client island, so that the route's Server Component and the
 * island read the same plain string. */
export const DECIDE_TASK = "privacy-task-decide";

const NONE = "（なし）";
const labelOf = (table: Record<string, string>) => (code: string) => table[code] ?? code;

export const KINDS: Record<string, string> = { access: "開示", rectify: "訂正", restrict: "利用停止", erase: "消去" };
export const kindLabel = labelOf(KINDS);
export const statusLabel = labelOf({ REQUESTED: "受付", VERIFIED: "本人確認済み", APPROVED: "実施承認", COMPLETED: "実施完了", REJECTED: "理由を付して不承認", RELEASED: "利用停止を解除" });
/** The stage of a request as a tone, by its status code: a table fixed here, never worked
 * out from what the request allows next. A stage is always said in words as well; the
 * tone only keeps two different stages from looking the same. Unknown codes are neutral. */
const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "info"> = { REQUESTED: "warn", VERIFIED: "info", APPROVED: "good", COMPLETED: "neutral", REJECTED: "neutral", RELEASED: "neutral" };
export const statusTone = (code: string) => STATUS_TONE[code] ?? "neutral";
export const CATEGORIES: Record<string, string> = { planning_history: "勤務表と入力履歴", compliance: "契約・勤務・休暇の管理記録", identity: "本人・アカウント対応", audit: "監査と通知", privacy_cases: "本人対応の記録", exports: "出力物", backups: "バックアップ", control: "消去・保全・復元制御" };
export const categoryLabel = labelOf(CATEGORIES);
export const ANCHORS: Record<string, string> = { period_end: "対象期間の終了", last_activity: "最終更新・受渡し", case_closed: "本人対応の終了", backup_created: "バックアップ作成" };
export const anchorLabel = labelOf(ANCHORS);
export const proofLabel = labelOf({ unverified: "未確認", verified: "確認済み", rejected: "不採用" });
export const mediumLabel = labelOf({ database: "DB記録", backup: "バックアップ", external: "外部コピー", file: "管理ファイル" });
export const controlStateLabel = labelOf({ NOT_APPLIED: "未適用", CONTROL_APPLIED_REMAINS: "適用済み（コピーの残存あり）" });
/** The server's reasons a copy stays, for reading. */
export const blockerLabel = labelOf({
  subject_inventory_unverified: "対象者一覧が未確認", legal_hold: "法的保全中", shared_copy_schema_unsupported: "この共有形式の再構成は未対応",
  shared_copy_requires_separate_preservation_decision: "複数職員を含むため保全判断が必要", joint_review_required: "全所有者の共同判断が必要",
  retention_rule_missing: "保存規則が未登録", retention_rule_unverified_or_stale: "保存規則が未確認または確認期限切れ", retention_not_expired: "保存期限内",
  retention_anchor_mismatch: "保存規則と起算日が一致しません", external_confirmation_required: "管理先の消去確認が必要", external_confirmation_recorded: "管理先の処理確認を記録済み（外部の実物はアプリでは消去できません）",
  file_creation_unfinished: "ファイルの作成が完了していません", retained_database_references: "保存対象の参照元が残っています", cyclic_database_references: "循環参照の保全判断が必要",
  database_locator_unsupported: "未対応のDB記録", database_source_missing: "DB正本との照合が必要", database_erasure_requires_postgresql: "DB消去にはPostgreSQLが必要",
});
/** What the server does with a copy it says it will process, by where it is kept. */
export const processingLabel = labelOf({
  database: "この操作で消去します", file: "消去待ちに登録します（実ファイルはワーカーが消去します）", backup: "消去待ちに登録します（実ファイルはワーカーが消去します）",
  external: "サーバーが処理の対象と答えています（外部の実物は、アプリでは消去できません）",
});

export const nameIn = (people: Named[], personId: string | null): string =>
  personId === null ? "部署全体" : people.find((person) => person.person_id === personId)?.name ?? "氏名未照合の職員";
export const caseLabel = (item: PrivacyCase, people: Named[]) => `${nameIn(people, item.payload.person_id)}・${kindLabel(item.payload.kind)}・${statusLabel(item.status)}（第${item.revision}版）`;
export const nextLabel = (item: PrivacyCase) => (item.allowed_next.length ? item.allowed_next.map(statusLabel).join("、") : "なし");

/** A request as the lines a person reads. */
export const caseFacts = (item: PrivacyCase, people: Named[]): Fact[] => [
  { label: "対象の職員", text: nameIn(people, item.payload.person_id) },
  { label: "請求の種類", text: kindLabel(item.payload.kind) },
  { label: "請求の内容", text: item.payload.reason, verbatim: true },
  { label: "状態", text: statusLabel(item.status) },
];
export const decisionFacts = (decision: Pick<CaseDecision, "status" | "reason" | "result_reference" | "identity_evidence">): Fact[] => [
  { label: "状態", text: statusLabel(decision.status) },
  { label: "判断理由", text: decision.reason, verbatim: true },
  { label: "本人確認の根拠", text: decision.identity_evidence.reference, verbatim: true },
  { label: "本人確認者", text: decision.identity_evidence.verified_by ?? NONE, verbatim: true },
  { label: "実施結果の参照", text: decision.result_reference ?? NONE, verbatim: true },
];

/** The newest revision of each rule (one data kind and one anchor), as the server lists them. */
export function currentRules(rules: RetentionRule[]): RetentionRule[] {
  const newest = new Map<string, RetentionRule>();
  for (const rule of rules) {
    const key = `${rule.payload.category}\n${rule.payload.anchor}`;
    if ((newest.get(key)?.revision ?? 0) < rule.revision) newest.set(key, rule);
  }
  return Array.from(newest.values()).sort((left, right) => (left.payload.category + left.payload.anchor).localeCompare(right.payload.category + right.payload.anchor));
}
export const ruleOf = (rules: RetentionRule[], category: string, anchor: string): RetentionRule | null =>
  currentRules(rules).find((rule) => rule.payload.category === category && rule.payload.anchor === anchor) ?? null;
export const ruleFacts = (policy: RetentionPolicy): Fact[] => [
  { label: "対象データ種別", text: categoryLabel(policy.category) },
  { label: "保存期間の起算", text: anchorLabel(policy.anchor) },
  { label: "利用目的", text: policy.purpose, verbatim: true },
  { label: "保存日数", text: `${policy.retention_days}日` },
  { label: "法定の最低保存日数", text: `${policy.legal_minimum_days}日` },
  { label: "適用開始日", text: policy.effective_from },
  { label: "適用終了日（この日を含まない）", text: policy.effective_until },
  { label: "更新担当者", text: policy.owner, verbatim: true },
  { label: "次回確認日", text: policy.next_review },
  { label: "保存根拠・条項", text: policy.evidence.reference, verbatim: true },
  { label: "保存根拠の状態", text: proofLabel(policy.evidence.status) },
  { label: "保存根拠の確認者", text: policy.evidence.verified_by ?? NONE, verbatim: true },
];

export const holdLabel = (hold: LegalHold, people: Named[]) => `${nameIn(people, hold.person_id)}：${hold.active ? "保全中" : "解除済み"}（第${hold.revision}版）`;
export const holdFacts = (hold: { person_id: string | null; active: boolean; reason: string }, people: Named[]): Fact[] => [
  { label: "保全の対象", text: nameIn(people, hold.person_id) },
  { label: "保全の状態", text: hold.active ? "保全中" : "解除済み" },
  { label: "判断理由", text: hold.reason || NONE, verbatim: true },
];

/** One copy by its place in the server's list and where it is kept. */
export const copyName = (target: CopyTarget, index: number) => `保存物 ${index + 1}（${mediumLabel(target.medium)}）`;
export const blockersText = (target: CopyTarget) => (target.blockers.length ? target.blockers.map(blockerLabel).join("、") : "なし");
type ListedTarget = { target: CopyTarget; index: number };
/**
 * The copies the server says executing would process, and those it says it would not.
 * `stated` is false when the answer does not say it for every copy: nothing is then
 * classified here, and every copy is listed with the server's reasons.
 */
export type TargetSplit = { stated: true; processed: ListedTarget[]; kept: ListedTarget[] } | { stated: false; all: ListedTarget[] };

/** `planned`: the flags of the plan about to be executed, by copy; a copy it does not name
 * is judged by the flag of the inventory itself. Whether a copy is processed is never
 * derived from its reasons. */
export function splitTargets(inventory: CopyInventory, planned?: Array<{ copy_id: string; will_process: boolean }>): TargetSplit {
  const all = inventory.targets.map((target, index) => ({ target, index }));
  const flagOf = (target: CopyTarget): unknown => planned?.find((item) => item.copy_id === target.copy_id)?.will_process ?? target.will_process;
  if (all.some((item) => typeof flagOf(item.target) !== "boolean")) return { stated: false, all };
  return { stated: true, processed: all.filter((item) => flagOf(item.target) === true), kept: all.filter((item) => flagOf(item.target) === false) };
}

/** The lines of an erasure confirmation, as the server's statement allows them to be said. */
export function erasureLines(split: TargetSplit): { changes: Array<{ label: string; before: string; after: string }>; erased: string[]; kept: string[]; unstated: string | null } {
  if (!split.stated) {
    return {
      changes: [{ label: "コピーの処理", before: "保存中", after: "処理するコピーは、実行時にサーバーが決めます（この回答には、コピーごとの区別がありません）" }],
      erased: [],
      kept: split.all.map(({ target, index }) => `${copyName(target, index)}：サーバーの残存理由 ${blockersText(target)}（処理の対象かどうかは、サーバーの回答にありません）`),
      unstated: "サーバーの回答に、コピーごとの処理の対象かどうかがありません。どのコピーが処理されるかは、ここでは示せません。下に、すべてのコピーとサーバーの残存理由を示します。",
    };
  }
  return {
    changes: split.processed.map(({ target, index }) => ({ label: copyName(target, index), before: "保存中", after: processingLabel(target.medium) })),
    erased: split.processed.map(({ target, index }) => `${copyName(target, index)}：${processingLabel(target.medium)}`),
    kept: split.kept.map(({ target, index }) => `${copyName(target, index)}：残ります（サーバーの残存理由 ${blockersText(target)}）`),
    unstated: null,
  };
}
export const inventoryFacts = (inventory: CopyInventory | null): Fact[] => (inventory ? [
  ...inventory.targets.map((target, index) => ({ label: `${copyName(target, index)}の残存理由`, text: blockersText(target) })),
  { label: "人物参照が未確認のコピー", text: `${inventory.unverified_copies.length}件` },
  { label: "DBに残る本人記録", text: `${inventory.database_records_remaining.length}件` },
] : []);
