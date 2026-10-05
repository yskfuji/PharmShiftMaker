export const CATEGORY: Record<string, string> = { change: "欠勤・交換", membership: "紐付け", lifecycle: "入職・退職", schedule: "計画・公開", request: "申請", compliance: "管理記録", privacy: "個人情報", other: "その他" };

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
  "lifecycle.created": "入退職手続きを開始",
  "lifecycle.task_completed": "入退職タスクを完了",
};

const ACTION: Record<string, string> = {
  created: "を作成", updated: "を更新", approved: "を承認", rejected: "を却下",
  imported: "を取込", corrected: "を訂正", published: "を公開", cancelled: "を取消",
  completed: "を完了", read: "を確認", erased: "を消去",
};

/** A readable name for a recorded event kind; an unknown kind is named by its area. */
export function eventLabel(kind: string): string {
  if (EVENT_LABEL[kind]) return EVENT_LABEL[kind];
  const [area, action] = kind.split(".");
  return `${CATEGORY[area] ?? "管理記録"}${ACTION[action] ?? "を記録"}`;
}
