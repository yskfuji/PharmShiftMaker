"use client";

import { OnDemandTask, useOnDemand } from "../../../shared/TaskDisclosure";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi } from "../../api";
import EventCancel from "./EventCancel";
import EventCorrection from "./EventCorrection";
import GrantAssessmentForm from "./GrantAssessmentForm";
import GrantCorrection from "./GrantCorrection";
import LeaveAccountEditor from "./LeaveAccountEditor";
import LeaveEventEditor from "./LeaveEventEditor";
import LeaveObligationEditor from "./LeaveObligationEditor";
import LeavePolicyEditor from "./LeavePolicyEditor";
import { ledgerOf } from "./ledger";
import LedgerRecordingEditor from "./LedgerRecordingEditor";

/**
 * The administrator's ledger tasks, in two groups: comparing, correcting and cancelling
 * what the HR source states, and registering or changing the ledger's records. None of
 * their records is read with the route: the ledger's records are read once, when the first
 * of the tasks that use them is opened, and again after each of them saves; the grants to
 * assess are read when that task is opened. The server refuses every one of these to anyone
 * who is not an administrator. The order, the tone and the one-line description of each task
 * are fixed here and never derived from the data.
 *
 * No task here is marked as one that cannot be undone. A correction or a cancellation adds
 * a record that names the source revision it follows: the original stays on record, and a
 * later correction of the same record can follow it (see AmendmentShell and EventCancel).
 */
export default function LeaveAdmin() {
  const live = useLive();
  const api = requestsApi(live.client);
  const assessment = useOnDemand(() => api.grantAssessmentContext(live.scopeId));
  const records = useOnDemand(async () => ledgerOf(await api.ledgerContext(live.scopeId)));
  const again = () => void records.reload();
  return <>
    <h4 className="ideal-v3-heading">照合・訂正・取消</h4>
    <div className="ideal-v3-task-list">
      <OnDemandTask summary="人事原本から通常・比例付与を照合する" hint="付与日数が法定の表に合うかを、サーバーが照合します。" resource={assessment}>{(context) => <GrantAssessmentForm context={context} name={live.nameOf} reload={assessment.reload} />}</OnDemandTask>
      <OnDemandTask summary="付与日数を訂正する" hint="人事原本の訂正に合わせて直します。元の記録は残ります。" resource={records}>{(ledger) => <GrantCorrection ledger={ledger} onSaved={again} />}</OnDemandTask>
      <OnDemandTask summary="取得・予約の記録を訂正する" hint="日・単位・数量・区間を、人事の根拠に合わせて直します。" resource={records}>{(ledger) => <EventCorrection ledger={ledger} onSaved={again} />}</OnDemandTask>
      <OnDemandTask summary="取得・予約の記録を取り消す" hint="誤った記録を取り消します。元の記録は残ります。" resource={records}>{(ledger) => <EventCancel ledger={ledger} onSaved={again} />}</OnDemandTask>
    </div>
    <h4 className="ideal-v3-heading">登録・変更</h4>
    <div className="ideal-v3-task-list">
      <OnDemandTask summary="年休の付与原本を登録する" hint="職員ごとの年休の付与を、人事原本のとおりに登録します。" resource={records}>{(ledger) => <LeaveAccountEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
      <OnDemandTask summary="年休の取得規則を登録・変更する" hint="半日・時間単位の可否や、1日に相当する時間数を登録します。" resource={records}>{(ledger) => <LeavePolicyEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
      <OnDemandTask summary="年休の予約・取得・取消を記録する" hint="付与ごとの台帳に、予約や取得を1件ずつ追加します。" resource={records}>{(ledger) => <LeaveEventEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
      <OnDemandTask summary="年5日の管理期間を登録・変更する" hint="年5日の取得を管理する期間と、必要な取得量を登録します。" resource={records}>{(ledger) => <LeaveObligationEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
      <OnDemandTask summary="人事原本の記録日時を登録する" hint="原本番号と把握した日時を付けます。訂正の前に必要です。" resource={records}>{(ledger) => <LedgerRecordingEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
    </div>
  </>;
}
