import type { WorkspaceNotification } from "@/ideal/types";
import type { RouteContext } from "../../shell/routeTypes";
import Stepper from "../Stepper";
import PublicationList from "./PublicationList";

/** The scope's current publications (export and cancellation), and what the viewer was
 * notified of. `notices` is null when they could not be read: then nothing is claimed. */
export default function PublicationsView({ data, ctx }: { data: { notices: WorkspaceNotification[] | null }; ctx: RouteContext }) {
  const notices = data.notices;
  return <div className="ideal-stack">
    <Stepper current={4} />
    <section className="ideal-panel"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">公開履歴</span><h2>公開版と通知</h2></div></div>
      <PublicationList items={ctx.publications} />
    </section>
    <section className="ideal-panel"><h2>公開通知</h2>
      {!notices ? <p className="ideal-note">公開通知を確認できません。</p>
        : notices.length ? <ol className="ideal-timeline">{notices.map((item) => <li key={item.event_id}><span /><div><strong>{item.kind}</strong><p>公開版 {item.version ?? "—"} · {item.read ? "確認済み" : "未確認"}</p></div><time>{item.created_at}</time></li>)}</ol>
          : <p className="ideal-note">公開通知はありません。</p>}
    </section>
  </div>;
}
