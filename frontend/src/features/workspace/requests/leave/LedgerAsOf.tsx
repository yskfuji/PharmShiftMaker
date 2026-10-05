"use client";

import { useId, useRef, useState } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import JstDateTimeField from "../../shared/JstDateTimeField";
import { jstOffsetText } from "../../shared/jst";
import { useLive } from "../../shell/WorkspaceRuntime";
import { requestsApi, type AmendmentTrace, type LeaveReport } from "../api";
import { UNIT_LABEL, daysText, grantText } from "./model";

const eventText = (event: AmendmentTrace["previous_event"]) => (event ? `${event.quantity}${UNIT_LABEL[event.unit] ?? ""}` : "記録なし");
const traceText = (item: AmendmentTrace) => (item.event_id
  ? `取得・予約の記録：${eventText(item.previous_event)} → ${item.corrected_event ? eventText(item.corrected_event) : "取消"}`
  : `付与日数：${item.previous_days}日 → ${item.corrected_days}日`);

/**
 * The ledger as the server accounts it for a past day and for what was recorded by a
 * given time. A read: nothing is changed. The balances, the corrections and whether the
 * result needs reconciling are the server's answer.
 */
export default function LedgerAsOf() {
  const live = useLive();
  const api = requestsApi(live.client);
  const id = useId();
  const [effective, setEffective] = useState("");
  const [known, setKnown] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ProblemModel | null>(null);
  const [result, setResult] = useState<LeaveReport | null>(null);
  const sequence = useRef(0);

  async function query() {
    const current = ++sequence.current;
    setBusy(true); setProblem(null); setResult(null);
    try {
      const report = await api.leaveReportAsOf(live.scopeId, effective, jstOffsetText(known));
      if (current === sequence.current) setResult(report);
    } catch (error) {
      if (current === sequence.current) setProblem(problemFrom(error, "read"));
    } finally {
      if (current === sequence.current) setBusy(false);
    }
  }

  return <div className="ideal-v3-record">
    <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); void query(); }}>
      <p className="ideal-note">対象日と、その時点までに把握していた記録の締切を分けて指定します。元の記録の日時が確認できない場合、サーバーは未確認として答えます。</p>
      <label htmlFor={`${id}-effective`}>対象日</label>
      <input id={`${id}-effective`} className="ideal-input" type="date" required value={effective} onChange={(event) => setEffective(event.target.value)} />
      <JstDateTimeField label="記録の締切（日本時間）" value={known} onChange={setKnown} required />
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--secondary" disabled={busy}>指定時点の台帳を照会</button></div>
    </form>
    {problem && <InlineProblem problem={problem} />}
    <div aria-live="polite">
      {busy && <p className="ideal-note">照会しています。</p>}
      {result && <>
        {result.requires_hr_reconciliation && <p className="ideal-note" role="alert">サーバーは、残高または記録の整合性に確認が必要と答えています。元の履歴を保持したまま、人事担当者と照合してください。</p>}
        <p className="ideal-note">氏名・雇用主名は現在の登録名です。残高と訂正の履歴は、指定した対象日と記録の締切でサーバーが計算したものです。</p>
        {result.balances.length ? <ul className="ideal-note-list" aria-label="指定時点の年休残高">{result.balances.map((balance) => <li key={balance.account_id}>
          {grantText(balance)}：残高 {daysText(balance.remaining_days)} 日、予約 {daysText(balance.reserved_days)} 日
        </li>)}</ul> : <p className="ideal-note">指定時点の年休残高はありません。</p>}
        {result.amendment_trace?.length ? <ul className="ideal-note-list" aria-label="年休訂正の履歴">{result.amendment_trace.map((item) => <li key={item.amendment_id}>
          {traceText(item)}（理由：{item.reason}）
        </li>)}</ul> : <p className="ideal-note">指定時点までに記録された訂正はありません。</p>}
        {result.findings.length > 0 && <p className="ideal-note" role="alert">サーバーは、根拠の未確認または不整合を {result.findings.length} 件報告しています。この照会結果を確定した残高として扱わないでください。</p>}
      </>}
    </div>
  </div>;
}
