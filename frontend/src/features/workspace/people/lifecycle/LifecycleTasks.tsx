"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { stamp } from "../../shared/format";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, InlineProblem, useAction } from "@/ideal/live/parts";
import type { LifecycleTaskState } from "@/ideal/types";
import { labelOf } from "../../shared/labels";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { useLive } from "../../shell/WorkspaceRuntime";
import { TASK } from "../labels";
import WhyDisabled, { EVIDENCE_NEEDED } from "../../shared/WhyDisabled";

/** The route where the record a system task waits for is kept. */
function taskRoute(task: string) {
  if (["contract", "qualification", "contract_end"].includes(task)) return routeOf("people/contracts").route;
  if (["membership", "membership_deactivation"].includes(task)) return routeOf("people/memberships").route;
  return routeOf("plan/input").route;
}
/** The name of that route as the link says it: where the link leads is said before it is
 * followed. The same three groups as `taskRoute`. */
function taskRouteLabel(task: string) {
  if (["contract", "qualification", "contract_end"].includes(task)) return "契約・資格を開く";
  if (["membership", "membership_deactivation"].includes(task)) return "本人アカウントを開く";
  return "前提・取込を開く";
}

/** How a task comes to be done, by the `source` the server gives it: from a record it
 * reads, or from a person's confirmation. Any other value says nothing. */
const SOURCE: Record<string, string> = { SYSTEM: "記録から自動で判定", ATTESTATION: "担当者が確かめて記録" };

/**
 * The tasks of one case. A task the server marks as attestable is confirmed here against
 * the case version on screen; which task is open and its evidence are the only state.
 * Whether a task is done is the server's `status`; the time is shown where the server gives
 * one (it gives none for a task it completes from a record).
 *
 * A row is mark | what the task is and how it stands | what can be done about it. The
 * evidence of a task being confirmed is asked in that task's own row, across its width,
 * and a refusal is shown there, under the button that was pressed.
 */
export default function LifecycleTasks({ caseId, version, personId, tasks }: { caseId: string; version: number; personId: string; tasks: LifecycleTaskState[] }) {
  const live = useLive();
  const [task, setTask] = useState<string | null>(null);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  const asked = tasks.some((t) => t.key === task);
  const id = useId();
  const why = action.busy || evidenceReady(evidence) ? null : EVIDENCE_NEEDED;
  return <>
    <ul className="ideal-task-list">{tasks.map((t) => {
      const done = t.status === "COMPLETED";
      const attest = !done && t.can_complete && task !== t.key;
      const source = !done && t.source === "SYSTEM";
      return <li key={t.key} className={done ? "is-done" : ""}>
        <span>{done ? "✓" : "・"}</span>
        <span><strong>{labelOf(TASK, t.key)}</strong><small>{done ? (t.completed_at ? `完了 ${stamp(t.completed_at)}` : "完了") : "未完了"}{Object.hasOwn(SOURCE, t.source) ? `（${SOURCE[t.source]}）` : ""}</small>{t.blocked_reason && <small className="ideal-v3-lifecycle-blocked">{t.blocked_reason}</small>}</span>
        {(attest || source) && <span className="ideal-v3-lifecycle-action">
          {attest && <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTask(t.key)}>確認を記録 <ChevronRight aria-hidden="true" /></button>}
          {source && <WorkspaceLink className="ideal-inline-link" route={taskRoute(t.key)} context={{ scope: live.scopeId, person: personId || undefined }}>{taskRouteLabel(t.key)} <ChevronRight aria-hidden="true" /></WorkspaceLink>}
        </span>}
        {task === t.key && <form className="ideal-v3-lifecycle-attest" onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
          const body = { task_key: task, expected_version: version, evidence };
          await live.mutate(`task:${caseId}:${task}`, body, (key) => live.client.attestTask(live.scopeId, caseId, task, { expected_version: body.expected_version, evidence: body.evidence, idempotency_key: key }));
          setTask(null);
          setEvidence(EMPTY_EVIDENCE);
          await live.refresh();
          return "完了にしました。";
        }); }}>
          <EvidenceFields value={evidence} onChange={setEvidence} legend={`「${labelOf(TASK, task)}」の完了の根拠`} />
          <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)} aria-describedby={why ? `${id}-why` : undefined}>完了にする</button>
            <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTask(null)}>やめる</button></div>
          <WhyDisabled id={`${id}-why`}>{why}</WhyDisabled>
          {action.problem && <InlineProblem problem={action.problem} />}
        </form>}
      </li>;
    })}</ul>
    {/* The message of a change stays with the card after the form has closed. */}
    <ActionStatus problem={asked ? null : action.problem} done={action.done} />
  </>;
}
