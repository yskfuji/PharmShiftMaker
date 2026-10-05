"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { changedFacts } from "../../shared/records/facts";
import { useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import { useLive } from "../../shell/WorkspaceRuntime";
import { requestsApi, type LeaveRequestRow, type RequestAnswer } from "../api";
import { requestFacts, requestLabel } from "./model";
import { requestOutcome, requestRisk } from "./RequestChange";

/** Withdraws one of the viewer's own requests: choose it, then confirm. The server decides
 * whether it can still be withdrawn (a request already in a published plan, for example). */
export default function WithdrawRequest({ requests }: { requests: LeaveRequestRow[] }) {
  const live = useLive();
  const api = requestsApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target">();
  const mine = requests.filter((row) => row.person_id === live.personId && row.status !== "CANCELLED");
  const [chosen, setChosen] = useState("");
  const [base, setBase] = useState<LeaveRequestRow | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<{ version: number }, RequestAnswer, LeaveRequestRow>({
    name: `request-withdraw:${chosen}`,
    send: (body, key) => api.withdrawRequest(live.scopeId, chosen, { ...body, idempotency_key: key }),
    readCurrent: async () => (await api.leaveRequests(live.scopeId)).find((row) => row.request_id === chosen) ?? null,
  });
  const facts = (row: LeaveRequestRow) => requestFacts(row, live.nameOf);
  const withdrawn = base && facts({ ...base, status: "CANCELLED" });

  function leave() { setBase(null); setRebased(false); send.clear(); steps.moveTo("target"); }
  async function save() {
    if (!base) return;
    const result = await send.run({ version: base.version });
    if (!result.done) return;
    setBase(null); setChosen(""); setRebased(false);
    setDone(`申請を取り下げました（第${result.result.version ?? base.version + 1}版、取下げ済み）。`);
    steps.moveTo("target");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    if (!now) { leave(); setDone("この申請は、現在サーバーにありません。取下げは行っていません。"); return; }
    setBase(now); setRebased(true);
  }

  return <div className="ideal-v3-record">
    <h4 className="ideal-v3-heading" {...steps.heading("target")}>1. 取り下げる申請を選ぶ</h4>
    {mine.length === 0 ? <p className="ideal-note">取り下げられる自分の申請はありません。</p> : <form className="ideal-form" onSubmit={(event) => {
      event.preventDefault();
      const row = mine.find((item) => item.request_id === chosen);
      if (row) { setDone(null); setRebased(false); send.clear(); setBase(row); }
    }}>
      <label htmlFor={`${id}-target`}>取り下げる申請</label>
      <select id={`${id}-target`} className="ideal-input" required value={chosen} disabled={Boolean(base)} onChange={(event) => { setChosen(event.target.value); setDone(null); }}>
        <option value="">選んでください</option>
        {mine.map((row) => <option key={row.request_id} value={row.request_id}>{requestLabel(row, live.nameOf)}</option>)}
      </select>
      {!base && <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">取下げの内容を確認する</button></div>}
    </form>}
    {base && withdrawn && <ConfirmSurface level={4} title="2. 取下げ前の確認"
      changes={changedFacts(facts(base), withdrawn)} version={{ from: base.version, to: base.version + 1 }}
      notified="誰にも通知されません。取下げ後の状態は、本人と管理者・責任者のこの画面の一覧に表示されます。取下げの記録は監査の履歴に残ります。"
      risk={requestRisk(base.version)}
      outcome={requestOutcome(send.outcome, facts, base, withdrawn)} busy={send.busy}
      confirmLabel="この申請を取り下げる" backLabel="取り下げずに戻る"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      {rebased && <p className="ideal-note" role="status">現在の第{base.version}版に対する取下げとして確認し直します。内容を確認して、もう一度操作してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
