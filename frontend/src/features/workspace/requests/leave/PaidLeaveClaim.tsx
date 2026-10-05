"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import JstDateTimeField from "../../shared/JstDateTimeField";
import { jstOffsetText, jstText } from "../../shared/jst";
import { changedFacts, type Fact } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { requestsApi, type LeaveUnit, type PaidLeaveClaim as Claim, type RequestAnswer } from "../api";
import { NEW_REQUEST_RISK, REQUEST_NOTICE } from "./HolidayWish";
import { UNIT_LABEL, periodText, unitsOf, type OwnGrant, type OwnPolicy, type OwnSources } from "./model";

type Draft = { account: string; policy: string; unit: LeaveUnit; quantity: number; start: string; end: string; reference: string };
const EMPTY: Draft = { account: "", policy: "", unit: "day", quantity: 1, start: "", end: "", reference: "" };
const grantLabel = (grant: OwnGrant) => `付与日 ${grant.granted_on || "未確認"}（${grant.granted_days}日、失効 ${grant.expires_on || "未確認"}）`;
const policyLabel = (policy: OwnPolicy) => `${jstText(policy.start).slice(0, 10) || "開始日未確認"}から適用／1日相当 ${policy.hours_per_day || "未確認"}時間`;

/**
 * The person's own claim of paid leave by the day, the half day or the hour: the grant and
 * the leave rule it is claimed under, the unit, the quantity and the span, then the
 * confirmation. The units offered are those the chosen rule, as the server returned it, is
 * registered to allow. When the claim is sent the server checks only its form and that the
 * grant is the person's own; whether the unit and the quantity fit the rule, the balance and
 * the yearly limit of hourly leave is found by the ledger reconciliation when the claim is
 * reviewed and applied to the plan. The text on screen says so.
 */
export default function PaidLeaveClaim({ sources }: { sources: OwnSources | null }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"content">();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<{ expected_revision: 0; payload: Claim }, RequestAnswer, never>({
    name: "leave.request",
    send: (body, key) => api.claimPaidLeave(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: async () => null,
  });
  useUnsavedNavigation(JSON.stringify(draft) !== JSON.stringify(EMPTY));
  if (!sources) return <p className="ideal-note">年休の付与と取得規則を読み取れなかったため、いまは請求できません。上の「一部の情報を更新できませんでした」から読み直してください。公休の希望は出せます。</p>;
  if (!sources.grants.length || !sources.policies.length) return <p className="ideal-note">請求に使える年休の付与または取得規則が、あなたには登録されていません。管理者に確認してください。</p>;

  const grant = sources.grants.find((item) => item.account_id === draft.account);
  const policy = sources.policies.find((item) => item.policy_id === draft.policy);
  const units = unitsOf(policy);
  const claim: Claim = { account_id: draft.account, policy_id: draft.policy, unit: draft.unit, quantity: draft.quantity, interval: { start: jstOffsetText(draft.start), end: jstOffsetText(draft.end) }, reference: draft.reference.trim() };
  const facts: Fact[] = [
    { label: "種類", text: "年次有給休暇" },
    { label: "年休の付与", text: grant ? grantLabel(grant) : "（なし）" },
    { label: "適用する取得規則", text: policy ? policyLabel(policy) : "（なし）" },
    { label: "請求する単位", text: UNIT_LABEL[draft.unit] },
    { label: "数量", text: String(draft.quantity) },
    { label: "休暇の期間（日本時間）", text: periodText(draft.start, draft.end) },
    { label: "請求内容・根拠の参照", text: claim.reference || "（なし）" },
    { label: "状態", text: "確認待ち" },
  ];
  const patch = (next: Partial<Draft>) => setDraft((old) => ({ ...old, ...next }));

  async function save() {
    const result = await send.run({ expected_revision: 0, payload: claim });
    if (!result.done) return;
    setDraft(EMPTY); setConfirming(false);
    setDone("年休の請求を第1版として記録しました（確認待ち）。確認と計画への反映の後に、予約として扱われます。");
    steps.moveTo("content");
  }

  return <div className="ideal-v3-record">
    <h4 className="ideal-v3-heading" {...steps.heading("content")}>1. 請求の内容を入力する</h4>
    {!confirming && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); setConfirming(true); }}>
      <label htmlFor={`${id}-account`}>年休付与台帳</label>
      <select id={`${id}-account`} className="ideal-input" required value={draft.account} onChange={(event) => patch({ account: event.target.value })}>
        <option value="">選んでください</option>
        {sources.grants.map((item) => <option key={item.account_id} value={item.account_id}>{grantLabel(item)}</option>)}
      </select>
      <label htmlFor={`${id}-policy`}>適用する年休規則</label>
      <select id={`${id}-policy`} className="ideal-input" required value={draft.policy} onChange={(event) => {
        const next = sources.policies.find((item) => item.policy_id === event.target.value);
        // A unit the newly chosen rule does not list is not kept.
        patch({ policy: event.target.value, unit: unitsOf(next).includes(draft.unit) ? draft.unit : "day" });
      }}>
        <option value="">選んでください</option>
        {sources.policies.map((item) => <option key={item.policy_id} value={item.policy_id}>{policyLabel(item)}</option>)}
      </select>
      <label htmlFor={`${id}-unit`}>請求する単位</label>
      <select id={`${id}-unit`} className="ideal-input" value={draft.unit} onChange={(event) => patch({ unit: event.target.value as LeaveUnit })}>
        {units.map((unit) => <option key={unit} value={unit}>{UNIT_LABEL[unit]}</option>)}
      </select>
      <p className="ideal-note">選べる単位は、選んだ取得規則に登録されている設定（半日単位・時間単位を認めるか）によります。</p>
      <label htmlFor={`${id}-quantity`}>数量（日・半日は1、時間は取得する時間数）</label>
      <input id={`${id}-quantity`} className="ideal-input" type="number" min={1} step={1} required value={Number.isFinite(draft.quantity) ? draft.quantity : ""} onChange={(event) => patch({ quantity: event.target.valueAsNumber })} />
      <JstDateTimeField label="休暇開始（日本時間）" value={draft.start} onChange={(start) => patch({ start })} required />
      <JstDateTimeField label="休暇終了（日本時間）" value={draft.end} onChange={(end) => patch({ end })} required />
      <label htmlFor={`${id}-reference`}>請求内容・根拠の参照</label>
      <input id={`${id}-reference`} className="ideal-input" required maxLength={2000} value={draft.reference} onChange={(event) => patch({ reference: event.target.value })} />
      <p className="ideal-note">請求の時点でサーバーが確かめるのは、入力の形式と、年休の付与があなた本人のものであることだけです。単位と数量が取得規則に合うか、残高と時間単位の年間上限に収まるかは、請求を確認して計画へ反映するときに、年休台帳と照合されます。請求の受付は、予約や取得の確定ではありません。</p>
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">請求の内容を確認する</button></div>
    </form>}
    {confirming && <ConfirmSurface level={4} title="2. 請求前の確認"
      changes={changedFacts(null, facts)} version={{ from: 0, to: 1 }}
      notified={REQUEST_NOTICE} risk={NEW_REQUEST_RISK}
      outcome={conflictOutcome(send.outcome, () => ({ currentRevision: null, rows: [] }))} busy={send.busy}
      confirmLabel="この内容で請求する"
      onConfirm={() => void save()} onBack={() => { send.clear(); setConfirming(false); steps.moveTo("content"); }} onReviewed={() => send.clear()} />}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
