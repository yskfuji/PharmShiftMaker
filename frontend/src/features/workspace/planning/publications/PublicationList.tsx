"use client";

import { useState } from "react";
import type { PublicationRead } from "@/ideal/api/contracts";
import { ActionStatus, useAction } from "@/ideal/live/parts";
import { StatusPill } from "@/ideal/ui/atoms";
import { browserNavigation } from "@/lib/browserNavigation";
import ExportPublication from "../../shared/ExportPublication";
import { useMounted } from "../../shared/hydration";
import { useLive } from "../../shell/WorkspaceRuntime";

/**
 * The publications with their registered export and their cancellation. Cancelling is
 * confirmed in place with a reason and sent against the version on screen; the earlier
 * version and the audit record stay. Which publication is being cancelled and the reason
 * are the only state.
 */
export default function PublicationList({ items }: { items: PublicationRead[] }) {
  const live = useLive();
  const mounted = useMounted();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const cancel = useAction();
  return <>
    {items.length ? <div className="ideal-record-list">{items.map((item) => <article key={item.publication_id}><div><strong>公開版 v{item.version}</strong><StatusPill tone={item.validation_status === "revalidation_required" ? "warn" : "good"}>{item.validation_status === "revalidation_required" ? "再検証が必要" : "公開時に検証済み"}</StatusPill></div><p>{item.period.replaceAll("|", " 〜 ")} · {item.assignments.length}件</p><ExportPublication scope={live.scopeId} publication={item.publication_id} version={item.version} />
      {/* Offered once it can answer: a press on a button React has not attached to is lost. */}
      <div className="ideal-actions">{mounted && <button type="button" className="ideal-button ideal-button--danger" onClick={() => { setTarget(item.publication_id); setReason(""); }}>公開を取り消す</button>}</div>
      {target === item.publication_id && <div className="ideal-confirm"><h3>公開取消の確認</h3><p>勤務の再調整と関係者への通知が必要です。取消前の版と監査記録は残ります。</p><label>理由<textarea className="ideal-input" value={reason} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="ideal-button ideal-button--danger" disabled={!reason.trim() || cancel.busy} onClick={() => void cancel.run(async () => {
        const body = { expected_version: item.version, reason };
        await live.mutate(`publication-cancel:${item.publication_id}`, body, (key) => live.client.cancelPublication(live.scopeId, item.publication_id, { ...body, idempotency_key: key }));
        setTarget(null); setReason("");
        // The document is replaced, which reads the route again and shows the notice.
        browserNavigation.replaceWithFlash(browserNavigation.pathAndSearch(), "publication-cancelled");
      })}>理由を記録して公開取消</button><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTarget(null)}>やめる</button></div>}</article>)}</div> : <p className="ideal-note">公開版はありません。</p>}
    <ActionStatus problem={cancel.problem} done={cancel.done} />
  </>;
}
