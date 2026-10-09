import type { WorkspaceNotification } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { stamp } from "../../shared/format";
import { CATEGORY, eventLabel, labelOf } from "../../shared/labels";
import { PUBLICATION_NOTICES } from "../../shared/publicationNotices";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import MarkRead from "./MarkRead";

/** What happened, as a sentence for the person it is addressed to: the kinds the server
 * sends as notifications (routers/planning.py, notifications). Any other kind is named by
 * the shared labels (a recorded kind in words, an unknown one as 「未対応の値」). */
const NOTICE: Readonly<Record<string, string>> = {
  "schedule.published": "勤務表が公開されました",
  "schedule.cancelled": "公開版が取り消されました",
  "change.approved": "欠勤・交換のケースが承認されました",
  "change.recommended": "欠勤・交換のケースが、別の担当者の承認待ちになりました",
  "change.rejected": "欠勤・交換のケースが却下されました",
  "change.withdrawn": "欠勤・交換の申請が取り下げられました",
  "lifecycle.onboard.created": "入職の手続きが始まりました",
  "lifecycle.offboard.created": "退職の手続きが始まりました",
  "lifecycle.task.completed": "入職・退職の手続きのタスクが完了しました",
};
/** Under a notice of a cancellation. Its `version` is not a publication's: it is the number
 * the period's head was given by the cancel (application/planning.py, cancel_publication:
 * `expected_version + 1`), so no 「公開版 vN」 is printed, and after a cancel the period may
 * have no publication at all. */
const CANCELLED = "この通知の公開版は取り消されました。いまの公開版は「勤務表」で確認できます（その期間に、公開中の勤務表がないこともあります）。";
/** Under a notice of a publication the scope's current publications no longer hold (the
 * server lists the publication each period's head points at, routers/planning.py,
 * publications): a newer version was published for its period, or it was cancelled. */
const NOT_CURRENT = "この版は、いまの公開版ではありません（新しい版が公開されたか、取り消されました）。いまの公開版は「勤務表」で確認できます。";
const said = (kind: unknown, category: unknown): string => (typeof kind === "string" && Object.hasOwn(NOTICE, kind) ? NOTICE[kind] : eventLabel(kind, category));
// A kind that is already a sentence written for a reader is shown as it is (shared/labels.ts):
// those are someone's own words, and the element that shows them says so (`data-verbatim`).

/**
 * The viewer's own notifications, newest first as the server returns them. `null`: they
 * could not be read, so nothing is claimed about them. What a notification is about is named
 * in words (a kind or a category this code does not know is shown as such, never as its
 * code). A notice that a schedule was published, and a notice that a case was approved (the
 * approval publishes a new version, and a person whose duty it took away gets only this
 * notice), names the version of its publication and leads to the schedule of that
 * publication when the scope's publications (the context every route is given) still hold
 * it: the link names the publication and its own month, so it never asks the server for a
 * publication together with another month. A publication the context does not hold has no
 * link and is said not to be the current one; a notice of a cancellation prints no version
 * (its number is the head's, not a publication's). Any other kind is named by its category.
 * The server lists the scope's latest hundred notifications and gives the viewer
 * theirs among those, so the header claims only what is shown: its count is of these rows.
 */
export default function NotificationsView({ data: items, ctx }: { data: WorkspaceNotification[] | null; ctx: RouteContext }) {
  const schedule = routeOf("schedule/index").route;
  /** The month of a publication the scope still holds, as the schedule's URL names it. */
  const monthOf = (publicationId: string) => ctx.publications.find((item) => item.publication_id === publicationId)?.period.slice(0, 7);
  const unread = items?.filter((item) => !item.read).length ?? 0;
  return <section className="ideal-panel ideal-v3-measure ideal-v3-notifications" aria-labelledby="notification-title">
    <div className="ideal-panel__head">
      <div><h2 id="notification-title">通知</h2><p>あなた宛ての通知を、新しい順に表示します。この部署で直近に記録された通知100件のうちの、あなた宛ての分です。{unread > 0 && "内容を確かめたら「確認しました」を押してください。"}</p></div>
      {items && items.length > 0 && <StatusPill tone={unread ? "warn" : "good"}>{unread ? `表示中の未確認 ${unread}件` : "表示中の通知はすべて確認済み"}</StatusPill>}
    </div>
    {!items ? <p className="ideal-note">通知を確認できません。</p> : items.length ? <ol className="ideal-timeline ideal-v3-notifications-list">{items.map((item) => <li key={item.event_id}>
      <span />
      <div><strong data-verbatim={said(item.kind, item.category) === item.kind ? true : undefined}>{said(item.kind, item.category)}</strong><p>{item.kind === "schedule.cancelled" ? CANCELLED
        : PUBLICATION_NOTICES.has(item.kind) && item.publication_id ? (monthOf(item.publication_id)
          ? <>公開版 v{item.version ?? "—"}。<WorkspaceLink className="ideal-inline-link" route={schedule} context={{ period: monthOf(item.publication_id), publication: item.publication_id }}>この版の勤務表を開く</WorkspaceLink></>
          : `公開版 v${item.version ?? "—"}。${NOT_CURRENT}`) : labelOf(CATEGORY, item.category)}</p>{item.read ? <p className="ideal-note">確認済み</p> : <MarkRead eventId={item.event_id} />}</div>
      <time dateTime={item.created_at}>{stamp(item.created_at)}</time>
    </li>)}</ol> : <div className="ideal-v3-notifications-empty"><p className="ideal-note">未確認の通知はありません。</p><p className="ideal-note">確認が必要な通知が届くと、ここに表示されます。</p></div>}
  </section>;
}
