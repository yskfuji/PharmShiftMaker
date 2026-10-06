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
import TableScrollCue from "../../shared/TableScrollCue";

const hours = (seconds: number) => `${Math.round(seconds / 360) / 10}時間`;

/**
 * The server's two sentences about the order of the plans, in this screen's words: a fixed
 * table from the exact sentence the server returns (application/plan_comparison.py,
 * ORDER_RULE and MEANING) to how it is said here, as a label table is for a code. A
 * sentence this table does not have (the server changed its rule) is shown as the server
 * wrote it, so the screen never keeps an order the server no longer uses.
 * - The rule is the sort key of `compare`: violations, unverified, unsupported, changes
 *   from the previous duties, `preference_cost`, `work_seconds_spread`, then the order the
 *   plans were given in. `preference_cost` adds, for every wish, a weight by the wish's
 *   rank for each assigned duty that overlaps it (`preference_cost` in the same file).
 * - Publishing needs the server's check of the plan: `publish` refuses a plan whose
 *   reviewed hash is not the one sent (application/planning.py, publish).
 */
const ORDER_WORDS: Readonly<Record<string, string>> = {
  "違反の数 → 未確認の数 → 未対応の数 → 前回からの変更数 → 希望のコスト → 勤務時間の差（最大と最小）の小さい順。同じ値なら作成順。":
    "違反、未確認、未対応、前回からの変更、希望に重なった勤務の数（希望の順位で重みづけ）、勤務時間の差の順に比べ、少ない案が上位です。すべて同じなら、案の番号の順です。",
};
const MEANING_WORDS: Readonly<Record<string, string>> = {
  "合成の点数はありません。並びは確認の補助で、公開には確認（review）と検証が必要です。":
    "案を1つの点数にまとめた値はありません。順位は確認の手がかりです。公開するには、「確認・編集」の画面でサーバーの検証を通す必要があります。",
};
const orderWords = (rule: string) => (Object.hasOwn(ORDER_WORDS, rule) ? ORDER_WORDS[rule] : `サーバーの規則で並べたときの順位です（1位が先頭）。規則：${rule}`);
const meaningWords = (meaning: string) => (Object.hasOwn(MEANING_WORDS, meaning) ? MEANING_WORDS[meaning] : meaning);

/**
 * The comparison the route read for the plans and the input of the URL (the server checked
 * the URL's syntax; the API checks that they belong to the scope and the input). It is read
 * here only to try again after a refusal. The plan picked here is the only state, and it
 * travels on in the next link. Until a plan is picked, the place of that link holds a
 * disabled button that says what is missing, so the way on is visible from the start.
 * Every figure is the server's; none is computed here (application/plan_comparison.py):
 * - `order`: the plans sorted by violations, unverified, unsupported, changes from the
 *   previous duties, preference cost and spread; shown as a plan's place, next to its name.
 * - `changes_from_previous`: duties leaving and entering against the published duties the
 *   input version was made from, without those an actual record has replaced
 *   (application/planning.py, published_context); null when it had none.
 * - `changes_from_publication`: another figure, with another base: the duties that are in
 *   the plan or in the publication that is current when the comparison is read, but not in
 *   both (every duty of that publication counts: routers/workflows.py, plan_comparison;
 *   application/plan_comparison.py, plan_figures). It is said under each plan, in neutral
 *   words and whenever the server returned it: the browser does not compare the two.
 * - `preferences_met` (the field's name misleads): the number of preferences that at least
 *   one assigned duty OVERLAPS. A preference is a time someone asked to be free (a
 *   day-off wish, application/planning.py; the solver minimises the overlap), so fewer is
 *   better. Nothing is subtracted here.
 * - `work_seconds_spread`: the longest total minus the shortest among the people who have a
 *   duty in the plan; someone with none is not counted.
 */
