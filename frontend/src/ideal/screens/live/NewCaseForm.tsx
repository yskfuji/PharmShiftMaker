"use client";

import { useEffect, useId, useState } from "react";
import { PlanningError } from "@/lib/planningTransport";
import type { PublishedDuty } from "../../api/contracts";
import { problemFrom } from "../../api/errors";
import type { LiveApi } from "../../live/context";
import { dutyWhen } from "../../live/format";
import { ActionStatus, EMPTY_EVIDENCE, EvidenceFields, evidenceReady, InlineProblem, useAction } from "../../live/parts";
import type { ProblemModel } from "../../model";
import type { ChangeOptions } from "../../types";
import { StatusPill } from "../shared";

type Kind = "ABSENCE" | "SWAP";
const NONE = "none";

/**
 * Open an absence or exchange case for one published duty. Options come from the server
 * (validated there); without the consent setting a pharmacist may not name a replacement,
 * and the server answers 403 for the options, so only "no replacement" is offered.
 */
export default function NewCaseForm({ live, duties, kinds, onCreated }: { live: LiveApi; duties: PublishedDuty[]; kinds: Kind[]; onCreated: () => void }) {
  const id = useId();
  const [dutyId, setDutyId] = useState("");
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [options, setOptions] = useState<ChangeOptions | null>(null);
  const [optionsProblem, setOptionsProblem] = useState<ProblemModel | null>(null);
  const [namingRefused, setNamingRefused] = useState(false);
  const [choice, setChoice] = useState("");
  const [evidence, setEvidence] = useState(EMPTY_EVIDENCE);
  const action = useAction();
  const publication = live.publication;
  const publicationId = publication?.publication_id ?? null;

  useEffect(() => {
    setOptions(null); setOptionsProblem(null); setNamingRefused(false); setChoice("");
    if (!dutyId || !publicationId) return;
    let current = true;
    live.client.changeOptions(live.scopeId, publicationId, dutyId, kind).then(
      (found) => { if (current) setOptions(found); },
      (error: unknown) => {
        if (!current) return;
        if (error instanceof PlanningError && error.status === 403 && kind === "ABSENCE") setNamingRefused(true);
        else setOptionsProblem(problemFrom(error, "read"));
      });
    return () => { current = false; };
  // Do not clear a person's selected counterpart when the provider publishes a
  // refreshed model object with the same client, scope and publication. Only a
  // real input-context change invalidates these server-derived options.
  }, [dutyId, kind, live.client, live.scopeId, publicationId]);

  if (!publication) return <p className="ideal-note">公開版がないため、申請できる勤務がありません。</p>;
  if (!duties.length) return <p className="ideal-note">公開版 v{publication.version} に、申請できる勤務はありません。</p>;
  const option = options?.options.find((o) => o.option_id === choice);
  const ready = dutyId && evidenceReady(evidence) && (choice === NONE ? kind === "ABSENCE" : Boolean(option));

  async function submit() {
    const body = {
      publication_id: publication!.publication_id,
      kind,
      affected_assignment_ids: option ? option.affected_assignment_ids : [dutyId],
      proposed_assignment_ids: option ? option.proposed_assignment_ids : [],
      evidence,
    };
    const created = await live.mutate("create-case", body, (key) => live.client.createCase(live.scopeId, { ...body, idempotency_key: key }));
    setDutyId(""); setEvidence(EMPTY_EVIDENCE); onCreated();
    return created.status === "AWAITING_CONSENT" ? "申請しました。同意を求めた人の返事を待っています。"
      : created.status === "READY" ? "申請しました。責任者の承認を待っています。"
        : "申請は記録しましたが、サーバーの検証で指摘があり、このままでは公開できません。";
  }

  return (
    <form className="ideal-form" onSubmit={(e) => { e.preventDefault(); void action.run(submit); }}>
      <label htmlFor={`${id}-duty`}>勤務</label>
      <select id={`${id}-duty`} className="ideal-input" value={dutyId} onChange={(e) => setDutyId(e.target.value)} required>
        <option value="">選んでください</option>
        {duties.map((d) => <option key={d.duty_id} value={d.duty_id}>{live.nameOf(d.person_id)} · {dutyWhen(d.start, d.end)} · {d.kind}</option>)}
      </select>
      {kinds.length > 1 && <fieldset className="ideal-fieldset ideal-fieldset--inline">
        <legend>種類</legend>
        {kinds.map((k) => <label key={k} className="ideal-radio"><input type="radio" name={`${id}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />{k === "ABSENCE" ? "欠勤（代わりの人）" : "交換（相手と入れ替え）"}</label>)}
      </fieldset>}
      {dutyId && <fieldset className="ideal-fieldset">
        <legend>{kind === "ABSENCE" ? "代わりの人" : "交換の相手"}</legend>
        {optionsProblem && <InlineProblem problem={optionsProblem} />}
        {!options && !optionsProblem && !namingRefused && <p className="ideal-note" role="status">候補を確認しています…</p>}
        {namingRefused && <p className="ideal-note">この施設・部署では、薬剤師は代わりの人を指名できません。代わりは責任者が決めます。</p>}
        {options?.consent_required && <p className="ideal-note">選んだ相手の同意を得てから、責任者が承認します。</p>}
        {options?.options.map((o) => (
          <label key={o.option_id} className="ideal-option">
            <input type="radio" name={`${id}-option`} value={o.option_id} checked={choice === o.option_id} onChange={() => setChoice(o.option_id)} />
            <span><strong>{o.counterpart.display_name ?? live.nameOf(o.counterpart.person_id)}</strong><small>{dutyWhen(o.duty.start, o.duty.end)} · {o.duty.kind}</small></span>
            <StatusPill tone={o.publishable ? "good" : "warn"}>{o.publishable ? "検証を通過" : `指摘あり${o.finding_count === null ? "" : ` ${o.finding_count}件`}`}</StatusPill>
          </label>
        ))}
        {options && !options.options.length && <p className="ideal-note">条件に合う候補はありません。</p>}
        {kind === "ABSENCE" && <label className="ideal-option">
          <input type="radio" name={`${id}-option`} value={NONE} checked={choice === NONE} onChange={() => setChoice(NONE)} />
          <span><strong>代わりを指定しない</strong><small>責任者が代わりを決めます</small></span>
        </label>}
      </fieldset>}
      <EvidenceFields value={evidence} onChange={setEvidence} />
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={action.busy || !ready}>申請する</button></div>
      <ActionStatus problem={action.problem} done={action.done} />
    </form>
  );
}
