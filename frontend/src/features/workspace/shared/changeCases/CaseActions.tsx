"use client";

import { useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import type { ScheduleChangeCase } from "@/ideal/types";
import { browserNavigation } from "@/lib/browserNavigation";
import { PlanningError } from "@/lib/planningTransport";
import { routeOf } from "../../shell/routeTypes";
import { onWorkspaceRoute, workspaceHrefWithContext } from "../../shell/workspaceHref";
import { useLive } from "../../shell/WorkspaceRuntime";
import { useMounted } from "../hydration";
import { useCaseNotice } from "./CaseNotice";
import type { Verb } from "./cases";

const VERB: Record<Verb, { label: string; done: string }> = {
  consent: { label: "同意する", done: "同意しました。" },
  decline: { label: "同意しない", done: "同意しないことを記録しました。ケースは終了しました。" },
  withdraw: { label: "取り下げる", done: "取り下げました。" },
  recommend: { label: "別担当へ承認を依頼", done: "別担当の承認待ちにしました。" },
  approve: { label: "承認して新しい公開版を作る", done: "承認し、新しい公開版を作成しました。" },
  reject: { label: "責任者として却下", done: "責任者の却下を記録しました。" },
};

/** One change on one case, with its evidence, sent against the case version on screen.
 * Only verbs the server allows are offered; the server checks again and answers 403/409
 * otherwise. Which verb is open and its evidence are the only state. */
export default function CaseActions({ c, verbs }: { c: ScheduleChangeCase; verbs: Verb[] }) {
  const live = useLive();
  const show = useCaseNotice();
  const mounted = useMounted();
  const [verb, setVerb] = useState<Verb | null>(null);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  // Offered once they can answer: a press on a button React has not attached to is lost.
  if (!verbs.length || !mounted) return null;
  async function send(which: Verb): Promise<void> {
    const body = { expected_version: c.version, evidence };
    if (which === "approve") {
      // The version of the publication this case was opened against (not the one on
      // screen): the server approves only if it is still that period's current version.
      const publication = live.publicationOf(c.publication_id);
      if (!publication) throw new PlanningError(409, "このケースの公開版は差し替えられました。取り下げて、現在の公開版から作り直してください。");
      const approved = await live.mutate(`approve:${c.case_id}`, { ...body, v: publication.version }, (key) =>
        live.client.approve(live.scopeId, c.case_id, { ...body, expected_publication_version: publication.version, idempotency_key: key }));
      if (onWorkspaceRoute(browserNavigation.pathname())) {
        const period = publication.period.slice(0, 7);
        browserNavigation.replaceWithFlash(workspaceHrefWithContext(routeOf("schedule/index").route, { scope: live.scopeId, period, publication: approved.publication_id }), "change-approved");
        return;
      }
    } else {
      await live.mutate(`${which}:${c.case_id}`, body, (key) => live.client[which](live.scopeId, c.case_id, { ...body, idempotency_key: key }));
    }
    setVerb(null); setEvidence(EMPTY_EVIDENCE);
    // The confirmation is shown by the route: this case may leave the list right away.
    show(VERB[which].done);
    await live.refresh();
  }
  return (
    <div className="ideal-case-actions">
      {verb === null
        ? <div className="ideal-actions">{verbs.map((v) => <button key={v} type="button" className={`ideal-button ${v === "approve" || v === "consent" || v === "recommend" ? "ideal-button--primary" : "ideal-button--secondary"}`} onClick={() => setVerb(v)}>{VERB[v].label}</button>)}</div>
        : <form onSubmit={(e) => { e.preventDefault(); void action.run(() => send(verb)); }}>
          <EvidenceFields value={evidence} onChange={setEvidence} legend={`${VERB[verb].label}の根拠`} />
          <div className="ideal-actions">
            <button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !evidenceReady(evidence)}>{VERB[verb].label}</button>
            <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setVerb(null)}>やめる</button>
          </div>
        </form>}
      <ActionStatus problem={action.problem} done={null} />
    </div>
  );
}
