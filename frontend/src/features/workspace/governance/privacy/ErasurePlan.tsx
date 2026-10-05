"use client";

import { useId, useRef, useState } from "react";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { threeWayRows } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type Named, type SubjectControl, type SubjectExecuteBody, type SubjectExecuted, type SubjectPlan } from "../api";
import { readProblem } from "./ApplyControl";
import InventoryList from "./InventoryList";
import IrreversibleConfirm from "./IrreversibleConfirm";
import JointReview from "./JointReview";
import { controlStateLabel, erasureLines, inventoryFacts, nameIn, splitTargets } from "./model";

type PlanBody = { expected_revision: number };
type Stage = "idle" | "plan" | "review" | "execute";
/** Which plan a read of what remains belongs to. */
const planKey = (plan: SubjectPlan) => `${plan.plan_id}:${plan.revision}`;

/**
 * After the person control: make a plan of the person's copies as they are now, read what
 * the server would process and what it keeps and why, then erase what can be erased. The
 * plan and the erasure are two confirmations; the erasure cannot be undone. The revisions
 * sent are the ones the server returned; the server checks everything again when it erases.
 */
export default function ErasurePlan({ people }: { people: Named[] }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content" | "plan">();
  const [person, setPerson] = useState("");
  const [control, setControl] = useState<SubjectControl | null>(null);
  const [problem, setProblem] = useState<ProblemModel | null>(null);
  const [reading, setReading] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [plan, setPlan] = useState<SubjectPlan | null>(null);
  // The plan whose remains were read from the server after it was made. A plan that was
  // just made has none: the plan is shown, and neither the irreversible confirmation nor
  // the erasure is offered for it until that read has succeeded and no read is in flight.
  const [remainsOf, setRemainsOf] = useState<string | null>(null);
  // Only the read started last is shown: an earlier one that answers later changes nothing.
  const lastRead = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const planning = useConfirmedSend<PlanBody, SubjectPlan, SubjectControl>({
    name: `subject-plan:${person}`,
    send: (body, key) => api.planSubjectErasure(live.scopeId, person, { ...body, idempotency_key: key }),
    readCurrent: () => api.subjectControl(live.scopeId, person),
  });
  const executing = useConfirmedSend<SubjectExecuteBody, SubjectExecuted, SubjectControl>({
    name: `subject-execute:${person}`,
    send: (body, key) => api.executeSubjectErasure(live.scopeId, person, { ...body, idempotency_key: key }),
    readCurrent: () => api.subjectControl(live.scopeId, person),
  });
  useUnsavedNavigation(Boolean(plan));
  const name = nameIn(people, person);
  // The list on screen is the one read after this plan was made, and nothing newer is being read.
  const ready = plan !== null && remainsOf === planKey(plan) && !reading;

  /** `keep`: on a failed read the control read before stays (a plan made from it is on screen). */
  async function read(target: string, keep = false) {
    const mine = ++lastRead.current;
    const last = () => mine === lastRead.current;
    setReading(true); setProblem(null);
    try {
      const now = await api.subjectControl(live.scopeId, target);
      if (!last()) return null;
      setControl(now); return now;
    } catch (error) {
      if (!last()) return null;
      if (!keep) setControl(null);
      setProblem(readProblem(error)); return null;
    } finally { if (last()) setReading(false); }
  }
  async function choose(target: string) {
    setPerson(target); setControl(null); setPlan(null); setRemainsOf(null); setStage("idle"); setNote(null); setDone(null); planning.clear(); executing.clear();
    if (target && await read(target)) steps.moveTo("content");
  }
  function forgetPlan(said: string) { setPlan(null); setRemainsOf(null); setProblem(null); setStage("idle"); executing.clear(); planning.clear(); setNote(said); steps.moveTo("content"); }
  async function makePlan() {
    if (!control) return;
    const result = await planning.run({ expected_revision: control.revision });
    if (!result.done) return;
    // The plan exists on the server from here on, so it is kept on screen whatever follows.
    // What was read before the plan says nothing about it: its remains are not read yet.
    setPlan(result.result); setRemainsOf(null); setStage("review"); setNote(null);
    // It holds identifiers only: what it found is read from the server again. A failed read
    // is shown beside the plan, and the read can be repeated.
    await readRemains(result.result);
    steps.moveTo("plan");
  }
  async function readRemains(of: SubjectPlan) { if (await read(person, true)) setRemainsOf(planKey(of)); }
  async function execute() {
    if (!control || !plan || !ready) return;
    const result = await executing.run({ expected_revision: control.revision, plan_id: plan.plan_id, plan_revision: plan.revision, fingerprint: plan.fingerprint });
    if (!result.done) return;
    const answer = result.result;
    setPlan(null); setRemainsOf(null); setStage("idle"); setNote(null);
    setDone(`サーバーの結果：DB記録の消去 ${answer.erased_database_count}件、部分履歴の保全 ${answer.preserved_archive_count}件、管理ファイルの消去待ち ${answer.queued_count}件。${answer.all_copies_erased ? "" : "全コピーの消去は完了していません（サーバーの回答）。残存を照合し直してください。"}`);
    await read(person);
    steps.moveTo("content");
  }

  // The flags of the plan that will be executed; the inventory's own for a copy it does not name.
  const lines = control ? erasureLines(splitTargets(control.inventory, plan?.targets)) : null;
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 対象の職員を選ぶ</h3>
    <div className="ideal-form">
      <label htmlFor={`${id}-person`}>消去計画の対象職員</label>
      <select id={`${id}-person`} className="ideal-input" value={person} disabled={reading || stage !== "idle"} onChange={(event) => void choose(event.target.value)}>
        <option value="">選んでください</option>
        {people.map((item) => <option key={item.person_id} value={item.person_id}>{item.name}</option>)}
      </select>
    </div>
    {reading && <p className="ideal-note" role="status">人物制御の状態と残存を読み込んでいます。</p>}
    {problem && <InlineProblem problem={problem} />}
    {control && stage === "idle" && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. 人物制御の状態を確かめ、消去計画を作成する</h3>
      <p className="ideal-note">{name}の人物制御：{controlStateLabel(control.state)}（サーバーの回答）。</p>
      {control.state === "NOT_APPLIED" ? <p className="ideal-note">人物制御は未適用です。消去計画は、人物制御を適用した後に作成できます。</p>
        : <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--primary" onClick={() => { setDone(null); setNote(null); planning.clear(); setStage("plan"); }}>消去計画の作成内容を確認する</button></div>}
      {note && <p className="ideal-note" role="status">{note}</p>}
    </>}
    {control && stage === "plan" && <ConfirmSurface title="3. 消去計画の作成前の確認"
      changes={[{ label: `${name}の消去計画`, before: "（なし）", after: "現在の残存を記録した計画を1件作成" }]}
      version={{ from: 0, to: 1 }}
      versionText="消去計画を1件作成します。計画を作成しても、何も消去されません。"
      notified="誰にも通知されません。計画の作成の記録（操作者・時刻）は監査の履歴に残ります。"
      risk="作成前の時点では検出されていません。作成時にサーバーが、人物制御が適用済みであることを照合します。違っていれば作成せず、競合として知らせます。計画は1件だけ作成され、一部だけが作成されることはありません。"
      outcome={conflictOutcome(planning.outcome, (current) => ({ currentRevision: null, currentText: current ? `サーバーが現在返している人物制御の状態は「${controlStateLabel(current.state)}」です。` : "現在の状態を確認できませんでした。", rows: [{ label: "人物制御の状態", base: controlStateLabel(control.state), current: current ? controlStateLabel(current.state) : "（なし）", proposed: controlStateLabel(control.state) }] }))}
      busy={planning.busy} confirmLabel="消去計画を作成する" backLabel="作成せずに戻る"
      onConfirm={() => void makePlan()} onBack={() => { planning.clear(); setStage("idle"); steps.moveTo("content"); }}
      onReviewed={() => { const now = planning.outcome.kind === "conflict" ? planning.outcome.current : null; planning.clear(); if (now) setControl(now); setStage("idle"); steps.moveTo("content"); }} />}
    {control && plan && (stage === "review" || stage === "execute") && !ready && <>
      <h3 className="ideal-v3-heading" {...steps.heading("plan")}>4. 計画の内容を確かめる</h3>
      <p className="ideal-note">消去計画（第{plan.revision}版）は作成済みで、サーバーに記録されています。{reading ? "作成後の残存を読み込んでいるため、計画の内容はまだ表示していません。読み込みが終わるまで、実行には進めません。" : "作成後の残存を読み込めなかったため、計画の内容はまだ表示していません。残存を読み込み直すまで、実行には進めません。"}</p>
      <div className="ideal-actions">
        <button type="button" className="ideal-button ideal-button--primary" disabled={reading} onClick={() => void readRemains(plan)}>残存を読み込み直す</button>
        <button type="button" className="ideal-button ideal-button--secondary" disabled={reading} onClick={() => forgetPlan("この計画は実行していません。")}>実行せずに計画を破棄する</button>
      </div>
    </>}
    {control && plan && stage === "review" && ready && <>
      <h3 className="ideal-v3-heading" {...steps.heading("plan")}>4. 計画の内容を確かめる</h3>
      <p className="ideal-note">消去計画（第{plan.revision}版）を作成しました。下の内容は、サーバーが現在返している残存です。保存規則・保全・共有情報の判断は、実行時にもサーバーが照合し直します。処理の対象が0件でも、残存を消去済みにはしません。</p>
      <InventoryList inventory={control.inventory} label="消去計画の対象と残存理由"
        each={(target, index) => (target.medium === "file" ? <JointReview copyId={target.copy_id} label={`保存物 ${index + 1}`} people={people} onRecorded={() => forgetPlan("共同判断を記録しました。残存が変わるため、消去計画を作り直してください。")} /> : null)} />
      <div className="ideal-actions">
        <button type="button" className="ideal-button ideal-button--primary" onClick={() => { executing.clear(); setAttempt((count) => count + 1); setStage("execute"); }}>取り消せない操作の確認へ進む</button>
        <button type="button" className="ideal-button ideal-button--secondary" onClick={() => forgetPlan("この計画は実行していません。")}>実行せずに計画を破棄する</button>
      </div>
    </>}
    {control && plan && lines && stage === "execute" && ready && <IrreversibleConfirm key={attempt} title="5. 取り消せない操作の確認：消去計画の実行"
      changes={lines.changes}
      version={{ from: plan.revision, to: plan.revision + 1 }}
      versionText={`消去計画は第${plan.revision}版 → 第${plan.revision + 1}版になります。消去したDB記録ごとに、消去済みの記録（識別子と照合値）が残ります。`}
      notified="誰にも通知されません。実行の記録（計画・件数・操作者・時刻）は監査の履歴に残ります。"
      risk="実行前の時点では検出されていません。実行時にサーバーが、保全・保存規則・対象の内容が計画の作成時から変わっていないことを照合し、変わっていれば1件も処理せず、競合として知らせます。DB記録の消去と管理ファイルの消去待ちへの登録は、1回の処理でまとめて行われます。管理ファイルの実物は、その後にワーカーが消去し、失敗した場合は再試行されます（その間、ファイルは残ります）。"
      erased={lines.erased}
      noneErased={lines.unstated ?? "サーバーが処理の対象と答えたコピーはありません。この計画を実行しても、何も消去されません。"}
      kept={[
        ...lines.kept,
        `人物参照が未確認のコピー ${control.inventory.unverified_copies.length}件と、DBに残る本人記録 ${control.inventory.database_records_remaining.length}件は、この実行では消去済みになりません。`,
        "人物制御の記録、消去計画、消去済みの記録（再作成の防止と復元時の照合に使われます）。",
      ]}
      irreversible="消去したDB記録と、ワーカーが消去した管理ファイルは復元できません。共有の記録は、他の職員の履歴を部分履歴として保全した上で、元の版を消去します。"
      consent="対象と残存理由を確認し、実行可能分だけの処理に同意した"
      outcome={conflictOutcome(executing.outcome, (current) => ({
        currentRevision: null,
        currentText: "保全・保存規則・対象が、計画の作成後に変わりました。サーバーが現在返している残存を「現在」に示します。",
        rows: threeWayRows(inventoryFacts(control.inventory), current && inventoryFacts(current.inventory), inventoryFacts(control.inventory)),
      }))}
      busy={executing.busy} confirmLabel="この計画の実行可能分を消去する" backLabel="実行せずに戻る"
      onConfirm={() => void execute()} onBack={() => { executing.clear(); setStage("review"); steps.moveTo("plan"); }}
      onReviewed={() => { const now = executing.outcome.kind === "conflict" ? executing.outcome.current : null; if (now) setControl(now); forgetPlan("この計画は実行していません。保全・保存規則・対象が変わったため、消去計画を作り直して残存理由を確認し直してください。"); }} />}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
