"use client";

import { useLive } from "../../shell/WorkspaceRuntime";
import { settingsApi, type EnrollmentRow, type FlexDecided, type FlexListing } from "../api";
import { decisionRisk, NOBODY_NOTIFIED } from "./decisions";
import DecisionSteps from "./DecisionSteps";
import { enrollmentFacts, enrollmentLabel, flexNames } from "./model";

/** Confirms one person's participation. Who may confirm which participation is the
 * server's answer on each one (its reason is shown when it refuses); the server records
 * the confirming administrator. */
export default function ConfirmParticipant({ listing }: { listing: FlexListing }) {
  const live = useLive();
  const api = settingsApi(live.client);
  const names = flexNames(listing);
  return <DecisionSteps<EnrollmentRow, Record<string, never>, { expected_revision: number }, FlexDecided>
    targetTitle="確認する参加を選ぶ" targetLabel="確認する参加" noneText="あなたが確認できる参加はありません。" refusedLabel="確認できない参加"
    rows={listing.enrollments} action={(row) => row.actions.confirm} label={(row) => enrollmentLabel(row, names)}
    facts={(row) => enrollmentFacts(row, names)}
    decided={(row) => enrollmentFacts({ ...row, payload: { ...row.payload, status: "confirmed", reviewed_by: listing.viewer } }, names)}
    body={(row) => ({ expected_revision: row.revision })}
    mutation={(row) => `flex-enrollment:confirm:${row.entity_id}`}
    send={(row, body, key) => api.confirmEnrollment(live.scopeId, row.entity_id, { ...body, idempotency_key: key })}
    readCurrent={async (row) => (await api.flexAdoptions(live.scopeId)).enrollments.find((item) => item.entity_id === row.entity_id) ?? null}
    confirmTitle="確認前の確認" confirmLabel="この参加を確認する"
    notified={NOBODY_NOTIFIED} risk={decisionRisk("参加")}
    note={<p className="ideal-note">確認した後に、本人の参加の開始日から始まるフレックスタイム制の雇用条件を登録します。</p>}
    done={(answer, row) => `${names.person(row.payload.person_id)} の参加を確認しました（第${answer.revision}版）。`}
  />;
}
