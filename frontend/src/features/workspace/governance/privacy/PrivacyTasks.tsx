"use client";

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
import type { PrivacyData } from "./model";
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

/**
 * What can be done next. Everybody the route is open to may file a request for themselves;
 * everything else is offered to administrators, and the server enforces it. What only one
 * task needs (a person's control, a copy plan, the backfill candidates, the planning inputs) is read when that
 * task asks for it, never when the route is shown.
 */
export default function PrivacyTasks({ data, subject }: { data: PrivacyData; subject: { personId: string; name: string } }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const backfill = useOnDemand(() => api.backfillCandidates(live.scopeId));
  const inputs = useOnDemand(() => api.erasureCandidates(live.scopeId));
  return <div className="ideal-stack">
    <TaskDisclosure summary={TASKS.request}><FileRequest key={subject.personId} personId={subject.personId} personName={subject.name} /></TaskDisclosure>
    {live.role === "ADMIN" ? <>
      <TaskDisclosure summary={TASKS.decide}><DecideCase cases={data.cases} people={data.people} /></TaskDisclosure>
      <TaskDisclosure summary={TASKS.rule}><ReviseRule rules={data.rules} /></TaskDisclosure>
      <TaskDisclosure summary={TASKS.hold}><RecordHold holds={data.holds} people={data.people} /></TaskDisclosure>
      <TaskDisclosure summary={TASKS.control}><ApplyControl people={data.people} /></TaskDisclosure>
      <TaskDisclosure summary={TASKS.plan}><ErasurePlan people={data.people} /></TaskDisclosure>
      <TaskDisclosure summary={TASKS.copies}><CopyErasure people={data.people} /></TaskDisclosure>
      <TaskDisclosure summary={TASKS.register}><RegisterExternalCopy people={data.people} /></TaskDisclosure>
      <OnDemandTask summary={TASKS.backfill} resource={backfill}>{(candidates) => <Backfill candidates={candidates} people={data.people} onApplied={() => void backfill.reload()} />}</OnDemandTask>
      <OnDemandTask summary={TASKS.inputs} resource={inputs}>{(candidates) => <ErasePastInputs candidates={candidates} onChanged={() => void inputs.reload()} />}</OnDemandTask>
    </> : <p className="ideal-note">請求の判断、保存規則の改定、法的保全、人物制御、コピーと旧勤務入力の確認と消去は、サーバーが管理者にだけ許可しています。あなたは、自分の請求を出して、その進み具合を確認できます。</p>}
  </div>;
}
