// A value the server sends as a code, as the workspace's views name it. The rule for a code
// no map knows: it is shown as 「未対応の値」 and never as the code itself or as a
// neighbouring state. The names of recorded events and of their areas are kept here: every
// purpose that shows an event (the audit, a notification, a publication's notices) reads
// them from this module, and this module reads none of theirs.
import { CASE_STATUS } from "@/ideal/live/format";

export { CASE_STATUS };

/** What a view shows for a code that has no label. */
export const UNKNOWN_VALUE = "未対応の値";

/** The label of `value` in `map`; 「未対応の値」 when the map does not have it. */
export function labelOf(map: Readonly<Record<string, string>>, value: unknown): string {
  return typeof value === "string" && Object.hasOwn(map, value) ? map[value] : UNKNOWN_VALUE;
}

/** The state of a schedule-change case in words. */
export const caseStatusLabel = (status: unknown): string => labelOf(CASE_STATUS, status);

/** The area the server sorts a recorded event or a notification into (`category`), in
 * words: the seven areas of `audit_timeline.CATEGORIES` and its 「その他」 for the rest. */
export const CATEGORY: Record<string, string> = { change: "欠勤・交換", membership: "紐付け", lifecycle: "入職・退職", schedule: "計画・公開", request: "申請", compliance: "管理記録", privacy: "個人情報", other: "その他" };

/** What the first part of a recorded kind is about. The server knows sixteen such parts and
 * sorts them into its seven areas (`draft.`, `job.`, `input.` and `candidates.` into
 * 計画・公開, `leave.` into 申請, `actual.` into 管理記録, `copy.`, `erasure.` and
 * `retention.` into 個人情報); here each has its own word, so 「勤務案を作成」 is not said
 * as 「計画・公開を作成」. */
const SUBJECT: Record<string, string> = {
  change: "欠勤・交換", membership: "紐付け", lifecycle: "入職・退職",
  schedule: "計画・公開", draft: "勤務案", job: "候補生成の処理", input: "勤務入力", candidates: "勤務候補",
  request: "申請", leave: "休暇",
  compliance: "管理記録", actual: "勤務実績",
  privacy: "個人情報", copy: "コピー", erasure: "消去", retention: "保存規則",
};

/** Single kinds with their own wording. Every key is a kind the server emits
 * (tests/test_workspace_v3_labels.py compares them with its code): the lifecycle kinds are
 * `lifecycle.onboard.created`, `lifecycle.offboard.created` and `lifecycle.task.completed`
 * (application/ideal_workflows.py). */
const EVENT_LABEL: Record<string, string> = {
  "compliance.scope_setting": "欠勤同意設定を変更",
  "schedule.published": "勤務表を公開",
  "schedule.cancelled": "公開版を取り消し",
  "change.absence.created": "欠勤ケースを登録",
  "change.swap.created": "勤務交換を申請",
  "change.absence.consented": "欠勤の代替勤務に同意",
  "change.swap.consented": "勤務交換に同意",
  "change.absence.declined": "欠勤の代替勤務を辞退",
  "change.swap.declined": "勤務交換を辞退",
  "change.recommended": "変更ケースを承認候補として推薦",
  "change.approved": "変更ケースを承認",
  "change.rejected": "変更ケースを却下",
  "change.withdrawn": "変更申請を取り下げ",
  "membership.linked": "本人アカウントを紐付け",
  "membership.deactivated": "本人アカウントの紐付けを無効化",
  "lifecycle.onboard.created": "入職の手続きを開始",
  "lifecycle.offboard.created": "退職の手続きを開始",
  "lifecycle.task.completed": "入退職タスクを完了",
};

const ACTION: Record<string, string> = {
  created: "を作成", updated: "を更新", approved: "を承認", rejected: "を却下",
  imported: "を取込", corrected: "を訂正", published: "を公開", cancelled: "を取消",
  completed: "を完了", read: "を確認", erased: "を消去",
};

const EVENT_KIND = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const WRITTEN = /[぀-ヿ㐀-鿿]/;

/**
 * The name of an event for reading, from its kind and from the area (`category`) the
 * server returned with it.
 * - A recorded kind ("schedule.published") with its own wording has that wording.
 * - Another kind whose first part is known is named by that part and its action
 *   ("privacy.erased": 個人情報を消去; an action this code does not know is 「を記録」,
 *   which every event is).
 * - A kind whose first part this code does not know (the server has added one) is named by
 *   the server's area: 「計画・公開」. It is never named as a record of another area.
 * - A notification can carry a sentence already written for a reader in place of a kind; it
 *   is shown as it is.
 * - Only when neither the kind nor the area is known is it 「未対応の値」. The code itself
 *   is never shown.
 */
export function eventLabel(kind: unknown, category?: unknown): string {
  const area = typeof category === "string" && Object.hasOwn(CATEGORY, category) ? CATEGORY[category] : UNKNOWN_VALUE;
  if (typeof kind !== "string" || !kind.trim()) return area;
  if (Object.hasOwn(EVENT_LABEL, kind)) return EVENT_LABEL[kind];
  if (!EVENT_KIND.test(kind)) return WRITTEN.test(kind) ? kind : area;
  const [subject, action] = kind.split(".");
  if (!Object.hasOwn(SUBJECT, subject)) return area;
  return `${SUBJECT[subject]}${Object.hasOwn(ACTION, action) ? ACTION[action] : "を記録"}`;
}
