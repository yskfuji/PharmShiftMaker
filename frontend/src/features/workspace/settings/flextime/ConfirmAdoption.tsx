"use client";

import { useId, useState, type ReactNode } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import ConfirmSurface from "../../shared/ConfirmSurface";
import WorkspaceLink from "../../shell/WorkspaceLink";
import { changedFacts, threeWayRows, type Fact } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import { routeOf } from "../../shell/routeTypes";
import { useLive } from "../../shell/WorkspaceRuntime";
import { settingsApi, type AdoptionConfirmed, type AdoptionRow, type FlexImpact, type FlexListing } from "../api";
import { NOBODY_NOTIFIED } from "./decisions";
import { adoptionFacts, adoptionLabel, dayOf, flexNames, impactFacts, type FlexNames } from "./model";
import RefusedList from "./RefusedList";

/** The adoption and the impact the server answered for it: what a confirmation is bound to. */
type Seen = { row: AdoptionRow; impact: FlexImpact };

function Impact({ impact, names }: { impact: FlexImpact; names: FlexNames }) {
  return <>
    <p className="ideal-note">参加者 {impact.people.length}人：{impact.people.map((item) => `${names.person(item.person_id)}（${dayOf(item.start)} から）`).join("、") || "なし"}</p>
    <p className="ideal-note">開始日以降の時刻付きの勤務（割当から外す必要があります）：{impact.timed_duties.length}件</p>
    {impact.timed_duties.length > 0 && <ul role="list" className="ideal-note-list" aria-label="開始日以降の時刻付きの勤務">
      {impact.timed_duties.slice(0, 20).map((duty) => <li key={duty.scope_id + duty.duty_id}>{names.person(duty.person_id)} {dayOf(duty.start)}</li>)}
      {impact.timed_duties.length > 20 && <li>ほか {impact.timed_duties.length - 20}件</li>}
    </ul>}
    <p className="ideal-note">確認の後に行うこと（サーバーの回答）：</p>
    <ol className="ideal-note-list" aria-label="確認の後に行うこと">{impact.next_steps.map((step) => <li key={step}>{step}</li>)}</ol>
  </>;
}

/**
 * Confirms a registered adoption after its impact has been read. Who may confirm which
 * adoption is the server's answer on each one. The impact is read when the administrator
 * asks for it, shown in the confirmation, and its check value is sent with the confirmation,
 * so the server confirms exactly what was shown or refuses. What stops a confirmation is
 * the server's list (`blocking`); then no confirmation is offered.
 */
