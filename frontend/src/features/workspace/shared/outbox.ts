// What the server's count of records "not delivered yet" is, in words, for every view that
// shows it (the first screen and same-day operations).
//
// The figure is every row of the planning outbox of the scope whose `delivered_at` is empty
// (api/routers/workflows.py, daily_operations: no filter by kind), and for a pharmacist the
// rows that name them. The outbox holds one event for every recorded operation
// (application/audit_timeline.py), so the rows are not only notifications: generating
// candidates, saving a draft, an administrative record and so on are among them. A row is
// marked delivered when the audit delivery has sent it to its receiver
// (application/outbox.py, deliver_batch). No screen sends anything: the delivery is run by
// operations, which watch for a backlog (ops/reviewed-planning.md, 監査配送停止).

/** The name of the figure. */
export const PENDING_DELIVERY = "送信待ちの記録";

/** What it counts: `department` for a planner (the scope's rows), otherwise the viewer's own. */
export const pendingDeliveryDetail = (department: boolean): string => department
  ? "監査の送付先へまだ送られていない操作の記録（通知を含む・部署全体）"
  : "監査の送付先へまだ送られていない、あなたに関わる操作の記録（通知を含む）";

/** Who acts on it: nobody on a screen. */
export const PENDING_DELIVERY_WHO = "「送信待ちの記録」は、通知に限らず、操作のたびに残る記録のうち、監査の送付先へまだ送られていないものの件数です。送付は運用の処理が行い、滞留は運用の手順で監視します。この画面に、送付の操作はありません。";
