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
 * The administrator's ledger tasks. None of their records is read with the route: the
 * ledger's records are read once, when the first of the tasks that use them is opened, and
 * again after each of them saves; the grants to assess are read when that task is opened.
 * The server refuses every one of these to anyone who is not an administrator.
 */
export default function LeaveAdmin() {
  const live = useLive();
  const api = requestsApi(live.client);
  const assessment = useOnDemand(() => api.grantAssessmentContext(live.scopeId));
  const records = useOnDemand(async () => ledgerOf(await api.ledgerContext(live.scopeId)));
  const again = () => void records.reload();
  return <>
    <OnDemandTask summary="人事原本から通常・比例付与を照合する" resource={assessment}>{(context) => <GrantAssessmentForm context={context} name={live.nameOf} reload={assessment.reload} />}</OnDemandTask>
    <OnDemandTask summary="付与日数を訂正する" resource={records}>{(ledger) => <GrantCorrection ledger={ledger} onSaved={again} />}</OnDemandTask>
    <OnDemandTask summary="取得・予約の記録を訂正する" resource={records}>{(ledger) => <EventCorrection ledger={ledger} onSaved={again} />}</OnDemandTask>
    <OnDemandTask summary="取得・予約の記録を取り消す" resource={records}>{(ledger) => <EventCancel ledger={ledger} onSaved={again} />}</OnDemandTask>
    <OnDemandTask summary="年休の付与原本を登録する" resource={records}>{(ledger) => <LeaveAccountEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
    <OnDemandTask summary="年休の取得規則を登録・変更する" resource={records}>{(ledger) => <LeavePolicyEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
    <OnDemandTask summary="年休の予約・取得・取消を記録する" resource={records}>{(ledger) => <LeaveEventEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
    <OnDemandTask summary="年5日の管理期間を登録・変更する" resource={records}>{(ledger) => <LeaveObligationEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
    <OnDemandTask summary="人事原本の記録日時を登録する" resource={records}>{(ledger) => <LedgerRecordingEditor ledger={ledger} onSaved={again} />}</OnDemandTask>
  </>;
}
