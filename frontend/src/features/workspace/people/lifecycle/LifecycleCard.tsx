import type { LifecycleCase } from "@/ideal/types";
import { StatusPill } from "@/ideal/ui/atoms";
import LifecycleTasks from "./LifecycleTasks";

/** One case: whose it is, how far it is, and its tasks. */
export default function LifecycleCard({ c, name }: { c: LifecycleCase; name: string }) {
  const done = c.tasks.filter((t) => t.status === "COMPLETED").length;
  return <article>
    <span className={`ideal-avatar ${c.kind === "OFFBOARD" ? "is-offboard" : ""}`}>{name.slice(0, 1)}</span>
    <div className="ideal-lifecycle-list__main">
      <div><strong>{name}</strong><StatusPill tone={c.status === "READY" ? "good" : "info"}>{c.kind === "ONBOARD" ? "入職" : "退職"} · {c.status === "READY" ? "すべて完了" : "進行中"}</StatusPill></div>
      <p>{c.effective_date} · 版{c.version}</p>
      <div className="ideal-progress" role="progressbar" aria-label={`${name}のタスク進捗`} aria-valuemin={0} aria-valuemax={c.tasks.length} aria-valuenow={done}><span style={{ width: `${c.tasks.length ? (done / c.tasks.length) * 100 : 0}%` }} /></div>
      <LifecycleTasks caseId={c.case_id} version={c.version} personId={c.person_id} tasks={c.tasks} />
    </div>
  </article>;
}
