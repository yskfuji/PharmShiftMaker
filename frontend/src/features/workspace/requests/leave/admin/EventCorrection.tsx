"use client";

import JstDateTimeField from "../../../shared/JstDateTimeField";
import { jstOffsetText } from "../../../shared/jst";
import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type LeaveAmendment, type LeaveUnit } from "../../api";
import { UNIT_LABEL, periodText } from "../model";
import AmendmentShell from "./AmendmentShell";
import { DayField, SelectField, WholeNumberField } from "../../../shared/records/fields";
import { eventLabel, type Ledger } from "./ledger";

type Entry = { effective: string; unit: LeaveUnit; quantity: number; start: string; end: string };

/** Replaces the day, the unit, the quantity and the span of a recorded leave event with
 * what the HR source states. The event keeps its identity; the original stays on record. */
export default function EventCorrection({ ledger, onSaved }: { ledger: Ledger; onSaved: () => void }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const event = (target: string) => ledger.events.find((item) => item.key === target)?.payload;
  const amount = (unit: LeaveUnit | undefined, quantity: number | undefined) => `${quantity ?? ""}${unit ? UNIT_LABEL[unit] : ""}`;
  return <AmendmentShell<Entry, LeaveAmendment>
    ledger={ledger} onSaved={onSaved} sourceKind="leave_record" pickLabel="訂正する取得・予約の記録" contentTitle="訂正後の内容と人事の根拠を入力する" confirmLabel="この訂正を記録する"
    options={ledger.events.map((item) => ({ value: item.key, label: `${ledger.person(ledger.accounts.find((entry) => entry.key === item.payload.account_id)?.payload.person_id)} ${eventLabel(item.payload)}` }))}
    personOf={(target) => ledger.accounts.find((item) => item.key === event(target)?.account_id)?.payload.person_id}
    initial={(target) => ({ effective: event(target)?.effective_on ?? "", unit: event(target)?.unit ?? "day", quantity: event(target)?.quantity ?? 1, start: "", end: "" })}
    fields={({ target, value, onChange }) => <>
      <p className="ideal-note">元の記録：{event(target) ? eventLabel(event(target)!) : "未確認"}。</p>
      <DayField label="訂正後の対象日" value={value.effective} onChange={(effective) => onChange({ effective })} />
      <SelectField label="訂正後の取得単位" value={value.unit} options={Object.entries(UNIT_LABEL).map(([key, label]) => ({ value: key, label }))} onChange={(unit) => onChange({ unit: unit as LeaveUnit })} />
      <WholeNumberField label="訂正後の数量（日・半日は1）" value={value.quantity} onChange={(quantity) => onChange({ quantity })} />
      <JstDateTimeField label="訂正後の開始（日本時間）" value={value.start} onChange={(start) => onChange({ start })} required />
      <JstDateTimeField label="訂正後の終了（日本時間）" value={value.end} onChange={(end) => onChange({ end })} required />
    </>}
    lines={(target, value) => ({
      before: [{ label: "対象日", text: event(target)?.effective_on ?? "（なし）" }, { label: "単位・数量", text: amount(event(target)?.unit, event(target)?.quantity) }, { label: "対象区間（日本時間）", text: periodText(event(target)?.interval?.start, event(target)?.interval?.end) }],
      after: [{ label: "対象日", text: value.effective || "（なし）" }, { label: "単位・数量", text: amount(value.unit, value.quantity) }, { label: "対象区間（日本時間）", text: periodText(value.start, value.end) }],
    })}
    payload={(target, value, common) => ({ ...common, event_id: target, replacement: { ...event(target), unit: value.unit, quantity: value.quantity, effective_on: value.effective, interval: { start: jstOffsetText(value.start), end: jstOffsetText(value.end) }, evidence: common.evidence } })}
    send={(body) => api.amendLeaveEvent(live.scopeId, body)} />;
}
