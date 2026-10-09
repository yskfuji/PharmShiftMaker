"use client";

import { useLive } from "../../../shell/WorkspaceRuntime";
import { requestsApi, type GrantAmendment } from "../../api";
import AmendmentShell from "./AmendmentShell";
import { DayField, WholeNumberField } from "../../../shared/records/fields";
import { accountLabel, sourceChain, type Ledger } from "./ledger";

type Entry = { effective: string; days: number; statutory: number };

/** Corrects the days of a grant from the HR source. The grant itself stays as imported;
 * the correction takes effect from its own effective day. */
export default function GrantCorrection({ ledger, onSaved }: { ledger: Ledger; onSaved: () => void }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const account = (target: string) => ledger.accounts.find((item) => item.key === target)?.payload;
  // The days as last corrected, or as granted when there is no correction yet.
  const standing = (target: string) => {
    const latest = sourceChain(ledger.rows, "leave_account", target).latest;
    return { days: Number(latest?.granted_days ?? account(target)?.granted_days ?? 0), statutory: Number(latest?.statutory_days ?? account(target)?.statutory_days ?? 0) };
  };
  return <AmendmentShell<Entry, GrantAmendment>
    ledger={ledger} onSaved={onSaved} sourceKind="leave_account" pickLabel="訂正する原本" contentTitle="訂正後の付与と人事の根拠を入力する" confirmLabel="この訂正を記録する"
    options={ledger.accounts.map((item) => ({ value: item.key, label: accountLabel(ledger, item.payload) }))}
    personOf={(target) => account(target)?.person_id}
    initial={(target) => ({ effective: account(target)?.granted_on ?? "", ...standing(target) })}
    fields={({ target, value, onChange }) => <>
      <p className="ideal-note">元の付与：{account(target)?.granted_days}日。現在の台帳上の付与：{standing(target).days}日（うち法定 {standing(target).statutory}日）。</p>
      <DayField label="訂正の効力日" value={value.effective} onChange={(effective) => onChange({ effective })} />
      <WholeNumberField label="訂正後の付与日数" value={value.days} onChange={(days) => onChange({ days })} />
      <WholeNumberField label="そのうち法定付与日数" value={value.statutory} onChange={(statutory) => onChange({ statutory })} />
    </>}
    lines={(target, value) => ({
      before: [{ label: "付与日数", text: `${standing(target).days}日` }, { label: "うち法定付与日数", text: `${standing(target).statutory}日` }],
      after: [{ label: "付与日数", text: `${value.days}日` }, { label: "うち法定付与日数", text: `${value.statutory}日` }, { label: "訂正の効力日", text: value.effective || "（なし）" }],
    })}
    payload={(target, value, common) => ({ ...common, account_id: target, effective_on: value.effective, granted_days: value.days, statutory_days: value.statutory })}
    send={(body) => api.amendGrant(live.scopeId, body)} />;
}
