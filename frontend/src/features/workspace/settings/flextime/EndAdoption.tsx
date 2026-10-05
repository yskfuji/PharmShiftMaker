"use client";

import { useLive } from "../../shell/WorkspaceRuntime";
import { settingsApi, type AdoptionEnded, type AdoptionRow, type FlexListing } from "../api";
import { decisionRisk, NOBODY_NOTIFIED } from "./decisions";
import DecisionSteps from "./DecisionSteps";
import { adoptionFacts, adoptionLabel, flexNames, midnightOf } from "./model";

type End = { end_on: string; reason: string };

/** Ends an adoption on one of the days the server lists for it, with a reason. The days
 * are the server's (`settlement_starts.end_on`); none is computed here. */
export default function EndAdoption({ listing }: { listing: FlexListing }) {
  const live = useLive();
  const api = settingsApi(live.client);
  const names = flexNames(listing);
  return <DecisionSteps<AdoptionRow, End, { expected_revision: number; end_on: string; reason: string }, AdoptionEnded>
    targetTitle="終了する採用を選ぶ" targetLabel="終了する採用" noneText="終了できる採用はありません。" refusedLabel="終了できない採用"
    rows={listing.adoptions} action={(row) => row.actions.end} label={(row) => adoptionLabel(row, names)}
    content={{ title: "終了日と理由を入力する", empty: { end_on: "", reason: "" }, fields: ({ row, value, onChange, id }) => <>
      <label htmlFor={`${id}-end`}>終了日（この日から採用しない）</label>
      <select id={`${id}-end`} className="ideal-input" required value={value.end_on} onChange={(event) => onChange({ end_on: event.target.value })}>
        <option value="">選んでください</option>
        {row.settlement_starts.end_on.map((day) => <option key={day} value={day}>{day}</option>)}
      </select>
      <p className="ideal-note">選べる終了日は、サーバーが返した将来の清算期間の初日です。</p>
      <label htmlFor={`${id}-reason`}>終了する理由（必須）</label>
      <textarea id={`${id}-reason`} className="ideal-input" required maxLength={500} value={value.reason} onChange={(event) => onChange({ reason: event.target.value })} />
    </> }}
    facts={(row) => adoptionFacts(row, names)}
    decided={(row, value) => adoptionFacts({ ...row, payload: { ...row.payload, end: midnightOf(value.end_on), end_reason: value.reason, decided_by: listing.viewer } }, names)}
    body={(row, value) => ({ expected_revision: row.revision, end_on: value.end_on, reason: value.reason })}
    mutation={(row) => `flex-adoption:end:${row.entity_id}`}
    send={(row, body, key) => api.endAdoption(live.scopeId, row.entity_id, { ...body, idempotency_key: key })}
    readCurrent={async (row) => (await api.flexAdoptions(live.scopeId)).adoptions.find((item) => item.entity_id === row.entity_id) ?? null}
    confirmTitle="終了前の確認" confirmLabel="理由を記録して終了する" backLabel="終了せずに戻る"
    notified={NOBODY_NOTIFIED} risk={decisionRisk("採用", "終了日以降に始まる参加は、同じ処理で取り下げられます。")}
    note={<p className="ideal-note">始まっている清算期間は最後まで清算します。参加者の雇用条件は、終了日から通常の労働時間制で登録し直してください。</p>}
    done={(answer, _row, value) => `採用を ${value.end_on} で終了します（第${answer.revision}版）。${answer.withdrawn_enrollments.length ? `終了日以降に始まる参加 ${answer.withdrawn_enrollments.length}件を取り下げました。` : ""}参加者の雇用条件を、終了日から通常の労働時間制で登録し直してください。`}
  />;
}
