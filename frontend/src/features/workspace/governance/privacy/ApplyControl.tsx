"use client";

import { useId, useState } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { definite } from "@/ideal/api/mutations";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import { PlanningError } from "@/lib/planningTransport";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type Named, type SubjectControl, type SubjectControlApplied, type SubjectControlBody } from "../api";
import InventoryList from "./InventoryList";
import IrreversibleConfirm from "./IrreversibleConfirm";
import { blockersText, controlStateLabel, copyName, nameIn } from "./model";
import StepOutline from "./StepOutline";

/** A read the server refused says so in its own words; anything else may be tried again. */
export const readProblem = (error: unknown): ProblemModel => problemFrom(error, error instanceof PlanningError && definite(error.status) ? "write" : "read");

/**
 * Applies the person control from an approved erasure decision: choose the person, read
 * what the server holds and which decisions it accepts (`applicable_cases`), choose one,
 * give the reason, confirm. The control erases nothing and can never be changed or removed.
 */
export default function ApplyControl({ people }: { people: Named[] }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const [person, setPerson] = useState("");
  const [control, setControl] = useState<SubjectControl | null>(null);
  const [problem, setProblem] = useState<ProblemModel | null>(null);
  const [reading, setReading] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [reason, setReason] = useState("");
  const [body, setBody] = useState<SubjectControlBody | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<SubjectControlBody, SubjectControlApplied, SubjectControl>({
    name: `subject-control:${person}`,
    send: (request, key) => api.applySubjectControl(live.scopeId, person, { ...request, idempotency_key: key }),
    readCurrent: () => api.subjectControl(live.scopeId, person),
  });
  useUnsavedNavigation(caseId !== "" || reason !== "");
  const name = nameIn(people, person);

  async function choose(target: string) {
    setPerson(target); setControl(null); setProblem(null); setCaseId(""); setReason(""); setBody(null); setDone(null); send.clear();
    if (!target) return;
    setReading(true);
    try { setControl(await api.subjectControl(live.scopeId, target)); steps.moveTo("content"); } catch (error) { setProblem(readProblem(error)); } finally { setReading(false); }
  }
  function leave() { setBody(null); send.clear(); steps.moveTo("content"); }
  async function save() {
    if (!body) return;
    const result = await send.run(body);
    if (!result.done) return;
    const answer = result.result;
    setBody(null); setCaseId(""); setReason("");
    setDone(`人物制御を適用しました（サーバーの状態：${controlStateLabel(answer.state)}）。${answer.all_copies_erased ? "" : "記録とコピーの消去は完了していません（サーバーの回答：全コピーの消去は未完了）。残存の確認と消去は、消去計画の操作で行います。"}`);
    // What was read before the control was applied is not offered again: the form (and the
    // way to the confirmation) comes back only with the server's next answer.
    setControl(null); setReading(true);
    try { setControl(await api.subjectControl(live.scopeId, person).catch(() => null)); } finally { setReading(false); }
    steps.moveTo("target");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear(); setBody(null); setCaseId(""); setControl(now);
    setDone("人物制御は適用していません。現在の状態と、サーバーが受け付ける判断を表示しました。適用できる場合は、判断を選び直してください。");
    steps.moveTo("content");
  }

  const chosenCase = control?.applicable_cases.find((item) => item.case_id === caseId);
  const base = body && control?.applicable_cases.find((item) => item.case_id === body.case_id);
  return <div className="ideal-v3-record">
    <StepOutline steps={["対象の職員を選ぶ", "いまの状態を確かめ、もとにする判断と理由を入力する"]} last="内容を確かめて、人物制御を適用する">この操作では、記録もコピーも消去しません。手順3で同意にチェックを入れ、赤いボタン「人物制御を適用する」を押すと適用されます。それまでは何も変わりません。適用した後は、解除も変更もできません。</StepOutline>
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 対象の職員を選ぶ</h3>
    <div className="ideal-form">
      <label htmlFor={`${id}-person`}>人物制御の対象職員</label>
      <select id={`${id}-person`} className="ideal-input" value={person} disabled={reading || Boolean(body)} onChange={(event) => void choose(event.target.value)}>
        <option value="">選んでください</option>
        {people.map((item) => <option key={item.person_id} value={item.person_id}>{item.name}</option>)}
      </select>
    </div>
    {reading && <p className="ideal-note" role="status">人物制御の状態と残存を読み込んでいます。</p>}
    {problem && <InlineProblem problem={problem} />}
    {control && !body && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. 状態と残存を確かめ、適用する判断と理由を入力する</h3>
      <p className="ideal-note">{name}の人物制御：{controlStateLabel(control.state)}（サーバーの回答）。人物制御は、安定した職員IDでの記録の再作成を止めるもので、記録やコピーは消去しません。別ID・別名義の人物対応は対象外です。</p>
      <InventoryList inventory={control.inventory} label="残存コピーの照合情報" />
      {control.applicable_cases.length === 0 ? <p className="ideal-note">サーバーは、この職員に人物制御を適用できる判断を返していません。承認済みの消去請求があること、有効な法的保全がないこと、制御記録の保存規則が確認済みであること、人物制御が未適用であることをサーバーが確かめます。</p>
        : <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); if (!chosenCase) return; setDone(null); send.clear(); setAttempt((count) => count + 1); setBody({ expected_revision: control.revision, case_id: chosenCase.case_id, case_revision: chosenCase.revision, reason }); }}>
          <label htmlFor={`${id}-case`}>承認済みの消去判断</label>
          <select id={`${id}-case`} className="ideal-input" required value={caseId} onChange={(event) => setCaseId(event.target.value)}>
            <option value="">選んでください</option>
            {control.applicable_cases.map((item, index) => <option key={item.case_id} value={item.case_id} data-verbatim>承認済み判断 {index + 1}：{item.reason}（第{item.revision}版）</option>)}
          </select>
          <p className="ideal-note">選べる判断は、サーバーがいま人物制御を受け付けると答えたものです。</p>
          <label htmlFor={`${id}-reason`}>人物制御の実施理由</label>
          <textarea id={`${id}-reason`} className="ideal-input" required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">取り消せない操作の確認へ進む</button></div>
          <p className="ideal-v3-governance-safe">このボタンでは、まだ適用されません。次の確認で、適用される内容と残る記録を確かめます。</p>
        </form>}
    </>}
    {control && body && <IrreversibleConfirm key={attempt} title="3. 取り消せない操作の確認：人物制御の適用"
      changes={[{ label: `${name}の人物制御`, before: controlStateLabel(control.state), after: "適用済み（コピーの残存あり）" }, { label: "適用する判断", before: "（なし）", after: `${base?.reason ?? ""}（第${body.case_revision}版）`, verbatim: true }, { label: "人物制御の実施理由", before: "（なし）", after: body.reason, verbatim: true }]}
      version={{ from: 0, to: 1 }}
      versionText="人物制御の記録を1件作成します（第1版）。作成した後は、変更も取消しもできません。"
      notified="誰にも通知されません。独立した制御サービスに、この職員の制御が登録されます。操作者・実施理由・判断の版・保存規則の版は、制御記録としてサーバーに残ります。"
      risk="適用前の時点では検出されていません。適用時にサーバーが、選んだ判断が承認済みの消去請求のままであること、有効な法的保全がないこと、制御記録の保存規則が確認済みであること、人物制御が未適用であることを照合します。違っていれば適用せず、競合または拒否として知らせます。1件の制御だけを記録するため、一部だけが適用されることはありません。"
      erased={[]} noneErased="この操作では、記録もコピーも消去されません。"
      kept={[
        ...control.inventory.targets.map((target, index) => `${copyName(target, index)}：残ります（サーバーの残存理由 ${blockersText(target)}）`),
        `人物参照が未確認のコピー ${control.inventory.unverified_copies.length}件、DBに残る本人記録 ${control.inventory.database_records_remaining.length}件は、この操作の後もすべて残ります。`,
        "人物制御の記録そのもの（再作成の防止と復元時の照合に使われます）。",
      ]}
      irreversible={`適用すると、サーバーは${name}の職員IDを使う記録の再作成とコピーの新規登録を拒否し続けます。サーバーは人物制御を第1版で固定し、変更・解除の操作を持ちません。`}
      consent="対象の職員・適用する判断・残る記録を確認し、取り消せない人物制御の適用に同意した"
      outcome={conflictOutcome(send.outcome, (current) => ({
        currentRevision: null,
        currentText: current ? `サーバーが現在返している人物制御の状態は「${controlStateLabel(current.state)}」です。` : "現在の状態を確認できませんでした。",
        rows: [
          { label: "人物制御の状態", base: controlStateLabel(control.state), current: current ? controlStateLabel(current.state) : "（なし）", proposed: "適用済み（コピーの残存あり）" },
          { label: "選んだ判断をサーバーが受け付けるか", base: `受け付ける（第${body.case_revision}版）`, current: ((now) => (now ? `受け付ける（第${now.revision}版）` : "受け付けない"))(current?.applicable_cases.find((item) => item.case_id === body.case_id)), proposed: `第${body.case_revision}版に対して適用` },
        ],
      }))}
      busy={send.busy} confirmLabel="人物制御を適用する" backLabel="適用せずに戻る"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed} />}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
