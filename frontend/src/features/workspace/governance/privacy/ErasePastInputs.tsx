"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { jstText } from "../../shared/jst";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type ErasureCandidate, type ErasureCandidates, type InputErased, type InputErasurePlan } from "../api";
import IrreversibleConfirm from "./IrreversibleConfirm";

type PreviewBody = { expected_revision: 0; payload: { input_hash: string } };
type ExecuteBody = { expected_revision: 0; payload: { plan_id: string; fingerprint: string } };
type Stage = "idle" | "plan" | "result";

const TABLES: Record<string, string> = {
  planning_inputs: "勤務入力", planning_drafts: "計画案", planning_publications: "公開版", planning_jobs: "勤務表の生成処理", planning_outbox: "監査・通知の記録",
  planning_receipts: "操作の受付記録", planning_notification_reads: "通知の既読記録", planning_leave_events: "休暇台帳の記録",
};
const tableLabel = (table: string) => TABLES[table] ?? table;
const inputLabel = (input: ErasureCandidate) => `${jstText(input.period.start)} 〜 ${jstText(input.period.end)}・入力 第${input.input_revision}版`;
const answerOf = (input: { erasable: boolean; blockers: string[] } | null) => (input ? (input.erasable ? "消去できる" : `消去できない（${input.blockers.join("、")}）`) : "この入力はサーバーにありません");
/** The plan's rows by the table they are in, in the server's order. */
function byTable(plan: InputErasurePlan): Array<{ table: string; count: number }> {
  const groups: Array<{ table: string; count: number }> = [];
  for (const target of plan.targets) {
    const group = groups.find((item) => item.table === target.table);
    if (group) group.count += 1; else groups.push({ table: target.table, count: 1 });
  }
  return groups;
}

/**
 * Erases one superseded planning input whose retention period has passed, with everything
 * that refers to it. Which inputs can be erased, why another cannot, what exactly is erased
 * and what stays are the server's answers: the list and the plan are shown as it gives
 * them, and nothing about retention is worked out here. The erasure cannot be undone.
 */
