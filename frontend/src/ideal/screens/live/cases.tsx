"use client";

import { useState } from "react";
import { browserNavigation } from "@/lib/browserNavigation";
import { PlanningError } from "@/lib/planningTransport";
import type { PublishedDuty } from "../../api/contracts";
import type { LiveApi } from "../../live/context";
import { CASE_STATUS, dutyWhen, stamp } from "../../live/format";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "../../live/parts";
import type { ScheduleChangeCase } from "../../types";
import { StatusPill } from "../shared";

type Validation = { findings?: unknown[]; publishable?: boolean; required_consent_person_ids?: string[]; consented_person_ids?: string[]; replacement_duty_ids?: string[] };

export const validationOf = (c: ScheduleChangeCase) => (c.validation ?? {}) as Validation;

/** The duties a case adds (a planner receives the whole proposed roster). */
export function replacements(c: ScheduleChangeCase): PublishedDuty[] {
  const added = validationOf(c).replacement_duty_ids;
  const proposed = c.proposed_assignments as unknown as PublishedDuty[];
  return added ? proposed.filter((d) => added.includes(d.duty_id)) : proposed;
}

export const asksMe = (c: ScheduleChangeCase, live: LiveApi) =>
  c.status === "AWAITING_CONSENT" && (validationOf(c).required_consent_person_ids ?? []).includes(live.personId)
  && !(validationOf(c).consented_person_ids ?? []).includes(live.personId);

const tone = (status: string) => status === "READY" ? "good" : ["AWAITING_CONSENT", "AWAITING_INDEPENDENT_APPROVAL"].includes(status) ? "warn" : status === "DRAFT" ? "danger" : "neutral";

export function CaseSummary({ c, live }: { c: ScheduleChangeCase; live: LiveApi }) {
  const v = validationOf(c);
  const affected = c.affected_assignments as unknown as PublishedDuty[];
  const added = replacements(c);
  const planner = live.role !== "PHARMACIST";
  return (
    <div className="ideal-case-summary">
      <div className="ideal-case-summary__head">
        <StatusPill tone={c.kind === "ABSENCE" ? "danger" : "info"}>{c.kind === "ABSENCE" ? "欠勤" : "交換"}</StatusPill>
        <StatusPill tone={tone(c.status)}>{CASE_STATUS[c.status] ?? c.status}</StatusPill>
        <small>版{c.version} · 更新 {stamp(c.updated_at)}</small>
      </div>
      <ul className="ideal-duty-list">
        {affected.map((d) => <li key={`a-${d.duty_id}`}><span>外す</span>{live.nameOf(d.person_id)} · {dutyWhen(d.start, d.end)}</li>)}
        {added.map((d) => <li key={`r-${d.duty_id}`}><span>入る</span>{live.nameOf(d.person_id)} · {dutyWhen(d.start, d.end)}</li>)}
        {!affected.length && !added.length && <li>あなたに関係する勤務はこのケースにありません。</li>}
      </ul>
      {(v.required_consent_person_ids?.length ?? 0) > 0 && <p className="ideal-note">
        同意 {v.consented_person_ids?.length ?? 0} / {v.required_consent_person_ids?.length}
        {planner ? `（${(v.required_consent_person_ids ?? []).map(live.nameOf).join("、")}）` : ""}
      </p>}
      {planner && c.status === "DRAFT" && <p className="ideal-note">サーバーの検証で指摘が {v.findings?.length ?? 0} 件あります。このままでは公開できません。取り下げて作り直してください。</p>}
      {planner && c.status === "AWAITING_INDEPENDENT_APPROVAL" && <p className="ideal-note">作成者・対象者とは別の責任者による最終承認が必要です。</p>}
    </div>
  );
}

type Verb = "consent" | "decline" | "withdraw" | "recommend" | "approve" | "reject";
const VERB: Record<Verb, { label: string; done: string }> = {
  consent: { label: "同意する", done: "同意しました。" },
  decline: { label: "同意しない", done: "同意しないことを記録しました。ケースは終了しました。" },
  withdraw: { label: "取り下げる", done: "取り下げました。" },
  recommend: { label: "別担当へ承認を依頼", done: "別担当の承認待ちにしました。" },
  approve: { label: "承認して新しい公開版を作る", done: "承認し、新しい公開版を作成しました。" },
  reject: { label: "責任者として却下", done: "責任者の却下を記録しました。" },
};

/** One change on one case, with its evidence. Only verbs the server allows are offered;
 * the server checks again and answers 403/409 otherwise. */
export function CaseActions({ c, live, verbs, onChanged }: { c: ScheduleChangeCase; live: LiveApi; verbs: Verb[]; onChanged: (done: string) => void }) {
  const [verb, setVerb] = useState<Verb | null>(null);
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  if (!verbs.length) return null;
  async function send(which: Verb): Promise<void> {
    const body = { expected_version: c.version, evidence };
    if (which === "approve") {
      // The version of the publication this case was opened against (not the one on
      // screen): the server approves only if it is still that period's current version.
      const publication = live.publicationOf(c.publication_id);
      if (!publication) throw new PlanningError(409, "このケースの公開版は差し替えられました。取り下げて、現在の公開版から作り直してください。");
      const approved = await live.mutate(`approve:${c.case_id}`, { ...body, v: publication.version }, (key) =>
        live.client.approve(live.scopeId, c.case_id, { ...body, expected_publication_version: publication.version, idempotency_key: key }));
      if (browserNavigation.pathname().startsWith("/workspace/")) {
        const period = publication.period.slice(0, 7);
        const query = new URLSearchParams({ scope: live.scopeId, period, publication: approved.publication_id });
        browserNavigation.replaceWithFlash(`/workspace/schedule?${query}`, "change-approved");
        return;
      }
      live.refresh();
    } else {
      await live.mutate(`${which}:${c.case_id}`, body, (key) => live.client[which](live.scopeId, c.case_id, { ...body, idempotency_key: key }));
    }
    setVerb(null); setEvidence(EMPTY_EVIDENCE);
    // The confirmation is shown by the screen: this case may leave the list right away.
    onChanged(VERB[which].done);
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
