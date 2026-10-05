"use client";

import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type LeaveAmendment } from "../../api";
import AmendmentShell from "./AmendmentShell";
import { eventLabel, type Ledger } from "./ledger";

/** Cancels a recorded leave event that the HR source says was recorded in error. The
 * original stays on record; nothing is turned into an absence by this. */
export default function EventCancel({ ledger, onSaved }: { ledger: Ledger; onSaved: () => void }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const event = (target: string) => ledger.events.find((item) => item.key === target)?.payload;
  return <AmendmentShell<Record<string, never>, LeaveAmendment>
    ledger={ledger} onSaved={onSaved} sourceKind="leave_record" pickLabel="取り消す取得・予約の記録" contentTitle="取消の根拠を入力する" confirmLabel="この記録を取り消す"
    options={ledger.events.map((item) => ({ value: item.key, label: `${ledger.person(ledger.accounts.find((entry) => entry.key === item.payload.account_id)?.payload.person_id)} ${eventLabel(item.payload)}` }))}
    personOf={(target) => ledger.accounts.find((item) => item.key === event(target)?.account_id)?.payload.person_id}
    initial={() => ({})}
    fields={({ target }) => <p className="ideal-note">取り消す記録：{event(target) ? eventLabel(event(target)!) : "未確認"}。取消には人事確認の根拠が必要です。欠勤への振替は行いません。</p>}
    lines={(target) => ({ before: [{ label: "取得・予約の記録", text: event(target) ? eventLabel(event(target)!) : "（なし）" }], after: [{ label: "取得・予約の記録", text: "取消" }] })}
    payload={(target, _value, common) => ({ ...common, event_id: target, replacement: null })}
    send={(body) => api.amendLeaveEvent(live.scopeId, body)} />;
}
