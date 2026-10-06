import type { WorkspaceNotification } from "@/ideal/types";
import { stamp } from "../../shared/format";
import { eventLabel } from "../../shared/labels";
import { PUBLICATION_NOTICES } from "../../shared/publicationNotices";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import PublicationList from "./PublicationList";

/** Which publication a notice is about, as far as its fields say. A notice of a publication
 * or of an approval names its publication's version. A cancellation's `version` is the
 * number the period's head was given by the cancel (application/planning.py,
 * cancel_publication), so it is not printed as 「公開版 vN」. The other kinds the server
 * sends carry no publication, and nothing is said of one. */
const publicationOf = (item: WorkspaceNotification): string | null =>
  item.kind === "schedule.cancelled" ? "取り消された公開版"
    : PUBLICATION_NOTICES.has(item.kind) && item.publication_id ? (item.version == null ? "公開版 —" : `公開版 v${item.version}`) : null;

/** The scope's current publications (export and cancellation), and what the viewer was
 * notified of. `notices` is null when they could not be read: then nothing is claimed. */
export default function PublicationsView({ data, ctx }: { data: { notices: WorkspaceNotification[] | null }; ctx: RouteContext }) {
  const notices = data.notices;
  return <div className="ideal-stack">
    <section className="ideal-panel"><div className="ideal-panel__head ideal-v3-planning-head"><div><h2>公開版の出力と取消</h2><p>公開した勤務表の版ごとに、ファイルへの出力と公開の取消ができます。</p></div></div>
      <PublicationList items={ctx.publications} scopeName={ctx.scope.display_name} />
    </section>
    <section className="ideal-panel"><h2>公開通知</h2>
      <p className="ideal-note">あなた宛ての通知です。「未確認」は、あなた自身がまだ確認済みにしていないことを示します。ほかの職員が確認したかどうかは、この画面には表示されません。確認済みにするのは、<WorkspaceLink className="ideal-inline-link" route={routeOf("settings/notifications").route}>通知の画面</WorkspaceLink>です。</p>
      {!notices ? <p className="ideal-note">公開通知を確認できません。</p>
        : notices.length ? <ol className="ideal-timeline">{notices.map((item) => <li key={item.event_id}><span /><div><strong>{eventLabel(item.kind, item.category)}</strong><p>{[publicationOf(item), item.read ? "あなたは確認済み" : "あなたは未確認"].filter(Boolean).join(" · ")}</p></div><time dateTime={item.created_at}>{stamp(item.created_at)}</time></li>)}</ol>
          : <p className="ideal-note">公開通知はありません。</p>}
    </section>
  </div>;
}
