"use client";

import { ChevronRight } from "lucide-react";
import ContextLink from "@/components/ContextLink";
import type { LiveApi } from "../../live/context";
import { OPEN_CASE } from "../../live/format";
import { useState } from "react";
import { Loaded } from "../../live/parts";
import { useResource } from "../../live/useResource";
import type { IdealScreen, ScheduleChangeCase } from "../../types";
import { StatusPill } from "../shared";
import { asksMe, CaseActions, CaseSummary, replacements } from "./cases";
import NewCaseForm from "./NewCaseForm";

/** A planner's own cases: those removing or adding one of their own duties. (A pharmacist
 * receives only such cases from the server.) */
const involves = (c: ScheduleChangeCase, live: LiveApi) =>
  [...(c.affected_assignments as { person_id?: string }[]), ...replacements(c)].some((d) => d.person_id === live.personId);

function useCases(live: LiveApi) {
  return useResource(() => live.client.changeCases(live.scopeId), `${live.scopeId}|${live.publication?.publication_id}`);
}

/** Requests: your own absences and exchanges, and the consents asked of you. */
/** One confirmation per screen, kept while the lists below change. */
function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  // Always present, so the confirmation is announced when it is put in.
  return { notice, show: setNotice, element: <p className="ideal-done" role="status">{notice ?? ""}</p> };
}

export function LiveRequests({ live, mode = "mine" }: { live: LiveApi; mode?: "mine" | "swap" }) {
  const cases = useCases(live);
  const done = useNotice();
  const own = (live.publication?.assignments ?? []).filter((d) => d.person_id === live.personId);
  const planner = live.role !== "PHARMACIST";
  return (
    <div className="ideal-stack">
      {done.element}
      <section className="ideal-toolbar"><div><span className="ideal-eyebrow">{mode === "swap" ? "勤務交換" : "自分の申請"}</span><h2>{mode === "swap" ? "相手の同意と責任者判断" : "履歴と次の操作"}</h2>
        <p>希望休・年休の申請は、<ContextLink className="ideal-inline-link" href="/workspace/requests/leave">休暇の画面</ContextLink>で行います。</p></div></section>
      <section className="ideal-panel" aria-labelledby="my-cases-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">あなたに関係するケース</span><h2 id="my-cases-title">申請中・同意の依頼</h2></div></div>
        <Loaded resource={cases}>{(list) => <CaseList live={live} selectedCaseId={live.selectedCaseId} list={list.filter((c) => !planner || involves(c, live))} onChanged={(message) => { done.show(message); void cases.reload(); }}
          verbsFor={(c) => [...(asksMe(c, live) ? ["consent", "decline"] as const : []), ...(OPEN_CASE.includes(c.status) && (planner || c.created_by !== "") ? ["withdraw"] as const : [])]} />}</Loaded>
      </section>
      <details className="ideal-v3-disclosure"><summary>{mode === "swap" ? "新しい勤務交換を依頼" : "新しい欠勤・交換を申請"}</summary>
        <section aria-labelledby="new-case-title"><div className="ideal-panel__head"><div><span className="ideal-eyebrow">公開版 {live.publication ? `v${live.publication.version}` : "—"} の自分の勤務</span><h2 id="new-case-title">新しい申請</h2></div></div>
          <NewCaseForm live={live} duties={own} kinds={mode === "swap" ? ["SWAP"] : ["ABSENCE", "SWAP"]} onCreated={() => void cases.reload()} />
        </section>
      </details>
    </div>
  );
}

/** Same-day operations: open cases to decide, and absences recorded by a planner. */
export function LiveOperations({ live }: { live: LiveApi }) {
  const cases = useCases(live);
  const done = useNotice();
  const duties = live.publication?.assignments ?? [];
  return (
    <div className="ideal-stack">
      {done.element}
      <section className="ideal-panel" aria-labelledby="open-cases-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">判断が必要</span><h2 id="open-cases-title">進行中のケース</h2></div></div>
        <Loaded resource={cases}>{(list) => <CaseList live={live} selectedCaseId={live.selectedCaseId} list={list.filter((c) => OPEN_CASE.includes(c.status))} onChanged={(message) => { done.show(message); void cases.reload(); }}
          verbsFor={(c) => [
            ...((c.approval_action ?? (c.status === "READY" ? "APPROVE" : null)) === "RECOMMEND" ? ["recommend"] as const : []),
            ...((c.approval_action ?? (c.status === "READY" ? "APPROVE" : null)) === "APPROVE" ? ["approve"] as const : []),
            ...(c.can_reject ? ["reject"] as const : []),
            ...(asksMe(c, live) ? ["consent", "decline"] as const : []),
            "withdraw" as const,
          ]} />}</Loaded>
      </section>
      <section className="ideal-panel" aria-labelledby="record-absence-title">
        <div className="ideal-panel__head"><div><span className="ideal-eyebrow">公開版 {live.publication ? `v${live.publication.version}` : "—"}</span><h2 id="record-absence-title">欠勤を記録して代わりを決める</h2></div></div>
        <NewCaseForm live={live} duties={duties} kinds={["ABSENCE"]} onCreated={() => void cases.reload()} />
      </section>
    </div>
  );
}

