"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { threeWayRows } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type CopiesExecuted, type CopyInventory, type CopyPreview, type Named } from "../api";
import ConfirmExternal from "./ConfirmExternal";
import InventoryList from "./InventoryList";
import IrreversibleConfirm from "./IrreversibleConfirm";
import { erasureLines, inventoryFacts, nameIn, splitTargets } from "./model";
import PreservationReview from "./PreservationReview";
import StepOutline from "./StepOutline";

type PreviewBody = { expected_revision: 0; payload: { person_id: string } };
type ExecuteBody = { expected_revision: number; payload: { plan_id: string; fingerprint: string } };
type Stage = "idle" | "plan" | "review" | "execute";

/**
 * The registered copies of one person: record them as they are now (a plan), read what the
 * server would process and what it keeps and why, record an outside custodian's
 * confirmation or a preservation decision where the server asks for one, then erase what
 * can be erased. The erasure cannot be undone; the server checks everything again.
 */
export default function CopyErasure({ people }: { people: Named[] }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "plan">();
  const [person, setPerson] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const planning = useConfirmedSend<PreviewBody, CopyPreview, never>({
    name: `copy-preview:${person}`,
    send: (body, key) => api.previewCopies(live.scopeId, { ...body, idempotency_key: key }),
    // Making a plan compares nothing with an earlier one: a 409 is the server's refusal.
    readCurrent: () => Promise.reject(new Error("no current version")),
  });
  const executing = useConfirmedSend<ExecuteBody, CopiesExecuted, CopyInventory>({
    name: `copy-execute:${person}`,
    send: (body, key) => api.executeCopies(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: () => api.copyInventory(live.scopeId, person),
  });
  useUnsavedNavigation(Boolean(preview));
  const name = nameIn(people, person);

  function choose(target: string) { setPerson(target); setPreview(null); setStage("idle"); setNote(null); setDone(null); planning.clear(); executing.clear(); }
  function forgetPlan(said: string) { setPreview(null); setStage("idle"); planning.clear(); executing.clear(); setNote(said); steps.moveTo("target"); }
  async function makePlan() {
    const result = await planning.run({ expected_revision: 0, payload: { person_id: person } });
    if (!result.done) return;
    setPreview(result.result); setStage("review"); setNote(null);
    steps.moveTo("plan");
  }
  async function execute() {
    if (!preview) return;
    const result = await executing.run({ expected_revision: preview.revision, payload: { plan_id: preview.plan_id, fingerprint: preview.fingerprint } });
    if (!result.done) return;
    const answer = result.result;
    setPreview(null); setStage("idle"); setNote(null);
    setDone(`サーバーの結果：DB記録の消去 ${answer.erased_database_copy_ids.length}件、部分履歴の保全 ${answer.preserved_archive_ids.length}件、管理ファイルの消去待ち ${answer.queued_copy_ids.length}件。${answer.all_copies_complete ? "" : "全コピーの消去は完了していません（サーバーの回答）。残存を確認し直してください。"}`);
    steps.moveTo("target");
  }

  const lines = preview ? erasureLines(splitTargets(preview)) : null;
  return <div className="ideal-v3-record">
    <StepOutline steps={["対象の職員を選ぶ", "確認版を作る（いまの残存を記録するだけです）", { step: "消去されるものと残る理由を確かめる", mark: "取り消せない記録を含むことがあります" }]} last="同意して、消去できる分を消去する"
      more={["手順3で外部へ渡した保存物に「外部管理先の処理確認」を記録すると、その記録は取り消せません（その保存物は確認済みになり、記録し直せません）。", "手順3で記録する保全の判断は、記録し直せますが、取り下げる操作はありません。"]}>手順1〜3では、何も消去されません。消去されるのは、手順4で同意にチェックを入れ、赤いボタン「この確認版の消去可能分を実行する」を押したときだけです。消去した記録は復元できません。</StepOutline>
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 対象の職員を選ぶ</h3>
    <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); setNote(null); planning.clear(); setStage("plan"); }}>
      <label htmlFor={`${id}-person`}>コピーを確認する職員</label>
      <select id={`${id}-person`} className="ideal-input" required value={person} disabled={stage !== "idle"} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        {people.map((item) => <option key={item.person_id} value={item.person_id}>{item.name}</option>)}
      </select>
      <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>確認と消去のしくみ</summary>
        <p className="ideal-note">バックアップ、外部コピー、未確認の記録の残存を区別して確認します。共有の記録は、他の職員の保全内容を確認してから元の版を消去します。管理ファイルの実物は、サーバーの裏側の処理（この画面では「ワーカー」と書きます）が、保全の状態を確かめ直してから消去します。</p>
      </details>
      {stage === "idle" && <>
        <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">確認版の作成内容を確認する</button></div>
        <p className="ideal-v3-governance-safe">このボタンでは、何も消去されません。確認版は、いま何が消去でき、何がなぜ残るかをサーバーに記録した一覧です。</p>
      </>}
      {note && <p className="ideal-note" role="status">{note}</p>}
    </form>
    {stage === "plan" && <ConfirmSurface title="2. 確認版の作成前の確認"
      changes={[{ label: `${name}のコピーの確認版`, before: "（なし）", after: "現在の残存を記録した確認版を1件作成" }]}
      version={{ from: 0, to: 1 }}
      versionText="コピーの確認版（消去計画）を1件作成します。確認版を作成しても、何も消去されません。"
      notified="誰にも通知されません。確認版の作成の記録（操作者・時刻）は監査の履歴に残ります。"
      risk="作成前の時点では検出されていません。確認版は新しい記録として1件だけ作成されるため、ほかの更新とは競合せず、一部だけが作成されることもありません。"
      outcome={conflictOutcome(planning.outcome, () => ({ currentRevision: null, rows: [] }))}
      busy={planning.busy} confirmLabel="確認版を作成する" backLabel="作成せずに戻る"
      onConfirm={() => void makePlan()} onBack={() => { planning.clear(); setStage("idle"); steps.moveTo("target"); }} onReviewed={() => { planning.clear(); setStage("idle"); }} />}
    {preview && stage === "review" && <>
      <h3 className="ideal-v3-heading" {...steps.heading("plan")}>3. 対象と残存理由を確かめる</h3>
      <p className="ideal-note">確認版（第{preview.revision}版）を作成しました。保存期限・保全・共有情報の判断は、実行時にもサーバーが照合し直します。</p>
      <InventoryList inventory={preview} label="コピーの消去対象と残存理由" each={(target, index) => <>
        {target.medium === "external" && <ConfirmExternal target={target} label={`保存物 ${index + 1}`} personId={person} onRecorded={forgetPlan} />}
        {target.preservation && <PreservationReview copyId={target.copy_id} label={`保存物 ${index + 1}`} personId={person} people={people} onRecorded={forgetPlan} />}
      </>} />
      <div className="ideal-actions">
        <button type="button" className="ideal-button ideal-button--primary" onClick={() => { executing.clear(); setAttempt((count) => count + 1); setStage("execute"); }}>取り消せない操作の確認へ進む</button>
        <button type="button" className="ideal-button ideal-button--secondary" onClick={() => forgetPlan("この確認版は実行していません。")}>実行せずに確認版を破棄する</button>
      </div>
      <p className="ideal-v3-governance-safe">「取り消せない操作の確認へ進む」を押しても、まだ何も消去されません。次の確認で、消去されるものと残るものを確かめてから実行します。</p>
    </>}
    {preview && lines && stage === "execute" && <IrreversibleConfirm key={attempt} title="4. 取り消せない操作の確認：消去可能分の実行"
      changes={lines.changes}
      version={{ from: preview.revision, to: preview.revision + 1 }}
      versionText={`確認版は第${preview.revision}版 → 第${preview.revision + 1}版になります。消去したDB記録ごとに、消去済みの記録（識別子と照合値）が残ります。`}
      notified="誰にも通知されません。実行の記録（確認版・件数・操作者・時刻）は監査の履歴に残ります。"
      risk="実行前の時点では検出されていません。実行時にサーバーが、保全・保存規則・対象の内容が確認版の作成時から変わっていないことを照合し、変わっていれば1件も処理せず、競合として知らせます。DB記録の消去と管理ファイルの消去待ちへの登録は、1回の処理でまとめて行われます。管理ファイルの実物は、その後にワーカーが消去し、失敗した場合は再試行されます（その間、ファイルは残ります）。"
      erased={lines.erased}
      noneErased={lines.unstated ?? "サーバーが処理の対象と答えたコピーはありません。この確認版を実行しても、何も消去されません。"}
      kept={[
        ...lines.kept,
        `人物参照が未確認のコピー ${preview.unverified_copies.length}件と、DBに残る本人記録 ${preview.database_records_remaining.length}件は、この実行では消去済みになりません。`,
        "確認版と、消去済みの記録（復元時の照合に使われます）。",
      ]}
      irreversible="消去したDB記録と、ワーカーが消去した管理ファイルは復元できません。共有の記録は、他の職員の履歴を部分履歴として保全した上で、元の版を消去します。"
      consent="対象と残存理由を確認し、実行可能分だけの処理に同意した"
      outcome={conflictOutcome(executing.outcome, (current) => ({
        currentRevision: null,
        currentText: "保全・保存規則・対象が、確認版の作成後に変わりました。サーバーが現在返している残存を「現在」に示します。",
        rows: threeWayRows(inventoryFacts(preview), current && inventoryFacts(current), inventoryFacts(preview)),
      }))}
      busy={executing.busy} confirmLabel="この確認版の消去可能分を実行する" backLabel="実行せずに戻る"
      onConfirm={() => void execute()} onBack={() => { executing.clear(); setStage("review"); steps.moveTo("plan"); }}
      onReviewed={() => forgetPlan("この確認版は実行していません。保全・保存規則・対象が変わったため、確認版を作り直して残存理由を確認し直してください。")} />}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
