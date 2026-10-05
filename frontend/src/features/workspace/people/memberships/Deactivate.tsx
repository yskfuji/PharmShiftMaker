"use client";

import { useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import { useLive } from "../../shell/WorkspaceRuntime";

/** Deactivates one link against the revision on screen, after asking for the evidence. */
export default function Deactivate({ membershipId, revision, blockedReason }: { membershipId: string; revision: number; blockedReason: string | null }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  if (blockedReason) return <span className="ideal-note">{blockedReason}</span>;
  if (!open) return <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setOpen(true)}>無効にする</button>;
  return <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { expected_version: revision, evidence };
    await live.mutate(`deactivate:${membershipId}`, body, (key) => live.client.deactivateMembership(live.scopeId, membershipId, { ...body, idempotency_key: key }));
    setOpen(false);
    await live.refresh();
    return "無効にしました。";
  }); }}>
    <EvidenceFields value={evidence} onChange={setEvidence} legend="無効にする根拠" />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>無効にする</button>
      <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setOpen(false)}>やめる</button></div>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}
