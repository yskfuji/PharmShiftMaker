import type { MembershipRevision } from "@/ideal/types";
import TaskDisclosure from "../../shared/TaskDisclosure";
import { nameOf, type RouteContext } from "../../shell/routeTypes";
import LinkForm from "./LinkForm";
import MembershipsPanel from "./MembershipsPanel";

const LINK_TASK = "memberships-task-link";

/** Account links of the scope (of the person the URL names, when it names one), and the
 * form that links another account. The control in the header leads to that form. */
export default function MembershipsView({ data, ctx }: { data: MembershipRevision[]; ctx: RouteContext }) {
  const person = ctx.selectedPersonId;
  return <div className="ideal-stack">
    <MembershipsPanel memberships={data} selectedPersonId={person} linkTask={LINK_TASK}
      notice={person && <p className="ideal-v3-callout">選択中の職員：{nameOf(ctx, person)}。この職員の紐付けだけを表示しています。</p>}>
      <div className="ideal-v3-task-list ideal-v3-people-tasks">
        <TaskDisclosure id={LINK_TASK} summary="本人アカウントを紐付ける" tone="primary" hint="職員に本人アカウントと役割を対応づけます。">
          <LinkForm initialPersonId={person} />
        </TaskDisclosure>
      </div>
    </MembershipsPanel>
  </div>;
}