export default function CompareDrafts({ draftIds: drafts, inputHash, seed }: { draftIds: string[]; inputHash: string; seed: Seed<PlanComparison> }) {
  const live = useLive();
  const id = useId();
  const [chosen, setChosen] = useState("");
  const comparison = useSeededResource(seed, () => live.client.comparison(live.scopeId, inputHash, drafts));

  return <section className="ideal-panel" aria-labelledby={`${id}-compare`}><div className="ideal-panel__head ideal-v3-planning-head"><div><h2 id={`${id}-compare`}>案の比較</h2><p>同じ入力版から作った案を、同じ数え方の数値で比べます。確認・編集へ進める案を1つ選んでください。</p></div></div>
    <Loaded resource={comparison}>{(result) => <>
      <fieldset className="ideal-fieldset ideal-v3-planning-choice"><legend>確認・編集へ進める案</legend><TableScrollCue /><div className="ideal-table-wrap" role="region" aria-label="案ごとの数値" tabIndex={0}><table className="ideal-table"><thead><tr><th scope="col">案</th><th scope="col">順位</th><th scope="col">違反</th><th scope="col">未確認</th><th scope="col">未対応</th><th scope="col">前回からの変更</th><th scope="col">勤務が重なった希望</th><th scope="col">勤務時間の差</th></tr></thead><tbody>{result.plans.map((plan: PlanFigures) => <tr key={plan.draft_id}><th scope="row"><label className="ideal-radio"><input type="radio" name={`${id}-plan`} value={plan.draft_id} checked={chosen === plan.draft_id} disabled={Boolean(plan.duplicate_of)} onChange={() => setChosen(plan.draft_id)} />案 {drafts.indexOf(plan.draft_id) + 1}{plan.duplicate_of ? `（案 ${drafts.indexOf(plan.duplicate_of) + 1} と同じ）` : ""}</label></th><td>{result.order.indexOf(plan.draft_id) + 1}位</td><td>{plan.findings.violation}件</td><td>{plan.findings.unverified}件</td><td>{plan.findings.unsupported}件</td><td>{plan.changes_from_previous === null ? "—" : `${plan.changes_from_previous}件`}</td><td>{plan.preferences_met} / {plan.preferences_total}件</td><td>{hours(plan.work_seconds_spread)}</td></tr>)}</tbody></table></div>
        <div className="ideal-actions">{chosen
          ? <WorkspaceLink className="ideal-button ideal-button--primary" route={routeOf("plan/drafts").route} context={{ input: inputHash, draft: [chosen] }}>選んだ案を確認・編集 <ArrowRight aria-hidden="true" /></WorkspaceLink>
          : <button type="button" className="ideal-button ideal-button--primary" disabled aria-describedby={`${id}-why`}>案を選んでください</button>}</div>
        <p id={`${id}-why`} className="ideal-note">{chosen ? "進んだ先の「確認・編集」の画面で、選んだ案の割当を1件ずつ確かめられます。進むだけでは、何も保存も公開もされません。" : "表の左端で案を1つ選ぶと、このボタンが「選んだ案を確認・編集」に変わります。進んだ先の画面で、その案の割当を1件ずつ確かめられます。選ぶだけでは、何も保存も公開もされません。"}</p>
      </fieldset>
      <div className="ideal-v3-planning-notes">
        <section aria-labelledby={`${id}-reading`}><h3 id={`${id}-reading`} className="ideal-v3-heading">数値の読み方</h3>
          <dl className="ideal-definition-list ideal-v3-planning-columns">
            <div><dt>順位</dt><dd>{orderWords(result.order_rule)}</dd></div>
            <div><dt>違反・未確認・未対応</dt><dd>その案を検証して見つかった指摘の件数です。</dd></div>
            <div><dt>前回からの変更</dt><dd>前回の勤務表（この入力版が前提にした公開済みの勤務）と入れ替わる勤務の件数です（外れる勤務と、新しく入る勤務の合計）。前回の勤務表がないときは「—」です。</dd></div>
            <div><dt>勤務が重なった希望</dt><dd>勤務を入れないでほしい日時の希望（公休の希望など）のうち、その案の勤務が重なった希望の数 / 希望の総数です。少ないほど希望に沿っています。</dd></div>
            <div><dt>勤務時間の差</dt><dd>その案で割当のある職員のうち、勤務時間の合計がいちばん長い職員と、いちばん短い職員との差です。</dd></div>
          </dl>
          <p className="ideal-note ideal-v3-planning-meaning">{meaningWords(result.meaning)}</p></section>
        <section aria-labelledby={`${id}-pairs`}><h3 id={`${id}-pairs`} className="ideal-v3-heading">案どうしの違い</h3>
          <ul className="ideal-v3-planning-plans" aria-label="案ごとの勤務の件数とほかの案との違い">{result.plans.map((plan: PlanFigures) => {
            const others = result.pairs.filter((pair) => pair.a === plan.draft_id || pair.b === plan.draft_id);
            return <li key={plan.draft_id}>
              <strong>案 {drafts.indexOf(plan.draft_id) + 1}</strong>
              <span>勤務 {plan.assignment_count}件{plan.changes_from_publication === null ? "" : `・公開中の勤務表と異なる勤務 ${plan.changes_from_publication}件`}</span>
              {others.map((pair) => { const other = pair.a === plan.draft_id ? pair.b : pair.a; return <span key={other}>案 {drafts.indexOf(other) + 1} とは：異なる勤務 {pair.differing_duties}件、関係する職員 {pair.affected_people}名</span>; })}
            </li>;
          })}</ul>
          <p className="ideal-note">どの勤務・どの職員が違うかは、この画面には表示されません。案を選んで「確認・編集」へ進むと、その案の割当を1件ずつ確かめられます。</p>
        </section>
      </div>
    </>}</Loaded>
  </section>;
}