function CaseList({ live, list, selectedCaseId, verbsFor, onChanged }: { live: LiveApi; list: ScheduleChangeCase[]; selectedCaseId: string | null; verbsFor: (c: ScheduleChangeCase) => readonly ("consent" | "decline" | "withdraw" | "recommend" | "approve" | "reject")[]; onChanged: (done: string) => void }) {
  const [selected, setSelected] = useState<string | null>(selectedCaseId);
  if (!list.length) return <p className="ideal-note">いま対応が必要なケースはありません。</p>;
  const current = list.find((item) => item.case_id === selected) ?? (selectedCaseId ? null : list[0]);
  if (!current) return <section className="ideal-note" role="alert"><h3>指定されたケースを表示できません</h3><p>この施設・部署で参照できないか、状態が変わりました。一覧から選び直してください。</p><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setSelected(list[0].case_id)}>一覧の先頭を開く</button></section>;
  return <div className="ideal-v3-master-detail ideal-v3-case-decision"><ul className="ideal-v3-master" aria-label="ケース一覧">{list.map((c) => <li key={c.case_id}><button type="button" aria-pressed={c.case_id === current.case_id} onClick={() => setSelected(c.case_id)}><span className={`ideal-dot ideal-dot--${c.kind === "ABSENCE" ? "warn" : "new"}`} /><span><strong>{c.kind === "ABSENCE" ? "欠勤" : "勤務交換"} · {c.status}</strong><small>版 {c.version} · {String((c.affected_assignments[0] as { start?: string } | undefined)?.start ?? "対象日時未確認")}</small></span><ChevronRight aria-hidden="true" /></button></li>)}</ul><article className="ideal-v3-detail" aria-live="polite"><span className="ideal-eyebrow">判断面 · ケース版 {current.version}</span><CaseSummary c={current} live={live} /><p className="ideal-note">承認すると既存版を上書きせず、新しい公開版を作り、関係者へ通知します。</p><CaseActions c={current} live={live} verbs={[...verbsFor(current)]} onChanged={onChanged} /></article></div>;
}

/** Home queue: consents asked of the viewer, and the open cases a planner decides. */
export function LiveHomeQueue({ live, onNavigate, linkTo }: { live: LiveApi; onNavigate: (screen: IdealScreen) => void; linkTo?: (screen: IdealScreen) => string }) {
  const cases = useCases(live);
  const done = useNotice();
  return (<>
    {done.element}
    <Loaded resource={cases}>{(list) => {
      const asked = list.filter((c) => asksMe(c, live));
      const open = list.filter((c) => OPEN_CASE.includes(c.status));
      const counts = { READY: 0, AWAITING_INDEPENDENT_APPROVAL: 0, AWAITING_CONSENT: 0, DRAFT: 0 } as Record<string, number>;
      for (const c of open) counts[c.status] += 1;
      return <div className="ideal-stack">
        {asked.length > 0 && <section className="ideal-panel" aria-labelledby="asked-title">
          <div className="ideal-panel__head"><div><span className="ideal-eyebrow">あなたへの依頼</span><h2 id="asked-title">同意が必要な勤務</h2></div><StatusPill tone="warn">{asked.length}件</StatusPill></div>
          <div className="ideal-case-list">{asked.map((c) => <article key={c.case_id}><CaseSummary c={c} live={live} /><CaseActions c={c} live={live} verbs={["consent", "decline"]} onChanged={(message) => { done.show(message); void cases.reload(); }} /></article>)}</div>
        </section>}
        {live.role !== "PHARMACIST" && <section className="ideal-panel" aria-labelledby="queue-title">
          <div className="ideal-panel__head"><div><span className="ideal-eyebrow">判断待ち</span><h2 id="queue-title">次に判断すること</h2></div>
            {linkTo
              ? <ContextLink className="ideal-link ideal-link--target" href={linkTo("operations")}>当日運用で開く <ChevronRight aria-hidden="true" /></ContextLink>
              : <button type="button" className="ideal-link ideal-link--target" onClick={() => onNavigate("operations")}>当日運用で開く <ChevronRight aria-hidden="true" /></button>}</div>
          <ol className="ideal-priority-list">
            <li><span className="ideal-priority-list__number">{counts.READY}</span><div><strong>承認待ち</strong><p>同意がそろい、承認すると新しい公開版になるケース</p></div><StatusPill tone={counts.READY ? "good" : "neutral"}>承認</StatusPill></li>
            <li><span className="ideal-priority-list__number">{counts.AWAITING_INDEPENDENT_APPROVAL}</span><div><strong>別担当の承認待ち</strong><p>作成者・対象者とは別の責任者が最終判断するケース</p></div><StatusPill tone={counts.AWAITING_INDEPENDENT_APPROVAL ? "warn" : "neutral"}>四つの目</StatusPill></li>
            <li><span className="ideal-priority-list__number">{counts.AWAITING_CONSENT}</span><div><strong>同意待ち</strong><p>関係者の同意を待っているケース</p></div><StatusPill tone={counts.AWAITING_CONSENT ? "warn" : "neutral"}>待機</StatusPill></li>
            <li><span className="ideal-priority-list__number">{counts.DRAFT}</span><div><strong>指摘あり</strong><p>サーバーの検証で公開できないケース（取り下げて作り直す）</p></div><StatusPill tone={counts.DRAFT ? "danger" : "neutral"}>要対応</StatusPill></li>
          </ol>
        </section>}
        {live.role === "PHARMACIST" && !asked.length && <p className="ideal-note">あなたに同意を求めている申請はありません。</p>}
      </div>;
    }}</Loaded>
  </>);
}
