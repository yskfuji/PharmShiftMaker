import type { LifecycleCase } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import { labelOf } from "../../shared/labels";
import { LIFECYCLE_KIND, LIFECYCLE_STATUS } from "../labels";
import LifecycleTasks from "./LifecycleTasks";

/**
 * One case: whose it is and how far it is (the summary), and its tasks. The count beside
 * the bar is of the tasks the server returned, by the state the server gave each.
 */
export default function LifecycleCard({ c, name }: { c: LifecycleCase; name: string }) {
  const done = c.tasks.filter((t) => t.status === "COMPLETED").length;
  return <article>
    <div className="ideal-v3-lifecycle-summary">
      <div className="ideal-v3-lifecycle-who">
        <span className={`ideal-avatar ${c.kind === "OFFBOARD" ? "is-offboard" : ""}`} aria-hidden="true">{name.slice(0, 1)}</span>
        <div><h3>{name}</h3><StatusPill tone={c.status === "READY" ? "good" : c.status === "IN_PROGRESS" ? "info" : "neutral"}>{labelOf(LIFECYCLE_KIND, c.kind)} · {labelOf(LIFECYCLE_STATUS, c.status)}</StatusPill></div>
      </div>
      <p>発効日 {c.effective_date} · 第{c.version}版</p>
      <div className="ideal-v3-lifecycle-progress">
        <div className="ideal-progress" role="progressbar" aria-label={`${name}のタスク進捗`} aria-valuemin={0} aria-valuemax={c.tasks.length} aria-valuenow={done}><span style={{ width: `${c.tasks.length ? (done / c.tasks.length) * 100 : 0}%` }} /></div>
        <span>{done} / {c.tasks.length} 完了</span>
      </div>
    </div>
    <div className="ideal-v3-lifecycle-tasks">
      <LifecycleTasks caseId={c.case_id} version={c.version} personId={c.person_id} tasks={c.tasks} />
    </div>
  </article>;
}
