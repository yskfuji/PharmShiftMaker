"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import { StatusPill } from "@/ideal/ui/atoms";
import type { Change, ThreeWayRow } from "./records/facts";
import type { FieldIssue } from "./records/useRecordSave";
import ThreeWayTable from "./ThreeWayTable";
import WhyDisabled from "./WhyDisabled";

export type ConfirmOutcome =
  | { kind: "idle" }
  /** `currentText` says what the server holds now when that is not one record's version. */
  | { kind: "conflict"; rows: ThreeWayRow[]; currentRevision: number | null; currentText?: string }
  | { kind: "unknown"; problem: ProblemModel }
  | { kind: "refused"; problem: ProblemModel; fields: FieldIssue[] };

/**
 * The confirmation of one save, in place (not a dialog). It always says four things:
 * what changes, which version is created, who is notified, and whether a conflict or a
 * partial failure is known. Focus moves to its heading when it opens.
 * - conflict (409): it stays open with the three contents side by side; saving is offered
 *   again only after `onReviewed`, when the owner has taken the current version as the
 *   one to compare and save against.
 * - unknown outcome: it says the same content can be sent again; the owner resends the
 *   same body, so the same idempotency key is used.
 * - refused: the server's message (and fields, when it names them) is shown; nothing was saved.
 * The confirmation of something that cannot be undone is given `confirmTone="danger"`: its
 * edge and its confirming button are then in the danger colour (the owner declares it where
 * it declares the operation; it is never derived from the data).
 * A confirming button that cannot be pressed says why, in a note under the buttons that is
 * the button's description: after a conflict, that the three contents have to be reviewed
 * first (this part knows that itself); while the owner holds it back (`confirmDisabled`),
 * the owner's own sentence (`confirmDisabledReason`: a consent not yet given, a date that
 * could not be read). While something is being sent there is no note.
 * A change whose owner marked it as typed by a person (`verbatim`, records/facts.ts) is
 * shown with `data-verbatim`: its words are the person's, not the product's.
 */
export default function ConfirmSurface({ title, level = 3, changes, version, versionText, notified, risk, outcome, busy, confirmLabel, confirmTone = "primary", confirmDisabled = false, confirmDisabledReason, resendLabel = "同じ内容を再送する", backLabel = "入力に戻る", onConfirm, onBack, onReviewed, children }: {
  title: string;
  level?: 3 | 4;
  /** The lines that differ from the current version; none when the content is the same. */
  changes: Change[];
  /** `from` 0: the record does not exist yet. `from === to`: no new version is created. */
  version: { from: number; to: number };
  /** Says what is created when it is not a version of one record (replaces the wording of `version`). */
  versionText?: string;
  /** Who is notified, in words. Say plainly when nobody is. */
  notified: string;
  /** What is known about conflicts and partial failure before anything is sent. */
  risk: string;
  outcome: ConfirmOutcome;
  busy: boolean;
  confirmLabel: string;
  /** `danger` for an operation that cannot be undone. */
  confirmTone?: "primary" | "danger";
  /** True while something the owner asks for inside the confirmation (an explicit consent)
   * is still missing: nothing can be sent. */
  confirmDisabled?: boolean;
  /** Why, in one sentence a person can act on (「上の確認にチェックを入れると押せます。」):
   * shown under the buttons while `confirmDisabled` is true, as the button's description. */
  confirmDisabledReason?: string;
  resendLabel?: string;
  backLabel?: string;
  onConfirm: () => void;
  onBack: () => void;
  onReviewed: () => void;
  children?: ReactNode;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const Heading = `h${level}` as const;
  const conflict = outcome.kind === "conflict" ? outcome : null;
  // Why the confirming button cannot be pressed, when that is not just "it is being sent".
  const why = busy ? null : conflict ? "競合した内容を確かめる必要があります。上の「三つの内容を確認し、現在の版に対して確認し直す」を押すと、もう一度押せるようになります。"
    : confirmDisabled ? confirmDisabledReason ?? null : null;
  return <section className={`ideal-confirm ideal-v3-confirm${confirmTone === "danger" ? " ideal-confirm--danger" : ""}`} aria-labelledby={`${id}-title`}>
    <Heading id={`${id}-title`} className="ideal-v3-heading" ref={heading} tabIndex={-1}>{title}</Heading>
    <dl className="ideal-definition-list">
      <div><dt>変更内容</dt><dd>{changes.length
        ? <ul>{changes.map((change) => <li key={change.label} data-verbatim={change.verbatim ? "" : undefined}>{change.label}：{change.before} → {change.after}</li>)}</ul>
        : "現在の版との差分はありません。"}</dd></div>
      <div><dt>作成される版</dt><dd>{versionText ? versionText : version.from === 0 ? `新規登録（第${version.to}版を作成）`
        : version.from === version.to ? `第${version.from}版のまま（内容が同じため、新しい版は作られません）`
          : `第${version.from}版 → 第${version.to}版`}</dd></div>
      <div><dt>通知</dt><dd>{notified}</dd></div>
      <div><dt>競合・部分失敗</dt><dd>{outcome.kind === "conflict" ? "競合があります。保存していません。下の三つの内容を確認してください。"
        : outcome.kind === "unknown" ? "結果を確認できません。保存されたかどうかは不明です。同じ内容のまま再送できます（同じ受付キーで送るため、二重には保存されません）。"
          : outcome.kind === "refused" ? "保存していません。サーバーが下の理由で受け付けませんでした。"
            : risk}</dd></div>
    </dl>
    {children}
    {conflict && <>
      <div className="ideal-inline-problem" role="alert">
        <StatusPill tone="warn">409</StatusPill>
        <div><strong>別の更新と競合しました</strong><p>{conflict.currentText ?? (conflict.currentRevision === null ? "現在、この記録はサーバーにありません。" : `現在の版は第${conflict.currentRevision}版です。`)}編集中の内容は保持しています。自動では統合しません。</p></div>
      </div>
      <ThreeWayTable rows={conflict.rows} />
      <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" onClick={onReviewed}>三つの内容を確認し、現在の版に対して確認し直す</button></div>
    </>}
    {(outcome.kind === "unknown" || outcome.kind === "refused") && <InlineProblem problem={outcome.problem} />}
    {outcome.kind === "refused" && outcome.fields.length > 0 && <ul role="list" className="ideal-note-list">{outcome.fields.map((issue, index) => <li key={index}>{issue.field ? `${issue.field}：` : ""}{issue.message}</li>)}</ul>}
    <div className="ideal-actions">
      <button type="button" className={confirmTone === "danger" ? "ideal-button ideal-button--danger" : "ideal-button ideal-button--primary"} disabled={busy || Boolean(conflict) || confirmDisabled} aria-describedby={why ? `${id}-why` : undefined} onClick={onConfirm}>{outcome.kind === "unknown" ? resendLabel : confirmLabel}</button>
      <button type="button" className="ideal-button ideal-button--secondary" disabled={busy} onClick={onBack}>{backLabel}</button>
    </div>
    <WhyDisabled id={`${id}-why`}>{why}</WhyDisabled>
  </section>;
}
