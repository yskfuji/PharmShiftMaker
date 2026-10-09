"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Job } from "@/ideal/api/client";
import { ActionStatus, useAction } from "@/ideal/live/parts";
import { StatusPill } from "@/ideal/ui/atoms";
import { useMounted } from "../../shared/hydration";
import { labelOf } from "../../shared/labels";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { useLive } from "../../shell/WorkspaceRuntime";
import { BUDGET_SECONDS } from "./budget";

const SEEDS = [0, 1, 2];
const TERMINAL = new Set(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID", "CANCELLED", "BLOCKED"]);
const JOB_STATUS: Record<string, string> = { QUEUED: "待機中", RUNNING: "作成中", OPTIMAL: "作成済み（最適）", FEASIBLE: "作成済み（時間内の最良）", INFEASIBLE: "条件を満たす案なし", UNKNOWN: "結果不明", MODEL_INVALID: "入力の誤り", CANCELLED: "中止", BLOCKED: "停止中" };

/**
 * Starts the three jobs (one per random seed; the seed is the request's, and is not shown:
 * a plan is named by its number) for the input version on screen and follows
 * them every second until each has ended. The jobs exist only here: they are what the
 * planner just asked for, not something the route reads. Each start and each cancel is one
 * change with its own idempotency key. One action is filled at a time: making the plans
 * until the three exist, then comparing them.
 */
export default function GenerateJobs({ inputHash, stale }: { inputHash: string; stale: boolean }) {
  const live = useLive();
  const mounted = useMounted();
  const [jobs, setJobs] = useState<Record<number, Job>>({});
  const generate = useAction();
  const cancel = useAction();
  const drafts = SEEDS.map((seed) => jobs[seed]?.result?.draft_id).filter((value): value is string => Boolean(value));
  const pending = SEEDS.some((seed) => jobs[seed] && !TERMINAL.has(jobs[seed].status));
  // The three plans exist: comparing them is the next step, and making them again is not.
  const ready = drafts.length === 3 && !pending;

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      for (const seed of SEEDS) {
        const job = jobs[seed];
        if (job && !TERMINAL.has(job.status)) void live.client.job(live.scopeId, job.job_id).then((next) => setJobs((old) => ({ ...old, [seed]: next })), () => {});
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pending, jobs, live]);

  return <>
    {/* Offered once it can answer: a press on a button React has not attached to is lost. */}
    <div className="ideal-actions">{mounted && <button type="button" className={ready ? "ideal-button ideal-button--secondary" : "ideal-button ideal-button--primary"} disabled={generate.busy || pending || stale} onClick={() => void generate.run(async () => {
      setJobs({});
      for (const seed of SEEDS) {
        const contents = { input_hash: inputHash, random_seed: seed, budget_seconds: BUDGET_SECONDS };
        const job = await live.mutate(`plan-job:${seed}`, contents, (key) => live.client.enqueueJob(live.scopeId, { ...contents, idempotency_key: key }));
        setJobs((old) => ({ ...old, [seed]: job }));
      }
    })}>3つの案を作る</button>}</div>
    {Object.keys(jobs).length > 0 && <ul className="ideal-job-list ideal-v3-planning-jobs">{SEEDS.filter((seed) => jobs[seed]).map((seed) => <li key={seed}><span>案 {seed + 1}</span><StatusPill tone={jobs[seed].result?.draft_id ? "good" : TERMINAL.has(jobs[seed].status) ? "warn" : "info"}>{labelOf(JOB_STATUS, jobs[seed].status)}</StatusPill>{!TERMINAL.has(jobs[seed].status) && <button type="button" className="ideal-button ideal-button--secondary" onClick={() => void cancel.run(async () => {
      const body = {};
      await live.mutate(`cancel-job:${jobs[seed].job_id}`, body, (key) => live.client.cancelJob(live.scopeId, jobs[seed].job_id, { idempotency_key: key }));
      setJobs((old) => ({ ...old, [seed]: { ...old[seed], status: "CANCELLED" } }));
      return `案 ${seed + 1} の生成を中止しました。`;
    })}>中止</button>}</li>)}</ul>}
    <ActionStatus problem={generate.problem ?? cancel.problem} done={generate.done ?? cancel.done} />
    {ready && <div className="ideal-actions"><WorkspaceLink className="ideal-button ideal-button--primary" route={routeOf("plan/compare").route} context={{ input: inputHash, draft: drafts }}>3案を同じ定義で比較 <ArrowRight aria-hidden="true" /></WorkspaceLink></div>}
  </>;
}
