"use client";

import { useId, useState } from "react";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type CopyTarget, type ExternalConfirmBody, type ExternalConfirmed } from "../api";
import IrreversibleConfirm from "./IrreversibleConfirm";
import { blockersText } from "./model";

/**
 * Records that the outside custodian of one copy confirmed its erasure or handling. The
 * application erases nothing and verifies nothing physically; the record cannot be taken back.
 */
export default function ConfirmExternal({ target, label, personId, onRecorded }: { target: CopyTarget; label: string; personId: string; onRecorded: (said: string) => void }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const [entry, setEntry] = useState({ reference: "", reviewer: "" });
  const [body, setBody] = useState<ExternalConfirmBody | null>(null);
  const [attempt, setAttempt] = useState(0);
  const send = useConfirmedSend<ExternalConfirmBody, ExternalConfirmed, CopyTarget>({
    name: `external-confirm:${target.copy_id}`,
    send: (request, key) => api.confirmExternalCopy(live.scopeId, { ...request, idempotency_key: key }),
    readCurrent: async () => (await api.copyInventory(live.scopeId, personId)).targets.find((item) => item.copy_id === target.copy_id) ?? null,
  });
  useUnsavedNavigation(entry.reference !== "" || entry.reviewer !== "");

  async function save() {
    if (!body) return;
    const result = await send.run(body);
    if (!result.done) return;
    const answer = result.result;
    setBody(null); setEntry({ reference: "", reviewer: "" });
    onRecorded(`${label}：外部管理先の処理確認を記録しました（第${answer.revision}版）。${answer.confirmation.local_physical_erasure_verified ? "" : "端末や媒体の物理的な消去は、アプリでは検証していません。"}${answer.all_copies_complete ? "" : "全コピーの消去は完了していません（サーバーの回答）。"}残存を確認し直してください。`);
  }
  const facts = (item: CopyTarget | null) => (item ? `第${item.revision}版・残存理由 ${blockersText(item)}` : "（なし）");

  return <details className="ideal-v3-disclosure"><summary>{label}：外部管理先の処理確認を記録する</summary>
    <div className="ideal-v3-record" role="group" aria-label={`${label}：外部管理先の処理確認を記録する`}>
      {!body && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); send.clear(); setAttempt((count) => count + 1); setBody({ expected_revision: target.revision, payload: { copy_id: target.copy_id, evidence: { reference: entry.reference, status: "verified", verified_by: entry.reviewer } } }); }}>
        <p className="ideal-note">外部の管理先から取得した、消去または処理の確認を記録します。保存期限・保全・原本の照合値・現在の版は、サーバーが照合し直します。</p>
        <label htmlFor={`${id}-reference`}>外部管理先の処理確認資料</label>
        <input id={`${id}-reference`} className="ideal-input" required value={entry.reference} onChange={(event) => setEntry({ ...entry, reference: event.target.value })} />
        <label htmlFor={`${id}-reviewer`}>外部処理の確認担当者</label>
        <input id={`${id}-reviewer`} className="ideal-input" required value={entry.reviewer} onChange={(event) => setEntry({ ...entry, reviewer: event.target.value })} />
        <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary">処理確認の記録内容を確認する</button></div>
      </form>}
      {body && <IrreversibleConfirm key={attempt} level={4} title={`${label}：取り消せない操作の確認（外部管理先の処理確認）`}
        changes={[{ label: `${label}の状態`, before: "外部に残存（確認待ち）", after: "外部管理先の処理確認を記録済み" }, { label: "処理確認資料", before: "（なし）", after: body.payload.evidence.reference }, { label: "確認担当者", before: "（なし）", after: body.payload.evidence.verified_by ?? "" }]}
        version={{ from: target.revision, to: target.revision + 1 }}
        notified="誰にも通知されません。確認の記録（保存物・対象の職員・操作者・時刻）は監査の履歴に残ります。"
        risk={`記録前の時点では検出されていません。記録時にサーバーが、この外部コピーが第${target.revision}版のままで未確認であること、対象者一覧と確認資料が確認済みであること、法的保全がないこと、保存規則が確認済みで保存期限を過ぎていることを照合します。違っていれば記録せず、競合または拒否として知らせます。1件の確認だけを記録するため、一部だけが記録されることはありません。`}
        erased={[]} noneErased="アプリは何も消去しません。外部の管理先が消去または処理したという確認を記録するだけで、端末や媒体の物理的な消去をアプリが検証したことにはなりません。"
        kept={["この外部コピーの登録記録（状態は「処理確認を記録済み」になります）と、確認の記録。", "外部の管理先にある実物。アプリからは消去も検証もできません。"]}
        irreversible="記録した確認は取り消せません。サーバーは、処理確認を記録済みの外部コピーに対する再確認・再登録を拒否します。"
        consent="外部管理先の確認資料を確かめ、取り消せない確認の記録に同意した"
        outcome={conflictOutcome(send.outcome, (current) => ({ currentRevision: current?.revision ?? null, rows: [{ label: `${label}の現在の内容`, base: facts(target), current: facts(current), proposed: `第${target.revision}版に対して確認を記録` }] }))}
        busy={send.busy} confirmLabel="外部管理先の処理確認を記録する" backLabel="記録せずに戻る"
        onConfirm={() => void save()} onBack={() => { setBody(null); send.clear(); }}
        onReviewed={() => { setBody(null); send.clear(); onRecorded(`${label}：確認は記録していません。保存物の状態が変わったため、コピーの残存を確認し直してください。`); }} />}
    </div>
  </details>;
}
