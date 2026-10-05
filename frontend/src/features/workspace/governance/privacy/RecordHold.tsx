"use client";

import { useId, useState } from "react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { changedFacts, threeWayRows } from "../../shared/records/facts";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type HoldBody, type HoldSaved, type LegalHold, type Named } from "../api";
import { holdFacts, holdLabel } from "./model";

const NEW = "new";
const DEPARTMENT = "";
type Entry = { person: string; active: boolean; reason: string };
const entryOf = (hold: LegalHold | undefined): Entry => ({ person: hold?.person_id ?? DEPARTMENT, active: true, reason: hold?.payload.reason ?? "" });

/**
 * Records a legal hold, or releases one: choose a registered hold or a new one, say whom
 * it covers (a new hold only; a person or the whole department), give the reason, confirm.
 * What a hold stops is the server's: it refuses person control and erasure while one is active.
 */
export default function RecordHold({ holds, people }: { holds: LegalHold[]; people: Named[] }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"target" | "content">();
  const [chosen, setChosen] = useState("");
  const [entry, setEntry] = useState<Entry>(entryOf(undefined));
  const [base, setBase] = useState<LegalHold | null | undefined>(undefined);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const hold = holds.find((item) => item.hold_id === chosen);
  const send = useConfirmedSend<HoldBody, HoldSaved, LegalHold>({
    name: `hold:${chosen}`,
    send: (body, key) => api.saveHold(live.scopeId, { ...body, idempotency_key: key }),
    readCurrent: async () => (await api.privacy(live.scopeId)).holds.find((item) => item.hold_id === chosen) ?? null,
  });
  useUnsavedNavigation(chosen !== "" && JSON.stringify(entry) !== JSON.stringify(entryOf(hold)));
  const facts = (item: LegalHold) => holdFacts({ person_id: item.person_id, active: item.active, reason: item.payload.reason ?? "" }, people);
  const subject = (from: LegalHold | null) => (from ? from.person_id : entry.person || null);
  const proposed = (from: LegalHold | null) => holdFacts({ person_id: subject(from), active: entry.active, reason: entry.reason }, people);

  function choose(target: string) { setChosen(target); setEntry(entryOf(holds.find((item) => item.hold_id === target))); setBase(undefined); setRebased(false); setDone(null); send.clear(); }
  function leave() { setBase(undefined); setRebased(false); send.clear(); steps.moveTo("content"); }
  async function save() {
    if (base === undefined) return;
    const result = await send.run({ expected_revision: base?.revision ?? 0, payload: { ...(base ? { hold_id: base.hold_id } : {}), person_id: subject(base), active: entry.active, reason: entry.reason } });
    if (!result.done) return;
    choose("");
    setDone(`保全判断を記録しました（第${result.result.revision}版）。`);
    steps.moveTo("target");
  }
  function reviewed() {
    if (send.outcome.kind !== "conflict") return;
    const now = send.outcome.current;
    send.clear();
    if (!now) { choose(""); setDone("この保全記録は、現在サーバーにありません。判断は記録していません。"); steps.moveTo("target"); return; }
    setBase(now); setRebased(true);
  }

  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("target")}>1. 対象の保全記録を選ぶ</h3>
    <div className="ideal-form">
      <label htmlFor={`${id}-target`}>対象の保全記録</label>
      <select id={`${id}-target`} className="ideal-input" value={chosen} disabled={base !== undefined} onChange={(event) => { choose(event.target.value); if (event.target.value) steps.moveTo("content"); }}>
        <option value="">選んでください</option>
        <option value={NEW}>新しく保全する</option>
        {holds.map((item) => <option key={item.hold_id} value={item.hold_id}>{holdLabel(item, people)}</option>)}
      </select>
    </div>
    {chosen !== "" && base === undefined && <>
      <h3 className="ideal-v3-heading" {...steps.heading("content")}>2. 保全の対象・操作・理由を入力する</h3>
      <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); setDone(null); send.clear(); setBase(hold ?? null); }}>
        {hold ? <p className="ideal-note">保全の対象：{holdLabel(hold, people)}。登録済みの保全の対象は変更できません。</p> : <>
          <label htmlFor={`${id}-person`}>保全の対象</label>
          <select id={`${id}-person`} className="ideal-input" value={entry.person} onChange={(event) => setEntry({ ...entry, person: event.target.value })}>
            <option value={DEPARTMENT}>部署全体</option>
            {people.map((person) => <option key={person.person_id} value={person.person_id}>{person.name}</option>)}
          </select>
        </>}
        <label htmlFor={`${id}-active`}>保全操作</label>
        <select id={`${id}-active`} className="ideal-input" value={entry.active ? "hold" : "release"} onChange={(event) => setEntry({ ...entry, active: event.target.value === "hold" })}>
          <option value="hold">保全する</option>
          {hold && <option value="release">保全を解除する</option>}
        </select>
        <label htmlFor={`${id}-reason`}>判断理由</label>
        <textarea id={`${id}-reason`} className="ideal-input" required value={entry.reason} onChange={(event) => setEntry({ ...entry, reason: event.target.value })} />
        <div className="ideal-actions">
          <button type="submit" className="ideal-button ideal-button--primary">保全判断の内容を確認する</button>
          <button type="button" className="ideal-button ideal-button--secondary" onClick={() => { choose(""); steps.moveTo("target"); }}>入力を破棄する</button>
        </div>
      </form>
    </>}
    {base !== undefined && <ConfirmSurface title="3. 記録前の確認"
      changes={changedFacts(base ? facts(base) : null, proposed(base))}
      version={{ from: base?.revision ?? 0, to: (base?.revision ?? 0) + 1 }}
      notified="誰にも通知されません。保全判断の記録（保全の状態・操作者・時刻）は監査の履歴に残ります。"
      risk={`記録前の時点では検出されていません。記録時にサーバーが、${base ? `この保全記録が第${base.revision}版のままであること` : "新しい保全記録であること"}を照合します。違っていれば記録せず、競合として知らせます。1件の保全判断だけを記録するため、一部だけが記録されることはありません。`}
      outcome={conflictOutcome(send.outcome, (current) => ({ currentRevision: current?.revision ?? null, rows: threeWayRows(base ? facts(base) : null, current && facts(current), proposed(base)) }))}
      busy={send.busy} confirmLabel="この保全判断を記録する"
      onConfirm={() => void save()} onBack={leave} onReviewed={reviewed}>
      <p className="ideal-note">保全中の対象について、サーバーは人物制御の適用、消去計画の実行、コピーの消去と旧勤務入力の消去を拒否します。部署全体の保全は、同じ施設のすべての職員に及びます。</p>
      {rebased && base && <p className="ideal-note" role="status">現在の第{base.revision}版に対する判断として確認し直します。保全の状態を確かめて、もう一度記録してください。</p>}
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
