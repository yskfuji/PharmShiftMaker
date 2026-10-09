"use client";

import { useId, useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import { useLive } from "../../shell/WorkspaceRuntime";
import WhyDisabled, { EVIDENCE_NEEDED } from "../../shared/WhyDisabled";

/** Deactivates one link against the revision on screen, after asking for the evidence.
 * The form names whose link it is: at phone width the row's name is not beside it. This
 * screen has no way to make a deactivated link active again (the table says so above it), so
 * the way in is the destructive outline and the button that confirms is the filled one. */
export default function Deactivate({ membershipId, revision, name }: { membershipId: string; revision: number; name: string }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  const id = useId();
  const why = action.busy || evidenceReady(evidence) ? null : EVIDENCE_NEEDED;
  if (!open) return <button type="button" className="ideal-button ideal-button--danger" onClick={() => setOpen(true)}>無効にする</button>;
  return <form className="ideal-v3-people-deactivate" onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { expected_version: revision, evidence };
    await live.mutate(`deactivate:${membershipId}`, body, (key) => live.client.deactivateMembership(live.scopeId, membershipId, { ...body, idempotency_key: key }));
    setOpen(false);
    await live.refresh();
    return "無効にしました。";
  }); }}>
    <p className="ideal-note">無効にすると、{name}はこのアカウントで、この施設・部署の画面を開けなくなります。紐付けの記録は残ります。この画面から有効に戻すことはできません。</p>
    <EvidenceFields value={evidence} onChange={setEvidence} legend={`無効にする根拠（${name}）`} />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--danger is-final" disabled={action.busy || !evidenceReady(evidence)} aria-describedby={why ? `${id}-why` : undefined}>無効にする</button>
      <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setOpen(false)}>やめる</button></div>
    <WhyDisabled id={`${id}-why`}>{why}</WhyDisabled>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}
