"use client";

import TaskDisclosure, { OnDemandTask, useOnDemand } from "../../shared/TaskDisclosure";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi } from "../api";
import CorrectActual from "./CorrectActual";
import ImportActuals from "./ImportActuals";
import { taskContextOf, type ActualsData } from "./model";
import RecordFromDuty from "./RecordFromDuty";
import RecordUnplanned from "./RecordUnplanned";
import ReviewActual from "./ReviewActual";

/**
 * What can be done next with the actuals. Whether the viewer may import, record and
 * correct is the server's answer (`canCorrect`); the note is open to everyone the route
 * is. The published duties, employment revisions and scheduled hours of the recording
 * tasks are read once, when the first of them is opened, and again after each save.
 */
export default function ActualTasks({ data }: { data: ActualsData }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const records = useOnDemand(async () => taskContextOf(await api.actualsContext(live.scopeId)));
  const again = () => { if (records.data) void records.reload(); };
  return <div className="ideal-stack">
    {data.canCorrect ? <>
      <TaskDisclosure summary="実績原本のファイルを取り込む"><ImportActuals names={data.names} onSaved={again} /></TaskDisclosure>
      <OnDemandTask summary="登録済みの実績を訂正する" resource={records}>{(context) => <CorrectActual context={context} onSaved={again} />}</OnDemandTask>
      <OnDemandTask summary="公開勤務から実績を記録する" resource={records}>{(context) => <RecordFromDuty context={context} onSaved={again} />}</OnDemandTask>
      <OnDemandTask summary="計画なしの実績を記録する（フレックスタイム制の雇用条件）" resource={records}>{(context) => <RecordUnplanned context={context} onSaved={again} />}</OnDemandTask>
    </> : <p className="ideal-note">実績の取込・記録・訂正は、サーバーが管理者にだけ許可しています。あなたは照合内容を記録できます。</p>}
    <TaskDisclosure summary="照合内容を記録する"><ReviewActual actuals={data.actuals} names={data.names} /></TaskDisclosure>
  </div>;
}
