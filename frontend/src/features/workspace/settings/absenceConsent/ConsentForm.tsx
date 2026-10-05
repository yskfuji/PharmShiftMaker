"use client";

import { useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import { useLive } from "../../shell/WorkspaceRuntime";

/** Switches the setting against the revision on screen. Only the evidence is a draft. */
export default function ConsentForm({ enabled, revision }: { enabled: boolean; revision: number }) {
  const live = useLive();
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  return <form onSubmit={(e) => { e.preventDefault(); void action.run(async () => {
    const body = { enabled: !enabled, expected_version: revision, evidence };
    await live.mutate("absence-consent", body, (key) => live.client.setAbsenceConsent(live.scopeId, { ...body, idempotency_key: key }));
    setEvidence(EMPTY_EVIDENCE);
    await live.refresh();
    return body.enabled ? "同意を求めるようにしました。" : "同意を求めないようにしました。";
  }); }}>
    <EvidenceFields value={evidence} onChange={setEvidence} legend="切り替える根拠" />
    <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>{enabled ? "同意を求めないようにする" : "同意を求めるようにする"}</button></div>
    <ActionStatus problem={action.problem} done={action.done} />
  </form>;
}
