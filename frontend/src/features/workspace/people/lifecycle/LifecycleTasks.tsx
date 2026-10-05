"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { stamp } from "@/ideal/live/format";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import type { LifecycleTaskState } from "@/ideal/types";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { useLive } from "../../shell/WorkspaceRuntime";
import { TASK } from "../labels";

/** The route where the record a system task waits for is kept. */
function taskRoute(task: string) {
  if (["contract", "qualification", "contract_end"].includes(task)) return routeOf("people/contracts").route;
  if (["membership", "membership_deactivation"].includes(task)) return routeOf("people/memberships").route;
  return routeOf("plan/input").route;
}

/** The tasks of one case. A task the server marks as attestable is confirmed here against
 * the case version on screen; which task is open and its evidence are the only state. */
export default function LifecycleTasks({ caseId, version, personId, tasks }: { caseId: string; version: number; personId: string; tasks: LifecycleTaskState[] }) {
  const live = useLive();
  const [task, setTask] = useState<string | null>(null);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  return <>
    <ul className="ideal-task-list">{tasks.map((t) => <li key={t.key} className={t.status === "COMPLETED" ? "is-done" : ""}><span>{t.status === "COMPLETED" ? "✓" : "・"}</span><span><strong>{TASK[t.key] ?? t.key}</strong><small>{t.completed_at ? `完了 ${stamp(t.completed_at)}` : "未完了"}</small></span>
      {t.status !== "COMPLETED" && t.can_complete && task !== t.key && <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTask(t.key)}>確認を記録 <ChevronRight aria-hidden="true" /></button>}
      {t.status !== "COMPLETED" && t.source === "SYSTEM" && <WorkspaceLink className="ideal-inline-link" route={taskRoute(t.key)} context={{ scope: live.scopeId, person: personId || undefined }}>正本を開く <ChevronRight aria-hidden="true" /></WorkspaceLink>}
      {t.blocked_reason && <small>{t.blocked_reason}</small>}</li>)}</ul>
    {task && <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
      const body = { task_key: task, expected_version: version, evidence };
      await live.mutate(`task:${caseId}:${task}`, body, (key) => live.client.attestTask(live.scopeId, caseId, task, { expected_version: body.expected_version, evidence: body.evidence, idempotency_key: key }));
      setTask(null);
      setEvidence(EMPTY_EVIDENCE);
      await live.refresh();
      return "完了にしました。";
    }); }}>
      <EvidenceFields value={evidence} onChange={setEvidence} legend={`「${TASK[task] ?? task}」の完了の根拠`} />
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>完了にする</button>
        <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTask(null)}>やめる</button></div>
    </form>}
    <ActionStatus problem={action.problem} done={action.done} />
  </>;
}
