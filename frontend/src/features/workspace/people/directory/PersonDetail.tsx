import { ArrowRight } from "lucide-react";
import type { LifecycleCase, MembershipRevision } from "@/ideal/types";
import { labelOf } from "../../shared/labels";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { LIFECYCLE_KIND, LIFECYCLE_STATUS, ROLE } from "../labels";
import Identifiers from "../../shared/Identifiers";

/**
 * One person as the directory summarises them, and the routes where their records are
 * kept. The directory changes nothing itself: the four destinations are what can be done
 * with the person from here, and the pane says so. Each carries the person in the URL; the
 * server reads the route again and selects that person only after checking them against the
 * roster of the scope (shell/server/context.ts, resolvePersonSelection). The fourth leads to
 * the privacy route, where an administrator files a request for the person on their behalf.
 */
export default function PersonDetail({ person, memberships, contracts, capabilities, lifecycle }: { person: { person_id: string; name: string }; memberships: MembershipRevision[]; contracts: number; capabilities: number; lifecycle: LifecycleCase[] }) {
  const to = { person: person.person_id };
  return <article className="ideal-v3-detail ideal-v3-people-detail" aria-live="polite">
    <span className="ideal-eyebrow">選択中の職員</span>
    <h3>{person.name}</h3>
    <dl className="ideal-definition-list">
      <div><dt>本人アカウント</dt><dd>{memberships.length ? memberships.map((item) => `${labelOf(ROLE, item.role)}・${item.active ? "有効" : "無効"}（第${item.revision}版）`).join("、") : "未紐付け"}</dd></div>
      <div><dt>契約</dt><dd>{contracts ? `${contracts}件（原本記録あり）` : "登録なし"}</dd></div>
      <div><dt>資格</dt><dd>{capabilities ? `${capabilities}件（原本記録あり）` : "登録なし"}</dd></div>
      <div><dt>入職・退職</dt><dd>{lifecycle.length ? lifecycle.map((item) => `${labelOf(LIFECYCLE_KIND, item.kind)}・${labelOf(LIFECYCLE_STATUS, item.status)}`).join("、") : "進行中の手続きなし"}</dd></div>
    </dl>
    <Identifiers items={[{ label: "職員ID", value: person.person_id }]} />
    <div className="ideal-v3-people-next">
      <h4 className="ideal-v3-heading">この職員の記録を確認・変更する</h4>
      <nav aria-label="選択職員の詳細">
        <WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("people/memberships").route} context={to}>本人アカウント<ArrowRight aria-hidden="true" /></WorkspaceLink>
        <WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("people/contracts").route} context={to}>契約・資格<ArrowRight aria-hidden="true" /></WorkspaceLink>
        <WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("people/lifecycle").route} context={to}>入職・退職<ArrowRight aria-hidden="true" /></WorkspaceLink>
        <WorkspaceLink className="ideal-button ideal-button--secondary" route={routeOf("governance/privacy").route} context={to}>個人情報の請求<ArrowRight aria-hidden="true" /></WorkspaceLink>
      </nav>
    </div>
  </article>;
}
