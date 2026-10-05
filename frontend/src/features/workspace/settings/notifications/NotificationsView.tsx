import { stamp } from "@/ideal/live/format";
import type { WorkspaceNotification } from "@/ideal/types";
import MarkRead from "./MarkRead";

/** The viewer's own notifications, newest first as the server returns them. `null`: they
 * could not be read, so nothing is claimed about them. */
export default function NotificationsView({ data: items }: { data: WorkspaceNotification[] | null }) {
  return <section className="ideal-panel" aria-labelledby="notification-title"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">本人宛て</span><h2 id="notification-title">通知</h2></div></div>{!items ? <p className="ideal-note">通知を確認できません。</p> : items.length ? <ol className="ideal-timeline">{items.map((item) => <li key={item.event_id}><span /><div><strong>{item.kind}</strong><p>{item.publication_id ? `公開版 ${item.version ?? "—"}` : item.category}</p>{!item.read && <MarkRead eventId={item.event_id} />}</div><time dateTime={item.created_at}>{stamp(item.created_at)}</time></li>)}</ol> : <p className="ideal-note">未確認の通知はありません。</p>}</section>;
}
