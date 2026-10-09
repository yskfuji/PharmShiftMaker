import type { MembershipRevision } from "@/ideal/types";
import SelectedPersonBand from "../../shared/SelectedPersonBand";
import TaskDisclosure from "../../shared/TaskDisclosure";
import { routeOf, type RouteContext } from "../../shell/routeTypes";
import LinkForm from "./LinkForm";
import MembershipsPanel from "./MembershipsPanel";

const LINK_TASK = "memberships-task-link";

/** Account links of the scope (of the person the URL names, when it names one: the band
 * says so and leads out of it), and the form that links another account. The control in
 * the header leads to that form. */
export default function MembershipsView({ data, ctx }: { data: MembershipRevision[]; ctx: RouteContext }) {
  const person = ctx.selectedPersonId;
  return <div className="ideal-stack">
    <MembershipsPanel memberships={data} selectedPersonId={person} linkTask={LINK_TASK}
      notice={<SelectedPersonBand ctx={ctx} route={routeOf("people/memberships").route} />}>
      <div className="ideal-v3-task-list ideal-v3-people-tasks">
        <TaskDisclosure id={LINK_TASK} summary="本人アカウントを紐付ける" tone="primary" hint="職員に本人アカウントと役割を対応づけます。">
          <LinkForm initialPersonId={person} />
        </TaskDisclosure>
      </div>
    </MembershipsPanel>
  </div>;
}
