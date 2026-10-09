import { roleLabels } from "@/ideal/data";
import type { WorkspaceRoutePath } from "../generated/usecaseRoutes";
import { nameOf, type RouteContext } from "../shell/routeTypes";
import WorkspaceLink from "../shell/WorkspaceLink";

/**
 * On a route that looks at the person the URL names: whom the screen is narrowed to, that
 * the signed-in account is unchanged, and the way out. Shown only while the URL names
 * someone other than the viewer (a pharmacist who names themself is looking at their own
 * records, as without a name). The way out is a link to the same route that names nobody
 * and inherits nobody (`person: null`): a plain anchor, so the document is loaded again
 * and what the route kept in the browser for that person (a chosen person, a field filled
 * in first) goes with it.
 */
export default function SelectedPersonBand({ ctx, route }: { ctx: RouteContext; route: WorkspaceRoutePath }) {
  const person = ctx.selectedPersonId;
  if (!person || person === ctx.scope.person_id) return null;
  return <section className="ideal-v3-callout ideal-v3-selected-person" aria-label="表示を絞っている職員">
    <p>表示を絞っている職員：<strong>{nameOf(ctx, person)}</strong>。この画面では、この職員の記録だけを表示し、新しく登録する記録の対象もこの職員になります。</p>
    <p>サインイン中のアカウントは <strong>{ctx.viewerName}（{roleLabels[ctx.role]}）</strong> のまま変わっていません。</p>
    <p><WorkspaceLink className="ideal-inline-link ideal-v3-selected-person__clear" route={route} context={{ person: null }}>絞り込みを解除して全員の記録を表示する</WorkspaceLink></p>
  </section>;
}
