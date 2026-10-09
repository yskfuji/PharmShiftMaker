"use client";

import { useId } from "react";
import TaskDisclosure, { OnDemandTask, useOnDemand } from "../../shared/TaskDisclosure";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi } from "../api";
import ApplyControl from "./ApplyControl";
import Backfill from "./Backfill";
import CopyErasure from "./CopyErasure";
import DecideCase from "./DecideCase";
import ErasePastInputs from "./ErasePastInputs";
import ErasurePlan from "./ErasurePlan";
import FileRequest from "./FileRequest";
import { DECIDE_TASK, type PrivacyData } from "./model";
import RecordHold from "./RecordHold";
import RegisterExternalCopy from "./RegisterExternalCopy";
import ReviseRule from "./ReviseRule";

export const TASKS = {
  request: "個人情報の開示・訂正・利用停止・消去を請求する",
  decide: "請求を判断する",
  rule: "保存規則を改定する",
  hold: "法的保全を記録・解除する",
  control: "承認済みの消去請求に人物制御を適用する",
  plan: "人物制御後の消去計画を作成し、実行可能分を消去する",
  copies: "職員ごとのコピーの残存を確認し、消去可能分を実行する",
  register: "外部へ渡した出力物を登録する",
  backfill: "既存記録の操作者参照を照合する",
  inputs: "保存期限を過ぎた旧勤務入力を消去する",
} as const;

/** The words a task that cannot be undone always carries, so that it is never told from the
 * routine ones by colour alone. */
const NO_WAY_BACK = "取り消せません";
const ERASURE_NO_WAY_BACK = "消去は取り消せません";

/**
 * What can be done next, in five groups: the requests, the rules and holds, what is done
 * to one person's records, the upkeep of the records, and the planning inputs past their
 * retention. Everybody the route is open to may file a request for themselves; everything
 * else is offered to administrators, and the server enforces it. The groups, their order,
 * and each task's tone, tag and one-line description are fixed here and never derived from
 * the data. What only one task needs (a person's control, a copy plan, the backfill
 * candidates, the planning inputs) is read when that task asks for it, never when the route
 * is shown.
 */
