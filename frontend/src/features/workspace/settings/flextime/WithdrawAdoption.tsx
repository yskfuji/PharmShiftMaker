"use client";

import { useLive } from "../../shell/WorkspaceRuntime";
import { settingsApi, type AdoptionRow, type FlexDecided, type FlexListing } from "../api";
import { decisionRisk, NOBODY_NOTIFIED } from "./decisions";
import DecisionSteps from "./DecisionSteps";
import { adoptionFacts, adoptionLabel, flexNames } from "./model";

type Reason = { reason: string };

/** Withdraws an adoption with a reason. Whether an adoption can still be withdrawn is the
 * server's answer on each one; the server records who withdrew it. */
export default function WithdrawAdoption({ listing }: { listing: FlexListing }) {
  const live = useLive();
  const api = settingsApi(live.client);
  const names = flexNames(listing);
  return <DecisionSteps<AdoptionRow, Reason, { expected_revision: number; reason: string }, FlexDecided>
    targetTitle="取り下げる採用を選ぶ" targetLabel="取り下げる採用" noneText="取り下げられる採用はありません。" refusedLabel="取り下げられない採用"
    rows={listing.adoptions} action={(row) => row.actions.withdraw} label={(row) => adoptionLabel(row, names)} typedLabel
    content={{ title: "取り下げる理由を入力する", empty: { reason: "" }, fields: ({ value, onChange, id }) => <>
      <label htmlFor={`${id}-reason`}>取り下げる理由（必須）</label>
      <textarea id={`${id}-reason`} className="ideal-input" required maxLength={500} value={value.reason} onChange={(event) => onChange({ reason: event.target.value })} />
    </> }}
    facts={(row) => adoptionFacts(row, names)}
    decided={(row, value) => adoptionFacts({ ...row, payload: { ...row.payload, status: "withdrawn", withdrawal_reason: value.reason, decided_by: listing.viewer } }, names)}
    body={(row, value) => ({ expected_revision: row.revision, reason: value.reason })}
    mutation={(row) => `flex-adoption:withdraw:${row.entity_id}`}
    send={(row, body, key) => api.withdrawAdoption(live.scopeId, row.entity_id, { ...body, idempotency_key: key })}
    readCurrent={async (row) => (await api.flexAdoptions(live.scopeId)).adoptions.find((item) => item.entity_id === row.entity_id) ?? null}
    confirmTitle="取下げ前の確認" confirmLabel="理由を記録して取り下げる" confirmTone="danger" backLabel="取り下げずに戻る"
    notified={NOBODY_NOTIFIED} risk={decisionRisk("採用")}
    note={<p className="ideal-note">取り下げた採用は元に戻せません。採り直すときは、新しい採用として登録します。この採用の参加者のフレックスタイム制の雇用条件がどう扱われるかは、サーバーが公開前の検証で判定します。</p>}
    done={(answer) => `採用を取り下げました（第${answer.revision}版、取下げ済み）。`}
  />;
}
