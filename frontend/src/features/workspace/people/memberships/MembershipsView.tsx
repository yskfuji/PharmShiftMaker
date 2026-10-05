import type { MembershipRevision } from "@/ideal/types";
import type { RouteContext } from "../../shell/routeTypes";
import LinkForm from "./LinkForm";
import MembershipsPanel from "./MembershipsPanel";

/** Account links of the scope (of the person the URL names, when it names one), and the
 * form that links another account. */
export default function MembershipsView({ data, ctx }: { data: MembershipRevision[]; ctx: RouteContext }) {
  return <div className="ideal-stack">
    <MembershipsPanel memberships={data} selectedPersonId={ctx.selectedPersonId}>
      <details className="ideal-v3-disclosure"><summary>本人アカウントを紐付ける</summary><LinkForm initialPersonId={ctx.selectedPersonId} /></details>
    </MembershipsPanel>
  </div>;
}
