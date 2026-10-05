"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { changedFacts, threeWayRows } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type CaseDecisionBody, type CaseSaved, type Named, type PrivacyCase } from "../api";
import { caseFacts, caseLabel, decisionFacts, statusLabel } from "./model";

type Entry = { status: string; reason: string; reference: string; reviewer: string; result: string };
const EMPTY: Entry = { status: "", reason: "", reference: "", reviewer: "", result: "" };

/**
 * Records the next decision on one request: choose the request, read it, choose among the
 * decisions the server lists for it (`allowed_next`), give the reason and the identity
 * evidence, confirm. A result reference is asked for exactly when the server says the
 * chosen decision needs one (`result_reference_required`). No transition table is kept here.
 */
export default function DecideCase({ cases, people }: { cases: PrivacyCase[]; people: Named[] }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const [chosen, setChosen] = useState("");
  const [entry, setEntry] = useState<Entry>(EMPTY);
  const [base, setBase] = useState<PrivacyCase | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<CaseDecisionBody, CaseSaved, PrivacyCase>({
    name: `privacy-decision:${chosen}`,
    send: (body, key) => api.decidePrivacyCase(live.scopeId, chosen, { ...body, idempotency_key: key }),
    readCurrent: async () => (await api.privacy(live.scopeId)).cases.find((item) => item.case_id === chosen) ?? null,
  });
  const open = cases.filter((item) => item.allowed_next.length > 0);
  const closed = cases.filter((item) => item.allowed_next.length === 0);
  const row = open.find((item) => item.case_id === chosen);
  useUnsavedNavigation(Boolean(row) && JSON.stringify(entry) !== JSON.stringify(EMPTY));
  const decision = (from: PrivacyCase) => ({ expected_revision: from.revision, status: entry.status, reason: entry.reason, result_reference: entry.result || null, identity_evidence: { reference: entry.reference, status: "verified", verified_by: entry.reviewer } });
  const facts = (item: PrivacyCase) => [...caseFacts(item, people), { label: "判断理由", text: "（なし）" }, { label: "本人確認の根拠", text: "（なし）" }, { label: "本人確認者", text: "（なし）" }, { label: "実施結果の参照", text: "（なし）" }];
  const proposed = (item: PrivacyCase) => [...caseFacts(item, people).slice(0, 3), ...decisionFacts(decision(item))];

  function choose(target: string) { setChosen(target); setEntry(EMPTY); setBase(null); setRebased(false); setDone(null); send.clear(); }
  function leave() { setBase(null); setRebased(false); send.clear(); steps.moveTo("content"); }
  async function save() {
    if (!base) return;
    const result = await send.run({ expected_revision: base.revision, payload: decision(base) });
    if (!result.done) return;
    choose("");
    setDone(`判断を記録しました（第${result.result.revision}版・${statusLabel(result.result.status)}）。`);
    steps.moveTo("target");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    // The request is gone, or the server no longer accepts this decision for it: nothing is sent.
    if (!now || !now.allowed_next.includes(entry.status)) {
      choose("");
      setDone(now ? `判断は記録していません。この請求は現在「${statusLabel(now.status)}」（第${now.revision}版）で、サーバーは選んだ判断を受け付けません。` : "この請求は、現在サーバーにありません。判断は記録していません。");
      steps.moveTo("target");
      return;
    }
    setBase(now); setRebased(true);
  }

  const needsResult = Boolean(row?.result_reference_required.includes(entry.status));
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 判断する請求を選ぶ</h3>
    {open.length === 0 ? <p className="ideal-note">サーバーが次の判断を受け付ける請求はありません。</p> : <div className="ideal-form">
      <label htmlFor={`${id}-target`}>判断する請求</label>
      <select id={`${id}-target`} className="ideal-input" value={chosen} disabled={Boolean(base)} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        {open.map((item) => <option key={item.case_id} value={item.case_id}>{caseLabel(item, people)}：{item.payload.reason}</option>)}
      </select>
    </div>}
    {closed.length > 0 && <ul className="ideal-note-list" aria-label="次の判断がない請求">{closed.map((item) => <li key={item.case_id}>{caseLabel(item, people)}：サーバーは次の判断を返していません。</li>)}</ul>}
    {row && !base && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. 請求を確かめ、判断と根拠を入力する</h3>
      <dl className="ideal-definition-list">{caseFacts(row, people).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.text}</dd></div>)}</dl>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); send.clear(); setBase(row); }}>
        <label htmlFor={`${id}-status`}>次の判断</label>
        <select id={`${id}-status`} className="ideal-input" required value={entry.status} onChange={(event) => setEntry({ ...entry, status: event.target.value })}>
          <option value="">選んでください</option>
          {row.allowed_next.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
        <p className="ideal-note">選べる判断は、サーバーがこの請求の現在の状態に対して返したものです。</p>
        <label htmlFor={`${id}-reason`}>判断理由</label>
        <textarea id={`${id}-reason`} className="ideal-input" required maxLength={2000} value={entry.reason} onChange={(event) => setEntry({ ...entry, reason: event.target.value })} />
        <label htmlFor={`${id}-reference`}>本人確認の根拠</label>
        <input id={`${id}-reference`} className="ideal-input" required value={entry.reference} onChange={(event) => setEntry({ ...entry, reference: event.target.value })} />
        <label htmlFor={`${id}-reviewer`}>本人確認者</label>
        <input id={`${id}-reviewer`} className="ideal-input" required value={entry.reviewer} onChange={(event) => setEntry({ ...entry, reviewer: event.target.value })} />
        <label htmlFor={`${id}-result`}>実施結果の参照（{needsResult ? "この判断では必須" : "任意"}）</label>
        <input id={`${id}-result`} className="ideal-input" required={needsResult} value={entry.result} onChange={(event) => setEntry({ ...entry, result: event.target.value })} />
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">判断の内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { choose(""); steps.moveTo("target"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {base && <ConfirmSurface title="3. 記録前の確認"
      changes={changedFacts(facts(base), proposed(base))}
      version={{ from: base.revision, to: base.revision + 1 }}
      notified="誰にも通知されません。判断後の状態は、本人と管理者のこの画面の一覧に表示されます。判断の記録（状態・理由・操作者・時刻）は監査の履歴に残ります。"
      risk={`記録前の時点では検出されていません。記録時にサーバーが、この請求が第${base.revision}版のままであること、選んだ判断が現在の状態から受け付けられること、本人確認の根拠が確認済みであることを照合します。違っていれば記録せず、競合または拒否として知らせます。1件の判断だけを記録するため、一部だけが記録されることはありません。`}
      outcome={conflictOutcome(send.outcome, (current) => ({ currentRevision: current?.revision ?? null, rows: threeWayRows(facts(base), current && facts(current), proposed(base)) }))}
      busy={send.busy} confirmLabel="この判断を記録する"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      <p className="ideal-note">利用停止の請求を「実施承認」にすると、サーバーは同じ施設のすべての部署で、通常の勤務計画の読取りと操作を停止し、待機中・実行中の勤務表の生成を止めます（この個人情報の画面は引き続き使えます）。「利用停止を解除」を記録すると再開します。</p>
      {rebased && <p className="ideal-note" role="status">現在の第{base.revision}版に対する判断として確認し直します。請求の内容が変わっていないか確かめて、もう一度記録してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
