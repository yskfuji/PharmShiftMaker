"use client";

import { useId, useRef, useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import { useEnteredBeforeMount } from "../../shared/hydration";
import { useLive } from "../../shell/WorkspaceRuntime";

/** Derives the candidate duties again from the approved contracts and qualifications. The
 * server makes a new input version and leaves the one on screen as it is. Only the
 * evidence is a draft. */
export default function DeriveCandidates({ revision }: { revision: number }) {
  const live = useLive();
  const id = useId();
  const section = useRef<HTMLElement>(null);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  useEnteredBeforeMount(section, (fields) => {
    const value = (selector: string) => fields.querySelector<HTMLInputElement>(selector)?.value ?? "";
    const entered = { reason: value('input[id$="-reason"]'), reference: value('input[id$="-reference"]') };
    if (entered.reason || entered.reference) setEvidence(entered);
  });
  return <section ref={section} className="ideal-panel" aria-labelledby={`${id}-derive`}><h2 id={`${id}-derive`}>契約・資格から勤務候補を再導出</h2><p>承認済みの正本だけをサーバーが使い、元の入力版を上書きせず新しい版を作ります。</p>
    <EvidenceFields value={evidence} onChange={setEvidence} legend="再導出の根拠" />
    <button type="button" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)} onClick={() => void action.run(async () => {
      const body = { expected_version: revision, evidence };
      await live.mutate("derive-candidates", body, (key) => live.client.deriveCandidates(live.scopeId, { ...body, idempotency_key: key }));
      setEvidence(EMPTY_EVIDENCE);
      await live.refresh();
      return "新しい不変の入力版を作りました。";
    })}>新しい入力版を作る</button>
    <ActionStatus problem={action.problem} done={action.done} />
  </section>;
}
