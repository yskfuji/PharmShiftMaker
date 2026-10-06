"use client";

import { useLive } from "../../shell/WorkspaceRuntime";
import { settingsApi, type EnrollmentRow, type FlexDecided, type FlexListing } from "../api";
import { decisionRisk, NOBODY_NOTIFIED } from "./decisions";
import DecisionSteps from "./DecisionSteps";
import { enrollmentFacts, enrollmentLabel, flexNames } from "./model";

type Reason = { reason: string };

/** Withdraws one person's participation with a reason. Whether a participation can still
 * be withdrawn is the server's answer on each one. */
export default function WithdrawParticipant({ listing }: { listing: FlexListing }) {
  const live = useLive();
  const api = settingsApi(live.client);
  const names = flexNames(listing);
  return <DecisionSteps<EnrollmentRow, Reason, { expected_revision: number; reason: string }, FlexDecided>
    targetTitle="取り下げる参加を選ぶ" targetLabel="取り下げる参加" noneText="取り下げられる参加はありません。" refusedLabel="取り下げられない参加"
    rows={listing.enrollments} action={(row) => row.actions.withdraw} label={(row) => enrollmentLabel(row, names)}
    content={{ title: "取り下げる理由を入力する", empty: { reason: "" }, fields: ({ value, onChange, id }) => <>
      <label htmlFor={`${id}-reason`}>参加を取り下げる理由（必須）</label>
      <textarea id={`${id}-reason`} className="ideal-input" required maxLength={500} value={value.reason} onChange={(event) => onChange({ reason: event.target.value })} />
    </> }}
    facts={(row) => enrollmentFacts(row, names)}
    decided={(row, value) => enrollmentFacts({ ...row, payload: { ...row.payload, status: "withdrawn", withdrawal_reason: value.reason, decided_by: listing.viewer } }, names)}
    body={(row, value) => ({ expected_revision: row.revision, reason: value.reason })}
    mutation={(row) => `flex-enrollment:withdraw:${row.entity_id}`}
    send={(row, body, key) => api.withdrawEnrollment(live.scopeId, row.entity_id, { ...body, idempotency_key: key })}
    readCurrent={async (row) => (await api.flexAdoptions(live.scopeId)).enrollments.find((item) => item.entity_id === row.entity_id) ?? null}
    confirmTitle="取下げ前の確認" confirmLabel="理由を記録して参加を取り下げる" confirmTone="danger" backLabel="取り下げずに戻る"
    notified={NOBODY_NOTIFIED} risk={decisionRisk("参加")}
    done={(answer, row) => `${names.person(row.payload.person_id)} の参加を取り下げました（第${answer.revision}版、取下げ済み）。`}
  />;
}
