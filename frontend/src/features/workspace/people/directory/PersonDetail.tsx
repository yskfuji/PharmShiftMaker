import type { LifecycleCase, MembershipRevision } from "@/ideal/types";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { ROLE } from "../labels";

/** One person as the directory summarises them, and the routes where their records change. */
export default function PersonDetail({ person, memberships, contracts, capabilities, lifecycle }: { person: { person_id: string; name: string }; memberships: MembershipRevision[]; contracts: number; capabilities: number; lifecycle: LifecycleCase[] }) {
  return <article className="ideal-v3-detail" aria-live="polite"><span className="ideal-eyebrow">選択中の職員</span><h3>{person.name}</h3><dl className="ideal-definition-list"><div><dt>本人アカウント</dt><dd>{memberships.length ? memberships.map((item) => `${ROLE[item.role]}・${item.active ? "有効" : "無効"}（版${item.revision}）`).join("、") : "未紐付け"}</dd></div><div><dt>契約</dt><dd>{contracts ? `${contracts}件（原本記録あり）` : "登録なし"}</dd></div><div><dt>資格</dt><dd>{capabilities ? `${capabilities}件（原本記録あり）` : "登録なし"}</dd></div><div><dt>入職・退職</dt><dd>{lifecycle.length ? lifecycle.map((item) => `${item.kind === "ONBOARD" ? "入職" : "退職"}・${item.status}`).join("、") : "進行中の手続きなし"}</dd></div></dl><nav aria-label="選択職員の詳細"><WorkspaceLink route={routeOf("people/memberships").route} context={{ person: person.person_id }}>本人アカウント</WorkspaceLink><WorkspaceLink route={routeOf("people/contracts").route} context={{ person: person.person_id }}>契約・資格</WorkspaceLink><WorkspaceLink route={routeOf("people/lifecycle").route} context={{ person: person.person_id }}>入職・退職</WorkspaceLink></nav></article>;
}
