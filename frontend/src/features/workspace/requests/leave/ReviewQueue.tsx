"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { changedFacts } from "../../shared/records/facts";
import { useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { requestsApi, type LeaveRequestRow, type RequestAnswer } from "../api";
import { isPaidLeave, requestFacts, requestLabel } from "./model";
import { requestOutcome, requestRisk } from "./RequestChange";

type Decision = { version: number; approved: boolean; reference: string };

/**
 * The planner's confirmation of one request: choose it, record "confirmed" or "keep
 * consulting" with the reference the decision rests on, confirm. A confirmed paid leave
 * becomes a reservation only when it is applied to the planning input.
 */
export default function ReviewQueue({ requests }: { requests: LeaveRequestRow[] }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const queue = requests.filter((row) => row.status !== "APPROVED" && row.status !== "CANCELLED");
  const [chosen, setChosen] = useState("");
  const [approved, setApproved] = useState(true);
  const [reference, setReference] = useState("");
  const [base, setBase] = useState<LeaveRequestRow | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<Decision, RequestAnswer, LeaveRequestRow>({
    name: `request-decision:${chosen}`,
    send: (body, key) => api.decideRequest(live.scopeId, chosen, { ...body, idempotency_key: key }),
    readCurrent: async () => (await api.leaveRequests(live.scopeId)).find((row) => row.request_id === chosen) ?? null,
  });
  useUnsavedNavigation(Boolean(reference));
  const row = queue.find((item) => item.request_id === chosen);
  const facts = (item: LeaveRequestRow) => requestFacts(item, live.nameOf);
  const decided = base && facts({ ...base, status: approved ? "APPROVED" : "REQUIRES_DISCUSSION", decision: { reference } });

  function choose(target: string) { setChosen(target); setApproved(true); setReference(""); setBase(null); setRebased(false); setDone(null); send.clear(); }
  async function save() {
    if (!base) return;
    const result = await send.run({ version: base.version, approved, reference });
    if (!result.done) return;
    choose("");
    setDone(approved ? "申請を確認済みとして記録しました。年休は、計画入力へ反映したときに予約として扱われます。" : "相談・判断を継続する申請として記録しました。");
    steps.moveTo("target");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    if (!now) { choose(""); setDone("この申請は、現在サーバーにありません。判断は記録していません。"); steps.moveTo("target"); return; }
    setBase(now); setRebased(true);
  }

  return <div className="ideal-v3-record">
    <h4 className="ideal-v3-heading" {...steps.heading("target")}>1. 確認する申請を選ぶ</h4>
    {queue.length === 0 ? <p className="ideal-note">確認を待っている申請はありません。</p> : <div className="ideal-form">
      <label htmlFor={`${id}-target`}>確認する申請</label>
      <select id={`${id}-target`} className="ideal-input" value={chosen} disabled={Boolean(base)} onChange={(event) => choose(event.target.value)}>
        <option value="">選んでください</option>
        {queue.map((item) => <option key={item.request_id} value={item.request_id}>{requestLabel(item, live.nameOf)}</option>)}
      </select>
    </div>}
    {row && !base && <>
      <h4 className="ideal-v3-heading" {...steps.heading("content")}>2. 判断と根拠を入力する</h4>
      <dl className="ideal-definition-list">{facts(row).map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.text}</dd></div>)}</dl>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); setBase(row); }}>
        <label htmlFor={`${id}-decision`}>判断</label>
        <select id={`${id}-decision`} className="ideal-input" value={approved ? "approve" : "continue"} onChange={(event) => setApproved(event.target.value === "approve")}>
          <option value="approve">{isPaidLeave(row.kind) ? "取得予定として確認" : "希望として確認"}</option>
          <option value="continue">相談・判断を継続</option>
        </select>
        <label htmlFor={`${id}-reference`}>判断の根拠・相談記録</label>
        <input id={`${id}-reference`} className="ideal-input" required value={reference} onChange={(event) => setReference(event.target.value)} />
        <p className="ideal-note">確認した申請・規程・調整記録の参照を書きます。確認者は、サインイン中のアカウントとしてサーバーが記録します。</p>
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">判断の内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { choose(""); steps.moveTo("target"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {base && decided && <ConfirmSurface level={4} title="3. 記録前の確認"
      changes={changedFacts(facts(base), decided)} version={{ from: base.version, to: base.version + 1 }}
      notified="誰にも通知されません。判断後の状態と判断の記録は、本人のこの画面の一覧に表示されます。判断の記録は監査の履歴に残ります。"
      risk={requestRisk(base.version)}
      outcome={requestOutcome(send.outcome, facts, base, decided)} busy={send.busy}
      confirmLabel="この判断を記録する"
      onConfirm={() => void save()} onBack={() => { setBase(null); setRebased(false); send.clear(); steps.moveTo("content"); }} onReviewed={reviewed}>
      {rebased && <p className="ideal-note" role="status">現在の第{base.version}版に対する判断として確認し直します。申請の内容が変わっていないか確かめて、もう一度記録してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