export default function ConfirmAdoption({ listing }: { listing: FlexListing }) {
  const live = useLive();
  const api = settingsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "blocked">();
  const names = flexNames(listing);
  const open = listing.adoptions.filter((row) => row.actions.confirm.allowed);
  const closed = listing.adoptions.filter((row) => !row.actions.confirm.allowed);
  const [chosen, setChosen] = useState("");
  const [reading, setReading] = useState(false);
  const [readProblem, setReadProblem] = useState<ProblemModel | null>(null);
  const [seen, setSeen] = useState<Seen | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<ReactNode>(null);
  const send = useConfirmedSend<{ expected_revision: number; impact_hash: string }, AdoptionConfirmed, Seen>({
    name: `flex-adoption:confirm:${chosen}`,
    send: (body, key) => api.confirmAdoption(live.scopeId, chosen, { ...body, idempotency_key: key }),
    readCurrent: async () => {
      const [fresh, impact] = await Promise.all([api.flexAdoptions(live.scopeId), api.flexImpact(live.scopeId, chosen)]);
      const row = fresh.adoptions.find((item) => item.entity_id === chosen);
      return row ? { row, impact } : null;
    },
  });
  const facts = (value: Seen): Fact[] => [...adoptionFacts(value.row, names), ...impactFacts(value.impact, names)];
  const confirmed = (value: Seen): Fact[] => facts({ ...value, row: { ...value.row, payload: { ...value.row.payload, status: "confirmed", reviewed_by: listing.viewer } } });

  function choose(target: string) { setChosen(target); setSeen(null); setReadProblem(null); setRebased(false); setDone(null); send.clear(); }
  function leave() { setSeen(null); setRebased(false); send.clear(); steps.moveTo("target"); }
  async function show() {
    const row = open.find((item) => item.entity_id === chosen);
    if (!row) return;
    setReading(true); setReadProblem(null); setDone(null);
    try {
      const impact = await api.flexImpact(live.scopeId, row.entity_id);
      setSeen({ row, impact });
      if (impact.blocking.length) steps.moveTo("blocked");
    } catch (error) {
      setReadProblem(problemFrom(error, "read"));
    } finally {
      setReading(false);
    }
  }
  async function save() {
    if (!seen) return;
    const result = await send.run({ expected_revision: seen.row.revision, impact_hash: seen.impact.impact_hash });
    if (!result.done) return;
    const pending = result.result.enrollments_needing_another_admin.length;
    choose("");
    setDone(<>採用を確認しました（第{result.result.revision}版、採用中）。{pending > 0
      ? `参加 ${pending}件は、あなたが登録したかあなた自身の参加のため、別の管理者の確認が必要です。`
      : "参加者ごとに、参加の開始日から始まるフレックスタイム制の雇用条件を登録してください。"}
      <WorkspaceLink className="ideal-inline-link" route={routeOf("people/contracts").route}>契約・資格で雇用条件を登録する</WorkspaceLink></>);
    steps.moveTo("target");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    // Gone, or no longer the viewer's to confirm: nothing is sent, and the reason is the server's.
    if (!now || !now.row.actions.confirm.allowed) {
      choose("");
      setDone(now ? `この採用は確認していません。${now.row.actions.confirm.refusal ?? ""}` : "この採用は、現在サーバーにありません。確認は行っていません。");
      steps.moveTo("target");
      return;
    }
    setSeen(now); setRebased(true);
    if (now.impact.blocking.length) steps.moveTo("blocked");
  }

  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 確認する採用を選び、影響を表示する</h3>
    {open.length === 0 ? <p className="ideal-note">あなたが確認できる採用はありません。</p> : <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); void show(); }}>
      <label htmlFor={`${id}-target`}>確認する採用</label>
      <select id={`${id}-target`} className="ideal-input" required value={chosen} disabled={Boolean(seen) || reading} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        {open.map((row) => <option key={row.entity_id} value={row.entity_id} data-verbatim>{adoptionLabel(row, names)}（第{row.revision}版）</option>)}
      </select>
      {!seen && <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={reading}>確認の前に影響を表示する</button></div>}
    </form>}
    {closed.length > 0 && <RefusedList label="確認できない採用" items={closed.map((row) => ({ key: row.entity_id, name: adoptionLabel(row, names), typed: true, reason: row.actions.confirm.refusal }))} />}
    {readProblem && <InlineProblem problem={readProblem} />}
    {seen && seen.impact.blocking.length > 0 && <section aria-labelledby={`${id}-blocked`}>
      <h3 id={`${id}-blocked`} className="ideal-v3-heading" {...steps.heading("blocked")}>2. 確認すると変わること（いまは確認できません）</h3>
      <Impact impact={seen.impact} names={names} />
      <p className="ideal-note">サーバーが返した、確認できない理由：</p>
      <ul role="list" className="ideal-note-list" aria-label="確認できない理由">{seen.impact.blocking.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={leave}>採用の選択に戻る</button></div>
    </section>}
    {seen && seen.impact.blocking.length === 0 && <ConfirmSurface title="2. 確認すると変わること"
      changes={changedFacts(facts(seen), confirmed(seen))}
      version={{ from: seen.row.revision, to: seen.row.revision + 1 }}
      notified={NOBODY_NOTIFIED}
      risk={`確認前の時点では検出されていません。確認時にサーバーが、採用の記録が第${seen.row.revision}版のままであることと、ここに表示した影響の内容が変わっていないことを照合します。違っていれば確認せず、競合として知らせます。採用と、同時に確認される参加は1回の処理で記録し、一部だけが確認されることはありません。`}
      outcome={conflictOutcome(send.outcome, (current) => ({ currentRevision: current?.row.revision ?? null, rows: threeWayRows(facts(seen), current && facts(current), confirmed(seen)) }))}
      busy={send.busy} confirmLabel="内容と影響を確認して採用する" backLabel="確認せずに戻る"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      <Impact impact={seen.impact} names={names} />
      <p className="ideal-note">この採用の確認待ちの参加は、同時に確認済みになります。ただし、あなたが登録した参加とあなた自身の参加は、別の管理者の確認が必要です（どれが残ったかは、確認の結果で知らせます）。</p>
      {rebased && <p className="ideal-note" role="status">現在の第{seen.row.revision}版と、読み直した影響に対する確認として確認し直します。内容を確かめて、もう一度操作してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done}</p>
  </div>;
}