export default function ErasePastInputs({ candidates, onChanged }: { candidates: ErasureCandidates; onChanged: () => void }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "result">();
  const [chosen, setChosen] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [plan, setPlan] = useState<InputErasurePlan | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const planning = useConfirmedSend<PreviewBody, InputErasurePlan, never>({
    name: `input-erasure-preview:${chosen}`,
    send: (body, key) => api.previewInputErasure(live.scopeId, { ...body, idempotency_key: key }),
    // Making a plan compares nothing with an earlier one: a 409 is the server's refusal.
    readCurrent: () => Promise.reject(new Error("no current version")),
  });
  const executing = useConfirmedSend<ExecuteBody, InputErased, ErasureCandidate>({
    name: `input-erasure-execute:${chosen}`,
    send: (body, key) => api.executeInputErasure(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: async () => (await api.erasureCandidates(live.scopeId)).inputs.find((input) => input.input_hash === chosen) ?? null,
  });
  useUnsavedNavigation(Boolean(plan));
  const erasable = candidates.inputs.filter((input) => input.erasable);
  const refused = candidates.inputs.filter((input) => !input.erasable);
  const input = candidates.inputs.find((item) => item.input_hash === chosen);

  function forget(said: string | null) { setPlan(null); setStage("idle"); planning.clear(); executing.clear(); setNote(said); steps.moveTo("target"); }
  async function makePlan() {
    const result = await planning.run({ expected_revision: 0, payload: { input_hash: chosen } });
    if (!result.done) return;
    setPlan(result.result); setStage("result"); setNote(null); setAttempt((count) => count + 1);
    if (!result.result.erasable) steps.moveTo("result");
  }
  async function execute() {
    if (!plan) return;
    const result = await executing.run({ expected_revision: 0, payload: { plan_id: plan.plan_id, fingerprint: plan.fingerprint } });
    if (!result.done) return;
    const answer = result.result;
    setPlan(null); setStage("idle"); setChosen(""); setNote(null);
    setDone(answer.duplicate ? "この確認版は既に実行済みでした（サーバーの回答）。新たに消去したものはありません。" : `サーバーの結果：${answer.deleted ?? 0}件を消去しました（確認版の状態：${answer.status === "EXECUTED" ? "実行済み" : answer.status}）。消去した入力は、一覧から読み込めなくなりました。`);
    onChanged();
    steps.moveTo("target");
  }

  const groups = plan ? byTable(plan) : [];
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 消去する旧勤務入力を選ぶ</h3>
    <p className="ideal-note">消去できるのは、新しい版に置き換えられた旧い勤務入力のうち、サーバーが保存期限の経過と消去の可否を確認したものだけです。下の一覧は {jstText(candidates.observed_at)}（日本時間）時点のサーバーの回答です。</p>
    {erasable.length === 0 ? <p className="ideal-note">サーバーが消去できると答えた勤務入力はありません。</p>
      : <div className="ideal-table-wrap" role="region" aria-label="サーバーが消去できると答えた勤務入力" tabIndex={0}><table className="ideal-table">
        <thead><tr><th scope="col">対象期間（日本時間）</th><th scope="col">入力の版</th><th scope="col">登録日時（日本時間）</th><th scope="col">消去される記録</th></tr></thead>
        <tbody>{erasable.map((item) => <tr key={item.input_hash}><th scope="row">{jstText(item.period.start)} 〜 {jstText(item.period.end)}</th><td>第{item.input_revision}版</td><td>{jstText(item.registered_at)}</td><td>{item.target_count}件</td></tr>)}</tbody>
      </table></div>}
    {refused.length > 0 && <ul className="ideal-note-list" aria-label="サーバーが消去できないと答えた勤務入力と理由">{refused.map((item) => <li key={item.input_hash}>{inputLabel(item)}：{item.blockers.join("、")}</li>)}</ul>}
    {candidates.inputs.length > 0 && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); setNote(null); planning.clear(); setStage("plan"); }}>
      <label htmlFor={`${id}-input`}>確認する勤務入力</label>
      <select id={`${id}-input`} className="ideal-input" required value={chosen} disabled={stage !== "idle"} onChange={(event) => { setChosen(event.target.value); setDone(null); setNote(null); }}>
        <option value="">選んでください</option>
        {candidates.inputs.map((item) => <option key={item.input_hash} value={item.input_hash}>{inputLabel(item)}（サーバーの回答：{item.erasable ? "消去できる" : "消去できない"}）</option>)}
      </select>
      {stage === "idle" && <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">確認版の作成内容を確認する</button></div>}
    </form>}
    {note && <p className="ideal-note" role="status">{note}</p>}
    {input && stage === "plan" && <ConfirmSurface title="2. 確認版の作成前の確認"
      changes={[{ label: `${inputLabel(input)}の消去の確認版`, before: "（なし）", after: "消去される記録と消去できない理由を記録した確認版を1件作成" }]}
      version={{ from: 0, to: 1 }}
      versionText="消去の確認版（消去計画）を1件作成します。確認版を作成しても、何も消去されません。"
      notified="誰にも通知されません。確認版の作成の記録（操作者・時刻）は監査の履歴に残ります。"
      risk="作成前の時点では検出されていません。確認版は新しい記録として1件だけ作成されるため、ほかの更新とは競合せず、一部だけが作成されることもありません。"
      outcome={conflictOutcome(planning.outcome, () => ({ currentRevision: null, rows: [] }))}
      busy={planning.busy} confirmLabel="確認版を作成する" backLabel="作成せずに戻る"
      onConfirm={() => void makePlan()} onBack={() => forget(null)} onReviewed={() => forget(null)} />}
    {input && plan && stage === "result" && !plan.erasable && <>
      <h3 className="ideal-v3-heading" {...steps.heading("result")}>3. サーバーの確認結果：この入力は消去できません</h3>
      <p className="ideal-note">サーバーは、次の理由でこの勤務入力を消去できないと答えました。消去の実行は行えません。</p>
      <ul className="ideal-note-list" aria-label="サーバーが返した消去できない理由">{plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={() => { forget(null); onChanged(); }}>入力の選択に戻る</button></div>
    </>}
    {input && plan && stage === "result" && plan.erasable && <IrreversibleConfirm key={attempt} title="3. 取り消せない操作の確認：旧勤務入力の消去"
      changes={groups.map((group) => ({ label: `${tableLabel(group.table)} ${group.count}件`, before: "保存中", after: "消去" }))}
      version={{ from: 0, to: 1 }}
      versionText={`確認版は実行済みになります。消去した記録ごとに、消去済みの記録（表・識別子・消去前の照合値）が1件ずつ、計${plan.targets.length}件作成されます。`}
      notified="誰にも通知されません。消去の実行の記録（確認版・件数・操作者・時刻）は監査の履歴に残ります。"
      risk="実行前の時点では検出されていません。実行時にサーバーが、保存規則・法的保全・消去される記録が確認版の作成時から変わっていないことを照合し、変わっていれば1件も消去せず、競合として知らせます。全対象を1回の処理で消去するため、一部だけが消去されることはありません。"
      erased={groups.map((group) => `${inputLabel(input)}の${tableLabel(group.table)}：${group.count}件`)}
      noneErased="サーバーが返した消去対象はありません。"
      kept={[
        `消去済みの記録 ${plan.targets.length}件（表・識別子・消去前の照合値だけを持ち、内容は持ちません）。`,
        "実行済みの確認版と、消去の実行の監査記録。",
        ...plan.limitations.map((limitation) => `サーバーが返した制限事項：${limitation}`),
      ]}
      irreversible={`消去した勤務入力と、それを参照する計画案・公開版・生成処理・受付記録・通知の記録は復元できません。消去した後は、この期間のこの版の勤務表を再現できません。${plan.irreversible ? "サーバーの回答でも、この消去は不可逆です。" : ""}`}
      consent="消去される記録と残る記録を確認し、取り消せない消去に同意した"
      outcome={conflictOutcome(executing.outcome, (current) => ({
        currentRevision: null,
        currentText: "保存規則・法的保全・消去される記録が、確認版の作成後に変わりました。サーバーが現在返している回答を「現在」に示します。",
        rows: [
          { label: "サーバーの回答", base: answerOf(plan), current: answerOf(current), proposed: "消去する" },
          { label: "消去される記録の件数", base: `${plan.targets.length}件`, current: current ? `${current.target_count}件` : "（なし）", proposed: `${plan.targets.length}件` },
        ],
      }))}
      busy={executing.busy} confirmLabel="この旧勤務入力を消去する" backLabel="消去せずに戻る"
      onConfirm={() => void execute()} onBack={() => forget("この確認版は実行していません。")}
      onReviewed={() => { forget("この確認版は実行していません。保存規則・法的保全・対象が変わったため、一覧を読み直しました。確認版を作り直してください。"); onChanged(); }}>
      <details className="ideal-v3-disclosure"><summary>識別情報</summary>
        <p className="ideal-note">入力の識別子（SHA-256）：{plan.input_hash}</p>
        <ul className="ideal-note-list">{plan.targets.map((target) => <li className="ideal-note" key={`${target.table}:${target.key}`}>{tableLabel(target.table)}：{target.key}</li>)}</ul>
      </details>
    </IrreversibleConfirm>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
