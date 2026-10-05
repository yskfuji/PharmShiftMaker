"use client";

import { useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import JstDateTimeField from "../../shared/JstDateTimeField";
import { jstOffsetText } from "../../shared/jst";
import { changedFacts, type Fact } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { requestsApi, type RequestAnswer, type WishBody } from "../api";
import { periodText } from "./model";

export const REQUEST_NOTICE = "誰にも通知されません。管理者・責任者には、この画面の「申請を確認する」に確認待ちとして表示されます。申請の記録は監査の履歴に残ります。";
export const NEW_REQUEST_RISK = "保存前の時点では検出されていません。新しい申請を1件だけ記録するため、ほかの申請と競合せず、一部だけが保存されることもありません。";

/**
 * A wish for a day off (not paid leave): the span wished for, then the confirmation. The
 * wish is recorded as awaiting confirmation; whether a plan honours it is decided when the
 * plan is made.
 */
export default function HolidayWish() {
  const live = useLive();
  const api = requestsApi(live.client);
  const steps = useStepFocus<"content">();
  const [span, setSpan] = useState({ start: "", end: "" });
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const wish: WishBody = { start: jstOffsetText(span.start), end: jstOffsetText(span.end), kind: "PUBLIC_HOLIDAY_REQUEST", rank: 1, grant_id: null, amount: 1 };
  const send = useConfirmedSend<WishBody, RequestAnswer, never>({
    name: "request-submit",
    send: (body, key) => api.submitWish(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: async () => null,
  });
  useUnsavedNavigation(Boolean(span.start || span.end));
  const facts: Fact[] = [{ label: "種類", text: "公休希望" }, { label: "希望する期間（日本時間）", text: periodText(span.start, span.end) }, { label: "状態", text: "確認待ち" }];

  async function save() {
    const result = await send.run(wish);
    if (!result.done) return;
    setSpan({ start: "", end: "" }); setConfirming(false);
    setDone("公休の希望を第1版として記録しました（確認待ち）。");
    steps.moveTo("content");
  }

  return <div className="ideal-v3-record">
    <h4 className="ideal-v3-heading" {...steps.heading("content")}>1. 希望する期間を入力する</h4>
    {!confirming && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); setConfirming(true); }}>
      <JstDateTimeField label="希望する休みの開始（日本時間）" value={span.start} onChange={(start) => setSpan((old) => ({ ...old, start }))} required />
      <JstDateTimeField label="希望する休みの終了（日本時間）" value={span.end} onChange={(end) => setSpan((old) => ({ ...old, end }))} required />
      <p className="ideal-note">公休の希望は年休の請求ではありません。勤務案に反映できるかどうかは、計画の作成時に決まります。</p>
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">希望の内容を確認する</button></div>
    </form>}
    {confirming && <ConfirmSurface level={4} title="2. 記録前の確認"
      changes={changedFacts(null, facts)} version={{ from: 0, to: 1 }}
      notified={REQUEST_NOTICE} risk={NEW_REQUEST_RISK}
      outcome={conflictOutcome(send.outcome, () => ({ currentRevision: null, rows: [] }))} busy={send.busy}
      confirmLabel="この希望を記録する"
      onConfirm={() => void save()} onBack={() => { send.clear(); setConfirming(false); steps.moveTo("content"); }} onReviewed={() => send.clear()} />}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
