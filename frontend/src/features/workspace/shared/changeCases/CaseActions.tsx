"use client";

import { useId, useState } from "react";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, useAction } from "@/ideal/live/parts";
import type { ScheduleChangeCase } from "@/ideal/types";
import { browserNavigation } from "@/lib/browserNavigation";
import { PlanningError } from "@/lib/planningTransport";
import { routeOf } from "../../shell/routeTypes";
import { onWorkspaceRoute, workspaceHrefWithContext } from "../../shell/workspaceHref";
import { useLive } from "../../shell/WorkspaceRuntime";
import { useMounted } from "../hydration";
import { useCaseNotice } from "./CaseNotice";
import { hasUnreadableDuty, type Verb } from "./cases";
import WhyDisabled, { EVIDENCE_NEEDED } from "../WhyDisabled";

/** `tier` and `rank` place a verb in the row of actions, whatever order a route names the
 * verbs in: what moves the case forward comes first and is the one filled button, and what
 * ends the case without a change (declining, rejecting, withdrawing) stands apart at the
 * end, in a group of its own that is named and says the case cannot be reopened; its
 * buttons are the destructive outline, and the one that confirms is the filled one. `effect` says, before the button is pressed, what the server does with the case and
 * what follows (application/ideal_workflows.py: consent_change_case, decline_change_case,
 * withdraw_change_case, recommend_change_case, reject_change_case, approve_change_case; who
 * is notified is what api/routers/planning.py lists as notifications). All of it is
 * declared here by verb and never derived from the case; which verbs are offered is the
 * server's answer. */
const VERB: Record<Verb, { label: string; done: string; effect: string; tier: "primary" | "secondary" | "closing"; rank: number }> = {
  approve: { label: "承認して新しい公開版を作る", done: "承認し、新しい公開版を作成しました。", effect: "いまの公開版は書き換えずに、この変更を入れた新しい公開版を作って公開します。ケースは承認済みで終わり、勤務が変わる職員に通知されます。承認の後は、勤務表の画面に移ります。", tier: "primary", rank: 1 },
  recommend: { label: "別担当へ承認を依頼", done: "別担当の承認待ちにしました。", effect: "あなたはこのケースを作成したか、勤務が変わる本人のため、最終の承認はできません。ケースを「別担当の承認待ち」にして、別の責任者に承認を任せます。勤務が変わる職員に通知されます。勤務表はまだ変わりません。", tier: "primary", rank: 2 },
  consent: { label: "同意する", done: "同意しました。", effect: "あなたの同意を記録します。必要な全員の同意がそろうと「承認待ち」になり、責任者が承認するまで勤務表は変わりません。同意した後は「同意しない」に変えられません（取り下げは、申請した人か責任者ができます）。", tier: "primary", rank: 3 },
  decline: { label: "同意しない", done: "同意しないことを記録しました。ケースは終了しました。", effect: "同意しないことを記録し、このケースを終わりにします。勤務表は変わりません。終わったケースは再開できないため、続ける場合は新しい申請が必要です。", tier: "closing", rank: 4 },
  reject: { label: "責任者として却下", done: "責任者の却下を記録しました。", effect: "責任者として却下し、このケースを終わりにします。勤務表は変わりません。勤務が変わるはずだった職員に通知されます。終わったケースは再開できません。", tier: "closing", rank: 5 },
  withdraw: { label: "取り下げる", done: "取り下げました。", effect: "このケースを取り下げて終わりにします。勤務表は変わりません。勤務が変わるはずだった職員に通知されます。終わったケースは再開できないため、必要なら新しく申請します。", tier: "closing", rank: 6 },
};

/** Said with the verbs that end a case: a case that was declined, rejected or withdrawn has
 * no transition out of that state (application/ideal_workflows.py: consent needs
 * AWAITING_CONSENT, recommending READY, approving and rejecting READY or
 * AWAITING_INDEPENDENT_APPROVAL, withdrawing one of the four open states), so going on means
 * a new application. */
const NO_REOPENING = "再開できません";

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
  const id = useId();
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
  const ordered = [...verbs].sort((a, b) => VERB[a].rank - VERB[b].rank);
  const leading = ordered.filter((v) => VERB[v].tier !== "closing");
  const closing = ordered.filter((v) => VERB[v].tier === "closing");
  // One filled button in a row: the first of the verbs that move the case forward.
  // What is decided cannot be read: nothing that moves the case forward can be pressed.
  // Ending the case changes no duty and stays possible.
  const unreadable = hasUnreadableDuty(c);
  const held = (v: Verb) => unreadable && VERB[v].tier !== "closing";
  // Said under the open action while its evidence is the only thing missing.
  const why = action.busy || evidenceReady(evidence) || (verb !== null && held(verb)) ? null : EVIDENCE_NEEDED;
  // A verb that ends the case is the outline in the danger colour (the way to something that
  // cannot be undone); its filled form is only the button that confirms it, below.
  const offer = (v: Verb) => <button key={v} type="button" disabled={held(v)} className={VERB[v].tier === "closing" ? "ideal-button ideal-button--danger" : v === leading[0] && VERB[v].tier === "primary" ? "ideal-button ideal-button--primary" : "ideal-button ideal-button--secondary"} onClick={() => setVerb(v)}>{VERB[v].label}</button>;
  const ending = verb !== null && VERB[verb].tier === "closing";
  return (
    <div className="ideal-case-actions">
      {verb === null
        ? <>
          {unreadable && <p className="ideal-v3-callout ideal-v3-callout--warn">このケースには、日時を読み取れない勤務があります。何を変えるケースかを確かめられないため、ケースを進める操作（同意・承認・承認の依頼）は押せません。{closing.length > 0 ? "ケースを終わりにする操作はできます。" : ""}</p>}
          <dl className="ideal-v3-case-effects" aria-label="それぞれの操作で起きること">{ordered.map((v) => <div key={v}><dt>「{VERB[v].label}」</dt><dd>{VERB[v].effect}</dd></div>)}</dl>
          {leading.length > 0 && <div className="ideal-actions">{leading.map(offer)}</div>}
          {closing.length > 0 && <div className="ideal-v3-case-closing"><p className="ideal-v3-case-closing__label"><span className="ideal-pill ideal-pill--danger">{NO_REOPENING}</span>このケースを終える操作</p><div className="ideal-actions">{closing.map(offer)}</div></div>}
        </>
        : <form onSubmit={(e) => { e.preventDefault(); void action.run(() => send(verb)); }}>
          <p className="ideal-v3-case-effect">{ending && <strong className="ideal-v3-case-effect__final">{NO_REOPENING}。</strong>}{VERB[verb].effect}</p>
          <EvidenceFields value={evidence} onChange={setEvidence} legend={`${VERB[verb].label}の根拠`} />
          <div className="ideal-actions">
            <button type="submit" className={ending ? "ideal-button ideal-button--danger is-final" : "ideal-button ideal-button--primary"} disabled={action.busy || !evidenceReady(evidence) || held(verb)} aria-describedby={why ? `${id}-why` : undefined}>{VERB[verb].label}</button>
            <button type="button" className="ideal-button ideal-button--secondary" onClick={() => setVerb(null)}>やめる</button>
          </div>
          <WhyDisabled id={`${id}-why`}>{why}</WhyDisabled>
        </form>}
      <ActionStatus problem={action.problem} done={null} />
    </div>
  );
}
