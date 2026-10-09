import type { LifecycleCase } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { UNKNOWN_VALUE } from "../../shared/labels";
import SelectedPersonBand from "../../shared/SelectedPersonBand";
import TaskDisclosure from "../../shared/TaskDisclosure";
import TaskJump from "../../shared/TaskJump";
import { nameOf, routeOf, type RouteContext } from "../../shell/routeTypes";
import LifecycleCard from "./LifecycleCard";
import LifecycleForm from "./LifecycleForm";

const START_TASK = "lifecycle-task-start";

/**
 * Onboarding and offboarding cases of the scope (of the person the URL names, when it
 * names one: the band says so and leads out of it), and the form that starts another. The
 * count in the header is of the cases
 * the server returned, by the state the server gave each (application/ideal_workflows.py,
 * lifecycle_response: IN_PROGRESS or READY). A case in a state this code does not know is
 * counted as neither: its card names the state 「未対応の値」. The control beside the count
 * leads to the task that starts a case.
 */
export default function LifecycleView({ data, ctx }: { data: LifecycleCase[]; ctx: RouteContext }) {
  const person = ctx.selectedPersonId;
  const list = person ? data.filter((c) => c.person_id === person) : data;
  const open = list.filter((c) => c.status === "IN_PROGRESS").length;
  const ready = list.filter((c) => c.status === "READY").length;
  return <div className="ideal-stack">
    <section className="ideal-panel" aria-labelledby="lifecycle-title">
      <div className="ideal-panel__head ideal-v3-people-head">
        <div><h2 id="lifecycle-title">手続きの進み具合</h2><p>入職・退職の手続きごとに、済んだ確認と残っている確認を示します。確認には、登録された記録から自動で判定するものと、担当者が確かめて記録するものがあります。</p></div>
        <div className="ideal-v3-badge-action">
          <StatusPill tone={open ? "info" : ready ? "good" : "neutral"}>{open ? `進行中 ${open}件` : ready ? `すべて完了 ${ready}件` : list.length ? UNKNOWN_VALUE : "手続きなし"}</StatusPill>
          <TaskJump target={START_TASK}>新しい手続きを始める</TaskJump>
        </div>
      </div>
      <SelectedPersonBand ctx={ctx} route={routeOf("people/lifecycle").route} />
      {list.length ? <div className="ideal-lifecycle-list">{list.map((c) => <LifecycleCard key={c.case_id} c={c} name={nameOf(ctx, c.person_id)} />)}</div> : <p className="ideal-note">{person ? "選択した職員に進行中の手続きはありません。" : "進行中の手続きはありません。"}</p>}
      <div className="ideal-v3-task-list ideal-v3-people-tasks">
        <TaskDisclosure id={START_TASK} summary="新しい入職・退職手続きを始める" tone="primary" hint="職員・種類（入職か退職）・発効日を記録して始めます。">
          <LifecycleForm initialPersonId={person} />
        </TaskDisclosure>
      </div>
    </section>
  </div>;
}
