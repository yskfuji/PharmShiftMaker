"use client";

import { useId } from "react";
import TaskDisclosure, { OnDemandTask, useOnDemand } from "../../shared/TaskDisclosure";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi } from "../api";
import CorrectActual from "./CorrectActual";
import ImportActuals from "./ImportActuals";
import { REVIEW_TASK, taskContextOf, type ActualsData } from "./model";
import RecordFromDuty from "./RecordFromDuty";
import RecordUnplanned from "./RecordUnplanned";
import ReviewActual from "./ReviewActual";

/**
 * What can be done next with the actuals, in two groups: reconciling (open to everyone the
 * route is) and registering or correcting. Whether the viewer may import, record and
 * correct is the server's answer (`canCorrect`). The order, the tone and the one-line
 * description of each task are fixed here and never derived from the data. The published
 * duties, employment revisions and scheduled hours of the recording tasks are read once,
 * when the first of them is opened, and again after each save.
 */
export default function ActualTasks({ data }: { data: ActualsData }) {
  const live = useLive();
  const id = useId();
  const api = governanceApi(live.client);
  const records = useOnDemand(async () => taskContextOf(await api.actualsContext(live.scopeId)));
  const again = () => { if (records.data) void records.reload(); };
  return <div className="ideal-v3-record">
    <section aria-labelledby={`${id}-review`}>
      <h3 id={`${id}-review`} className="ideal-v3-heading">照合する</h3>
      <div className="ideal-v3-task-list">
        <TaskDisclosure id={REVIEW_TASK} tone="primary" summary="照合内容を記録する" hint="実績と公開した勤務を比べた内容と、差の理由を記録します。"><ReviewActual actuals={data.actuals} names={data.names} /></TaskDisclosure>
      </div>
    </section>
    <section aria-labelledby={`${id}-register`}>
      <h3 id={`${id}-register`} className="ideal-v3-heading">実績を登録・訂正する（管理者）</h3>
      {data.canCorrect ? <div className="ideal-v3-task-list">
        <TaskDisclosure summary="実績原本のファイルを取り込む" hint="勤怠の原本ファイルをサーバーで照合し、確かめてから登録します。"><ImportActuals names={data.names} onSaved={again} /></TaskDisclosure>
        <OnDemandTask summary="登録済みの実績を訂正する" hint="登録済みの実績の時間を直し、新しい版として保存します。" resource={records}>{(context) => <CorrectActual context={context} onSaved={again} />}</OnDemandTask>
        <OnDemandTask summary="公開勤務から実績を記録する" hint="公開した勤務を選び、実際に働いた時間を記録します。" resource={records}>{(context) => <RecordFromDuty context={context} onSaved={again} />}</OnDemandTask>
        <OnDemandTask summary="計画なしの実績を記録する（フレックスタイム制の雇用条件）" hint="公開した勤務がない実績を、フレックスタイム制の職員について記録します。" resource={records}>{(context) => <RecordUnplanned context={context} onSaved={again} />}</OnDemandTask>
      </div> : <p className="ideal-note">実績の取込・記録・訂正は、サーバーが管理者にだけ許可しています。あなたは照合内容を記録できます。</p>}
    </section>
  </div>;
}
