"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type CaseSaved, type PrivacyRequestBody } from "../api";
import { KINDS, kindLabel, statusLabel } from "./model";

/**
 * Files one request about a person's data: for the viewer themselves, or (an administrator,
 * through the person named in the URL) for that person. The server decides whether the
 * viewer may file it for that person; nothing is carried out by filing.
 */
export default function FileRequest({ personId, personName }: { personId: string; personName: string }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"content">();
  const [kind, setKind] = useState("access");
  const [reason, setReason] = useState("");
  const [body, setBody] = useState<PrivacyRequestBody | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<PrivacyRequestBody, CaseSaved, never>({
    name: `privacy-request:${personId}`,
    send: (request, key) => api.filePrivacyRequest(live.scopeId, { ...request, idempotency_key: key }),
    // A new request has no current version to compare with: a 409 is the server's refusal.
    readCurrent: () => Promise.reject(new Error("no current version")),
  });
  useUnsavedNavigation(reason !== "");

  function leave() { setBody(null); send.clear(); steps.moveTo("content"); }
  async function save() {
    if (!body) return;
    const result = await send.run(body);
    if (!result.done) return;
    setBody(null); setReason(""); setKind("access");
    setDone(`請求を受け付けました（第${result.result.revision}版・${statusLabel(result.result.status)}）。本人確認と管理者の判断の後に実施されます。`);
    steps.moveTo("content");
  }

  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("content")}>1. 請求の種類と内容を入力する</h3>
    {!body && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); send.clear(); setBody({ expected_revision: 0, payload: { person_id: personId, kind, reason } }); }}>
      <p className="ideal-note">請求の対象：{personName}</p>
      <label htmlFor={`${id}-kind`}>請求の種類</label>
      <select id={`${id}-kind`} className="ideal-input" value={kind} onChange={(event) => setKind(event.target.value)}>
        {Object.entries(KINDS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      <label htmlFor={`${id}-reason`}>対象と理由</label>
      <textarea id={`${id}-reason`} className="ideal-input" required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">請求の内容を確認する</button></div>
    </form>}
    {body && <ConfirmSurface title="2. 請求前の確認"
      changes={[{ label: "請求の対象", before: "（なし）", after: personName }, { label: "請求の種類", before: "（なし）", after: kindLabel(body.payload.kind) }, { label: "対象と理由", before: "（なし）", after: body.payload.reason }]}
      version={{ from: 0, to: 1 }}
      notified="誰にも通知されません。請求は、本人と管理者のこの画面の一覧に表示されます。受付の記録（操作者・時刻）は監査の履歴に残ります。"
      risk="受付前の時点では検出されていません。請求は新しい記録として追加されるため、ほかの更新とは競合しません。1件の請求だけを記録するため、一部だけが記録されることはありません。請求を記録しただけでは、開示・訂正・利用停止・消去は実施されません。"
      outcome={conflictOutcome(send.outcome, () => ({ currentRevision: null, rows: [] }))}
      busy={send.busy} confirmLabel="この内容で請求する"
      onConfirm={() => void save()} onBack={leave} onReviewed={leave} />}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
