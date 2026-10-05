"use client";

import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Loaded } from "@/ideal/live/parts";
import type { PlanComparison, PlanFigures } from "@/ideal/types";
import type { Seed } from "../../shared/seed";
import { useSeededResource } from "../../shared/useSeededResource";
import { routeOf } from "../../shell/routeTypes";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { useLive } from "../../shell/WorkspaceRuntime";

const hours = (seconds: number) => `${Math.round(seconds / 360) / 10}時間`;

/**
 * The comparison the route read for the plans and the input of the URL (the server checked
 * the URL's syntax; the API checks that they belong to the scope and the input). It is read
 * here only to try again after a refusal. The plan picked here is the only state, and it
 * travels on in the next link.
 */
export default function CompareDrafts({ draftIds: drafts, inputHash, seed }: { draftIds: string[]; inputHash: string; seed: Seed<PlanComparison> }) {
  const live = useLive();
  const id = useId();
  const [chosen, setChosen] = useState("");
  const comparison = useSeededResource(seed, () => live.client.comparison(live.scopeId, inputHash, drafts));

  return <section className="ideal-panel" aria-labelledby={`${id}-compare`}><div className="ideal-panel__head"><div><span className="ideal-eyebrow">入力版を固定</span><h2 id={`${id}-compare`}>案の比較</h2></div></div>
    <Loaded resource={comparison}>{(result) => <>
      <fieldset className="ideal-fieldset"><legend>確認・編集へ進める案</legend><div className="ideal-table-wrap" role="region" aria-label="案ごとの数値" tabIndex={0}><table className="ideal-table"><thead><tr><th scope="col">案</th><th scope="col">違反・未確認・未対応</th><th scope="col">前回からの変更</th><th scope="col">希望</th><th scope="col">勤務時間差</th><th scope="col">並び</th></tr></thead><tbody>{result.plans.map((plan: PlanFigures) => <tr key={plan.draft_id}><td><label className="ideal-radio"><input type="radio" name={`${id}-plan`} value={plan.draft_id} checked={chosen === plan.draft_id} disabled={Boolean(plan.duplicate_of)} onChange={() => setChosen(plan.draft_id)} />案 {drafts.indexOf(plan.draft_id) + 1}{plan.duplicate_of ? `（案 ${drafts.indexOf(plan.duplicate_of) + 1} と同じ）` : ""}</label></td><td>{plan.findings.violation}・{plan.findings.unverified}・{plan.findings.unsupported}</td><td>{plan.changes_from_previous ?? "—"}</td><td>{plan.preferences_met} / {plan.preferences_total}</td><td>{hours(plan.work_seconds_spread)}</td><td>{result.order.indexOf(plan.draft_id) + 1}</td></tr>)}</tbody></table></div></fieldset>
      <p className="ideal-note">並びの規則：{result.order_rule}</p><p className="ideal-note">{result.meaning}</p>
      {result.pairs.map((pair) => <p key={`${pair.a}-${pair.b}`} className="ideal-note">案 {drafts.indexOf(pair.a) + 1} と案 {drafts.indexOf(pair.b) + 1}：異なる勤務 {pair.differing_duties}件、関係する職員 {pair.affected_people}名</p>)}
    </>}</Loaded>
    {chosen && <WorkspaceLink className="ideal-button ideal-button--primary" route={routeOf("plan/drafts").route} context={{ input: inputHash, draft: [chosen] }}>選んだ案を確認・編集 <ArrowRight aria-hidden="true" /></WorkspaceLink>}
  </section>;
}