export default function PrivacyTasks({ data, subject }: { data: PrivacyData; subject: { personId: string; name: string } }) {
  const live = useLive();
  const id = useId();
  const api = governanceApi(live.client);
  const backfill = useOnDemand(() => api.backfillCandidates(live.scopeId));
  const inputs = useOnDemand(() => api.erasureCandidates(live.scopeId));
  const admin = live.role === "ADMIN";
  return <div className="ideal-v3-record">
    <section aria-labelledby={`${id}-requests`}>
      <h3 id={`${id}-requests`} className="ideal-v3-heading">請求</h3>
      <div className="ideal-v3-task-list">
        <TaskDisclosure summary={TASKS.request} hint="選択中の職員について、請求の種類と内容を記録します。"><FileRequest key={subject.personId} personId={subject.personId} personName={subject.name} /></TaskDisclosure>
        {admin && <TaskDisclosure id={DECIDE_TASK} tone="primary" summary={TASKS.decide} hint="請求ごとに、次の判断と理由、本人確認の根拠を記録します。"><DecideCase cases={data.cases} people={data.people} /></TaskDisclosure>}
      </div>
    </section>
    {admin ? <>
      <section aria-labelledby={`${id}-rules`}>
        <h3 id={`${id}-rules`} className="ideal-v3-heading">保存規則と法的保全</h3>
        <div className="ideal-v3-task-list">
          <TaskDisclosure summary={TASKS.rule} hint="データの種類ごとの保存日数と根拠を改定します。"><ReviseRule rules={data.rules} /></TaskDisclosure>
          <TaskDisclosure summary={TASKS.hold} hint="職員または部署全体の記録を消去から守る保全を、記録・解除します。"><RecordHold holds={data.holds} people={data.people} /></TaskDisclosure>
        </div>
      </section>
      <section aria-labelledby={`${id}-person`}>
        <h3 id={`${id}-person`} className="ideal-v3-heading">職員ごとの消去</h3>
        <p className="ideal-note">職員1人の記録を消去するときは、まず人物制御を適用し（手順1）、次にその職員の消去計画を作って実行します（手順2）。どの操作も、開いただけでは何も変わりません。</p>
        <details className="ideal-v3-disclosure ideal-v3-disclosure--info ideal-v3-governance-sequence-notes"><summary>3つの操作の関係と、この欄で使うことば</summary>
          <ul role="list" className="ideal-note-list">
            <li>手順2は、手順1を適用した職員にだけ実行できます（サーバーが確かめます）。</li>
            <li>3つ目の操作は、同じ登録済みのコピーの確認と消去を、人物制御を条件にせずに行います。外部管理先の処理確認と保全の判断は、3つ目の操作で記録します。</li>
          </ul>
          <dl className="ideal-definition-list ideal-v3-governance-terms" aria-label="この欄で使うことば">
            <div><dt>人物制御</dt><dd>その職員の職員IDで、記録が作り直されたりコピーが新しく登録されたりするのを止める設定です。記録は消去しません。</dd></div>
            <div><dt>消去計画・確認版</dt><dd>いま何が消去でき、何がなぜ残るかを、サーバーに記録した一覧です。作っただけでは何も消去されません。</dd></div>
            <div><dt>DB記録・管理ファイル</dt><dd>DB記録はデータベースにある記録、管理ファイルはサーバーが保管しているファイルです。管理ファイルの実物は、サーバーの裏側の処理（ワーカー）があとから消去します。</dd></div>
          </dl>
        </details>
        <div className="ideal-v3-task-list ideal-v3-governance-sequence">
          <TaskDisclosure tone="danger" tag={NO_WAY_BACK} summary={TASKS.control} hint="手順1：その職員の記録が作り直されないよう止めます。記録は消去しません。"><ApplyControl people={data.people} /></TaskDisclosure>
          <TaskDisclosure tone="danger" tag={ERASURE_NO_WAY_BACK} summary={TASKS.plan} hint="手順2：消去できる記録とファイルを確かめてから、消去します。"><ErasurePlan people={data.people} /></TaskDisclosure>
          <TaskDisclosure tone="danger" tag={ERASURE_NO_WAY_BACK} summary={TASKS.copies} hint="登録されているコピーの残存を確かめ、消去できる分を消去します。人物制御の適用は条件ではありません。"><CopyErasure people={data.people} /></TaskDisclosure>
        </div>
      </section>
      <section aria-labelledby={`${id}-upkeep`}>
        <h3 id={`${id}-upkeep`} className="ideal-v3-heading">記録の整備</h3>
        <div className="ideal-v3-task-list">
          <TaskDisclosure summary={TASKS.register} hint="外部へ渡したファイルと受渡し先を、残存として登録します。"><RegisterExternalCopy people={data.people} /></TaskDisclosure>
          <OnDemandTask summary={TASKS.backfill} hint="アカウントの紐付けをもとに、既存の記録に、どの職員の記録かを書き足します。もとの記録の内容は変わりません。" resource={backfill}>{(candidates) => <Backfill candidates={candidates} people={data.people} onApplied={() => void backfill.reload()} />}</OnDemandTask>
        </div>
      </section>
      <section aria-labelledby={`${id}-inputs`}>
        <h3 id={`${id}-inputs`} className="ideal-v3-heading">保存期限を過ぎた勤務入力</h3>
        <div className="ideal-v3-task-list">
          <OnDemandTask tone="danger" tag={ERASURE_NO_WAY_BACK} summary={TASKS.inputs} hint="新しい版に置き換えられた旧い勤務入力と、それを参照する計画案・公開版を消去します。開いただけでは何も消去されません。" resource={inputs}>{(candidates) => <ErasePastInputs candidates={candidates} onChanged={() => void inputs.reload()} />}</OnDemandTask>
        </div>
      </section>
    </> : <p className="ideal-note">請求の判断、保存規則の改定、法的保全、人物制御、コピーと旧勤務入力の確認と消去は、サーバーが管理者にだけ許可しています。あなたは、自分の請求を出して、その進み具合を確認できます。</p>}
  </div>;
}
