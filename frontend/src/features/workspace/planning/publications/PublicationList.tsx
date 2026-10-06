"use client";

import { useId, useState } from "react";
import type { PublicationRead } from "@/ideal/api/contracts";
import { ActionStatus, useAction } from "@/ideal/live/parts";
import { StatusPill } from "@/ideal/ui/atoms";
import { browserNavigation } from "@/lib/browserNavigation";
import ExportPublication from "../../shared/ExportPublication";
import { isReadableWhen, wholeDaysText } from "../../shared/format";
import { useMounted } from "../../shared/hydration";
import { useLive } from "../../shell/WorkspaceRuntime";

/**
 * The publications with their registered export and their cancellation, one card each: what
 * it is (version, state, period), then exporting it, then cancelling it. Cancelling is
 * confirmed in place: the surface names the target, the version, the result and the
 * notification before the reason is asked for, and is sent against the version on screen;
 * the earlier version and the audit record stay. What cancelling does is said in the zone
 * itself, before the button (application/planning.py, cancel_publication: the period is
 * left without a current publication, the leave the publication reserved is released,
 * the people with a duty in it are notified, and nothing is deleted; the server also names
 * the people of the publication's leave allocations, :976-985, but an input of the current
 * formats has none, domain/compliance.py:273-283, so only the duty is promised). A period
 * that cannot be read is not something to confirm a cancellation of: the surface says so
 * and its confirming button stays disabled. Which publication is being cancelled and the
 * reason are the only state.
 */
export default function PublicationList({ items, scopeName }: { items: PublicationRead[]; scopeName: string }) {
  const live = useLive();
  const id = useId();
  const mounted = useMounted();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const cancel = useAction();
  // What the last attempt led to: on the surface it belongs to while that is open.
  const status = <ActionStatus problem={cancel.problem} done={cancel.done} />;
  return <>
    {items.length ? <div className="ideal-record-list">{items.map((item) => {
      const [start, end] = item.period.split("|");
      // A publication's period is a month held as two midnights: said by its first and last day.
      const period = wholeDaysText(start, end);
      const unreadable = !isReadableWhen(start, end);
      return <article key={item.publication_id} className="ideal-v3-planning-publication">
        <div className="ideal-v3-planning-publication__head"><div><h3 className="ideal-v3-heading">公開版 v{item.version}</h3><StatusPill tone={item.validation_status === "revalidation_required" ? "warn" : "good"}>{item.validation_status === "revalidation_required" ? "再検証が必要" : "公開時に検証済み"}</StatusPill></div><p>{period} · 勤務 {item.assignments.length}件</p></div>
        <div className="ideal-v3-planning-zone"><p className="ideal-v3-planning-zone__label">出力</p><ExportPublication scope={live.scopeId} publication={item.publication_id} version={item.version} actionTone="primary" /></div>
        <div className="ideal-v3-planning-zone"><p className="ideal-v3-planning-zone__label">取消</p><ul className="ideal-note-list ideal-v3-planning-effects" aria-label="取消で起きること">
            <li>この期間は、公開中の勤務表がない状態になります。前の版には戻りません。</li>
            <li>この版で確保していた休暇の予約は解除されます。</li>
            <li>この版に勤務が入っていた職員に、取消の通知が届きます。</li>
            <li>取り消した版と監査の記録は残ります。取消は元に戻せません。もう一度公開するには、勤務案を確認して公開し直します。</li>
          </ul>
          <p className="ideal-note">ボタンを押すと確認が開きます。理由を記録して実行するまで、公開は取り消されません。</p>
          {/* Offered once it can answer: a press on a button React has not attached to is lost. */}
          <div className="ideal-actions">{mounted && <button type="button" className="ideal-button ideal-button--danger" onClick={() => { setTarget(item.publication_id); setReason(""); }}>公開を取り消す</button>}</div>
          {target === item.publication_id && <div className="ideal-confirm"><h3>公開取消の確認</h3>
            <dl className="ideal-definition-list"><div><dt>対象</dt><dd>{scopeName}<br />{period}</dd></div><div><dt>版</dt><dd>公開版 v{item.version}（勤務 {item.assignments.length}件）</dd></div><div><dt>変更結果</dt><dd>この版の公開を取り消します。この期間は、公開中の勤務表がない状態になります。</dd></div><div><dt>通知</dt><dd>この版に勤務が入っていた職員に、取消の通知が届きます。</dd></div></dl>
            {unreadable && <p id={`${id}-unreadable`} className="ideal-v3-callout ideal-v3-callout--warn">この公開版の期間を読み取れません。どの期間の公開を取り消すのかを確かめられないため、この画面からは取り消せません。</p>}
            <p>勤務の再調整と関係者への通知が必要です。取消前の版と監査記録は残ります。</p><label>理由<textarea className="ideal-input" aria-describedby={`${id}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} /></label><p id={`${id}-reason`} className="ideal-note">理由を入力すると、取消を実行できます。</p>
            <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--danger" disabled={!reason.trim() || cancel.busy || unreadable} aria-describedby={cancel.busy ? undefined : unreadable ? `${id}-unreadable` : !reason.trim() ? `${id}-reason` : undefined} onClick={() => void cancel.run(async () => {
              const body = { expected_version: item.version, reason };
              await live.mutate(`publication-cancel:${item.publication_id}`, body, (key) => live.client.cancelPublication(live.scopeId, item.publication_id, { ...body, idempotency_key: key }));
              setTarget(null); setReason("");
              // The document is replaced, which reads the route again and shows the notice.
              browserNavigation.replaceWithFlash(browserNavigation.pathAndSearch(), "publication-cancelled");
            })}>理由を記録して公開取消</button><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setTarget(null)}>やめる</button></div>
            {status}
          </div>}
        </div>
      </article>;
    })}</div> : <p className="ideal-note">公開版はありません。</p>}
    {!items.some((item) => item.publication_id === target) && status}
  </>;
}
