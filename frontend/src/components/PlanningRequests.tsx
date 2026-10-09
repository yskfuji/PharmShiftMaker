"use client";

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import useUnsavedNavigation from "@/features/workspace/shared/useUnsavedNavigation";
import {API_BASE_URL as API} from "@/lib/apiTarget";
import {errorText} from "@/lib/errorText";

type RequestRow = {
  request_id: string;
  person_id: string;
  version: number;
  kind: string;
  status: string;
  payload: {start: string; end: string};
  decision?: {reference: string};
};
type RecordRow = {kind: string; entity_id: string; payload: Record<string, unknown>};

export default function LeaveRequestWorkspace({scope, personId, canReview, onChanged}: {
  scope: string;
  personId: string;
  canReview: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [day, setDay] = useState("");
  const [kind, setKind] = useState("PUBLIC_HOLIDAY_REQUEST");
  const [account, setAccount] = useState("");
  const [policy, setPolicy] = useState("");
  const [claimReference, setClaimReference] = useState("");
  const [decisionReference, setDecisionReference] = useState("");
  const [planningError, setPlanningError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const rowsRef = useRef<RequestRow[]>([]);
  const retry = useRef<{fingerprint: string; key: string} | null>(null);
  const [conflict, setConflict] = useState<{base: RequestRow[]; current: RequestRow[]; proposed: string} | null>(null);
  const query = `?scope_id=${encodeURIComponent(scope)}`;

  useLayoutEffect(() => { rowsRef.current = rows; }, [rows]);
  useUnsavedNavigation(dirty);

  const request = useCallback(async (path: string, body?: unknown, compliance = false) => {
    let encoded: string | undefined;
    if (body) {
      const fingerprint = JSON.stringify({path, body, compliance});
      if (retry.current?.fingerprint !== fingerprint) retry.current = {fingerprint, key: crypto.randomUUID()};
      encoded = JSON.stringify(compliance
        ? {payload: body, expected_revision: 0, idempotency_key: retry.current.key}
        : {...body as object, idempotency_key: retry.current.key});
    }
    const response = await fetch(`${API}/planning${compliance ? "/compliance" : ""}${path}${query}`, {
      method: body ? "POST" : "GET", credentials: "include", cache: "no-store",
      headers: {"Content-Type": "application/json"}, body: encoded,
    });
    if (response.status === 409 && body && !compliance) {
      const current = await fetch(`${API}/planning/requests${query}`, {credentials: "include", cache: "no-store"});
      if (current.ok) setConflict({base: rowsRef.current, current: await current.json(), proposed: JSON.stringify(body)});
      throw new Error("申請の現在版が変わりました。差分を確認し、判断または取下げをやり直してください。");
    }
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, [query]);

  const reload = useCallback(async () => {
    const [requestResult, recordResult] = await Promise.allSettled([request("/requests"), request("/records", undefined, true)]);
    if (requestResult.status === "fulfilled") { setRows(requestResult.value); setPlanningError(""); }
    else setPlanningError("申請履歴を取得できませんでした。" + errorText(requestResult.reason));
    if (recordResult.status === "fulfilled") { setRecords(recordResult.value); setSourceError(""); }
    else setSourceError("年休の付与・規則を取得できませんでした。公休希望だけを記録できます。" + errorText(recordResult.reason));
  }, [request]);

  useEffect(() => { if (scope) void reload(); }, [scope, reload]);
  useEffect(() => {
    const changed = () => { void reload(); };
    window.addEventListener("planning-records-changed", changed);
    return () => window.removeEventListener("planning-records-changed", changed);
  }, [reload]);

  async function perform(action: () => Promise<void>) {
    setBusy(true); setActionError("");
    try { await action(); setDirty(false); retry.current = null; await reload(); await onChanged(); }
    catch (error) { setActionError(errorText(error)); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!day) throw new Error("希望する日を指定してください。");
    const start = `${day}T09:00:00+09:00`;
    const end = `${day}T17:00:00+09:00`;
    if (kind === "PAID_LEAVE_V2") {
      if (!account || !policy || !claimReference.trim()) throw new Error("本人の付与ロット、年休規則、請求内容の参照を指定してください。");
      await request("/leave-requests", {account_id: account, policy_id: policy, unit: "day", quantity: 1, interval: {start, end}, reference: claimReference.trim()}, true);
      return;
    }
    await request("/requests", {start, end, kind, rank: 1, grant_id: null, amount: 1});
  }

  const accounts = records.filter((row) => row.kind === "leave_account" && row.payload.person_id === personId);
  const policies = records.filter((row) => row.kind === "leave_policy" && row.payload.person_id === personId);
  const paid = kind === "PAID_LEAVE_V2";

  return <section className="workflow-panel space-y-3 border p-4" aria-labelledby="planning-requests-heading">
    <h2 id="planning-requests-heading" className="text-xl font-semibold">希望休・年休の申請</h2>
    <p>公休の希望と年休の請求を区別して記録します。年休は承認後、計画入力へ反映して初めて予約として扱われます。</p>
    {planningError && <p role="alert">{planningError}</p>}{sourceError && <p role="alert">{sourceError}</p>}{actionError && <p role="alert">{actionError}</p>}
    <form className="flex flex-wrap gap-3 items-end" onChange={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); void perform(submit); }}>
      <label className="w-full sm:w-auto">日付<input type="date" required value={day} onChange={(event) => setDay(event.target.value)} className="ui-control block w-full" /></label>
      <label className="w-full sm:w-auto">種類<select value={kind} onChange={(event) => { setKind(event.target.value); setAccount(""); setPolicy(""); }} className="ui-control block w-full"><option value="PUBLIC_HOLIDAY_REQUEST">公休希望</option><option value="PAID_LEAVE_V2">年次有給休暇</option></select></label>
      {paid && <>
        <label className="w-full sm:w-auto">年休付与台帳<select required value={account} onChange={(event) => setAccount(event.target.value)} className="ui-control block w-full"><option value="">選択してください</option>{accounts.map((row) => <option key={row.entity_id} value={row.entity_id}>{row.entity_id}（{String(row.payload.granted_on ?? "付与日未確認")}付与）</option>)}</select></label>
        <label className="w-full sm:w-auto">適用する年休規則<select required value={policy} onChange={(event) => setPolicy(event.target.value)} className="ui-control block w-full"><option value="">選択してください</option>{policies.map((row) => <option key={row.entity_id} value={row.entity_id}>{row.entity_id}（{String(row.payload.start ?? "開始日未確認")}から）</option>)}</select></label>
        <label className="grow">請求内容・根拠の参照<input required maxLength={2000} value={claimReference} onChange={(event) => setClaimReference(event.target.value)} className="ui-control block w-full" /></label>
      </>}
      <button type="submit" disabled={busy || !!conflict || (paid && (!!sourceError || !accounts.length || !policies.length))} className="ui-button ui-button-primary">申請を記録</button>
    </form>
    {canReview && <label className="block">判断の根拠・相談記録<input value={decisionReference} onChange={(event) => { setDecisionReference(event.target.value); setDirty(true); }} className="ui-control block w-full" placeholder="確認した申請・規程・調整記録の参照" /></label>}
    {dirty && <p role="status">未保存の申請・判断内容があります。</p>}
    {conflict && <section role="alert" className="workflow-panel border p-3 space-y-2"><h3>申請の競合を確認</h3><p>編集開始時：{conflict.base.map((row) => `${row.person_id} ${row.payload.start} ${row.status} 第${row.version}版`).join("、")}</p><p>現在：{conflict.current.map((row) => `${row.person_id} ${row.payload.start} ${row.status} 第${row.version}版`).join("、")}</p><p>編集中の判断根拠：{decisionReference || "なし"}。申請日は{day || "未入力"}です。</p><button type="button" className="ui-button ui-button-secondary" onClick={() => { setRows(conflict.current); setConflict(null); retry.current = null; setActionError("現在版を確認しました。保持した内容で対象操作を選び直してください。"); }}>差分を確認して現在版で操作を続ける</button></section>}
    <ul>{rows.map((row) => <li key={row.request_id} className="border-t py-2">{row.person_id}：{new Date(row.payload.start).toLocaleDateString("ja-JP", {timeZone: "Asia/Tokyo"})} {row.kind === "PAID_LEAVE_V2" || row.kind === "PAID_LEAVE_REQUEST" ? "年休" : "公休希望"} — {row.status}
      {row.decision && <p>判断記録：{row.decision.reference}</p>}
      {canReview && row.status !== "APPROVED" && row.status !== "CANCELLED" && <span className="ml-3 inline-flex gap-2"><button disabled={busy || !!conflict || !decisionReference} className="ui-button ui-button-secondary border p-1" onClick={() => void perform(async () => { await request(`/requests/${row.request_id}/decision`, {version: row.version, approved: true, reference: decisionReference}); })}>{row.kind === "PAID_LEAVE_V2" || row.kind === "PAID_LEAVE_REQUEST" ? "取得予定として確認" : "希望として確認"}</button><button disabled={busy || !!conflict || !decisionReference} className="ui-button ui-button-secondary border p-1" onClick={() => void perform(async () => { await request(`/requests/${row.request_id}/decision`, {version: row.version, approved: false, reference: decisionReference}); })}>相談・判断を継続</button></span>}
      {row.person_id === personId && row.status !== "CANCELLED" && <button className="ui-button ui-button-secondary ml-3 border p-1" disabled={busy || !!conflict} onClick={() => void perform(async () => { await request(`/requests/${row.request_id}/withdraw`, {version: row.version}); })}>申請を取り下げる</button>}
    </li>)}</ul>
  </section>;
}
