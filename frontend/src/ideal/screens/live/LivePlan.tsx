"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useSearchParams } from "next/navigation";
import ContextLink from "@/components/ContextLink";
import type { Job } from "../../api/client";
import type { LiveApi } from "../../live/context";
import { ActionStatus, Loaded, useAction } from "../../live/parts";
import { useResource } from "../../live/useResource";
import type { PlanFigures } from "../../types";
import { StatusPill } from "../shared";

const SEEDS = [0, 1, 2];
const TERMINAL = new Set(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID", "CANCELLED", "BLOCKED"]);
const JOB_STATUS: Record<string, string> = { QUEUED: "待機中", RUNNING: "作成中", OPTIMAL: "作成済み（最適）", FEASIBLE: "作成済み（時間内の最良）", INFEASIBLE: "条件を満たす案なし", UNKNOWN: "結果不明", MODEL_INVALID: "入力の誤り", CANCELLED: "中止", BLOCKED: "停止中" };
const hours = (seconds: number) => `${Math.round(seconds / 360) / 10}時間`;
const stages = ["前提確認", "候補生成", "案比較", "確認・編集", "公開"];

function Stepper({ current }: { current: number }) {
  return <ol className="ideal-stepper" aria-label="計画の工程">{stages.map((name, index) => <li key={name} aria-current={current === index ? "step" : undefined} className={current === index ? "is-current" : index < current ? "is-done" : ""}><span>{index < current ? <Check aria-hidden="true" /> : index + 1}</span><strong>{name}</strong></li>)}</ol>;
}

function route(path: string, params: URLSearchParams, updates: Record<string, string[] | string>) {
  const next = new URLSearchParams();
  for (const key of ["scope", "period", "publication", "case", "person"]) {
    const value = params.get(key); if (value) next.set(key, value);
  }
  for (const [key, value] of Object.entries(updates)) {
    next.delete(key);
    for (const item of Array.isArray(value) ? value : [value]) next.append(key, item);
  }
  return `${path}?${next}`;
}

/** Route-specific generation and comparison; state crosses pages only through listed IDs. */
export function LivePlan({ live, view }: { live: LiveApi; view: "generate" | "compare" }) {
  const id = useId();
  const searchParams = useSearchParams();
  // The Next hook is nullable in non-router renderers such as Jest. Keeping a
  // stable empty object also avoids retriggering comparison reads every render.
  const params = useMemo(() => searchParams ?? new URLSearchParams(), [searchParams]);
  const input = useResource(() => live.client.inputLatest(live.scopeId), `${live.scopeId}|${live.publication?.publication_id}`);
  const [jobs, setJobs] = useState<Record<number, Job>>({});
  const [chosen, setChosen] = useState("");
  const generate = useAction();
  const cancel = useAction();
  const routeDrafts = useMemo(() => {
    const values = params.getAll("draft").filter((value) => /^[A-Za-z0-9._:-]{1,256}$/.test(value)).slice(0, 6);
    return values.length ? values : live.isSynthetic ? ["synthetic-draft-1", "synthetic-draft-2", "synthetic-draft-3"] : [];
  }, [params, live.isSynthetic]);
  const inputHash = params.get("input") ?? input.data?.input_hash ?? "";
  const generatedDrafts = SEEDS.map((seed) => jobs[seed]?.result?.draft_id).filter((value): value is string => Boolean(value));
  const pending = SEEDS.some((seed) => jobs[seed] && !TERMINAL.has(jobs[seed].status));
  const drafts = view === "generate" ? generatedDrafts : routeDrafts;
  const comparison = useResource(async () => view === "compare" && drafts.length ? live.client.comparison(live.scopeId, inputHash, drafts) : null, `${view}|${inputHash}|${drafts.join(",")}`);

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

  if (view === "generate") return <div className="ideal-stack">
    <Stepper current={1} />
    <Loaded resource={input}>{(data) => <>
      <section className="ideal-toolbar"><div><span className="ideal-eyebrow">入力版 {data.input_revision}</span><h2>同じ前提から3案を作成</h2><p>優先順は固定し、探索の乱数種だけを変えます。同じ案は重複として表示します。</p></div><StatusPill tone={data.stale ? "warn" : "good"}>{data.stale ? "入力が古い" : "生成可能"}</StatusPill></section>
      <section className="ideal-panel" aria-labelledby={`${id}-generate`}><h2 id={`${id}-generate`}>候補生成</h2>
        <button type="button" className="ideal-button ideal-button--primary" disabled={generate.busy || pending || data.stale} onClick={() => void generate.run(async () => {
          setJobs({});
          for (const seed of SEEDS) {
            const contents = { input_hash: data.input_hash, random_seed: seed, budget_seconds: 25 };
            const job = await live.mutate(`plan-job:${seed}`, contents, (key) => live.client.enqueueJob(live.scopeId, { ...contents, idempotency_key: key }));
            setJobs((old) => ({ ...old, [seed]: job }));
          }
        })}>3つの案を作る</button>
        {Object.keys(jobs).length > 0 && <ul className="ideal-job-list">{SEEDS.filter((seed) => jobs[seed]).map((seed) => <li key={seed}><span>案 {seed + 1}（乱数種 {seed}）</span><StatusPill tone={jobs[seed].result?.draft_id ? "good" : TERMINAL.has(jobs[seed].status) ? "warn" : "info"}>{JOB_STATUS[jobs[seed].status] ?? jobs[seed].status}</StatusPill>{!TERMINAL.has(jobs[seed].status) && <button type="button" className="ideal-button ideal-button--secondary" onClick={() => void cancel.run(async () => { const body = {}; await live.mutate(`cancel-job:${jobs[seed].job_id}`, body, (key) => live.client.cancelJob(live.scopeId, jobs[seed].job_id, { idempotency_key: key })); setJobs((old) => ({ ...old, [seed]: { ...old[seed], status: "CANCELLED" } })); return `案 ${seed + 1} の生成を中止しました。`; })}>中止</button>}</li>)}</ul>}
        <ActionStatus problem={generate.problem ?? cancel.problem} done={generate.done ?? cancel.done} />
        {generatedDrafts.length === 3 && !pending && <ContextLink className="ideal-button ideal-button--primary" href={route("/workspace/plan/compare", params, { input: data.input_hash, draft: generatedDrafts })}>3案を同じ定義で比較 <ArrowRight aria-hidden="true" /></ContextLink>}
      </section>
    </>}</Loaded>
  </div>;

  return <div className="ideal-stack">
    <Stepper current={2} />
    {!drafts.length ? <section className="ideal-empty"><h2>比較する案が指定されていません</h2><p>候補生成から3案を作成してください。</p><ContextLink className="ideal-button ideal-button--primary" href="/workspace/plan/generate">候補生成へ</ContextLink></section>
      : <section className="ideal-panel" aria-labelledby={`${id}-compare`}><div className="ideal-panel__head"><div><span className="ideal-eyebrow">入力版を固定</span><h2 id={`${id}-compare`}>案の比較</h2></div></div>
        <Loaded resource={comparison}>{(result) => result && <>
          <fieldset className="ideal-fieldset"><legend>確認・編集へ進める案</legend><div className="ideal-table-wrap" role="region" aria-label="案ごとの数値" tabIndex={0}><table className="ideal-table"><thead><tr><th scope="col">案</th><th scope="col">違反・未確認・未対応</th><th scope="col">前回からの変更</th><th scope="col">希望</th><th scope="col">勤務時間差</th><th scope="col">並び</th></tr></thead><tbody>{result.plans.map((plan: PlanFigures) => <tr key={plan.draft_id}><td><label className="ideal-radio"><input type="radio" name={`${id}-plan`} value={plan.draft_id} checked={chosen === plan.draft_id} disabled={Boolean(plan.duplicate_of)} onChange={() => setChosen(plan.draft_id)} />案 {drafts.indexOf(plan.draft_id) + 1}{plan.duplicate_of ? `（案 ${drafts.indexOf(plan.duplicate_of) + 1} と同じ）` : ""}</label></td><td>{plan.findings.violation}・{plan.findings.unverified}・{plan.findings.unsupported}</td><td>{plan.changes_from_previous ?? "—"}</td><td>{plan.preferences_met} / {plan.preferences_total}</td><td>{hours(plan.work_seconds_spread)}</td><td>{result.order.indexOf(plan.draft_id) + 1}</td></tr>)}</tbody></table></div></fieldset>
          <p className="ideal-note">並びの規則：{result.order_rule}</p><p className="ideal-note">{result.meaning}</p>
          {result.pairs.map((pair) => <p key={`${pair.a}-${pair.b}`} className="ideal-note">案 {drafts.indexOf(pair.a) + 1} と案 {drafts.indexOf(pair.b) + 1}：異なる勤務 {pair.differing_duties}件、関係する職員 {pair.affected_people}名</p>)}
        </>}</Loaded>
        {chosen && <ContextLink className="ideal-button ideal-button--primary" href={route("/workspace/plan/drafts", params, { input: inputHash, draft: chosen })}>選んだ案を確認・編集 <ArrowRight aria-hidden="true" /></ContextLink>}
      </section>}
  </div>;
}

export { Stepper };
