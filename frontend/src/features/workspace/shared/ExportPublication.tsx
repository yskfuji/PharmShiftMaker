"use client";

import { useId, useState } from "react";
import { problemFrom } from "@/ideal/api/errors";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import { useLive } from "../shell/WorkspaceRuntime";
import type { ExportFormat } from "./api";
import { advanceExport, attemptFor, sameTarget, saveFile, type ExportAttempt, type ExportTarget } from "./publicationExport";

const FORMATS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: "json", label: "JSON（機械連携）" },
  { value: "csv", label: "CSV（勤務区間）" },
  { value: "csv-wide", label: "CSV（日別一覧）" },
];

/** What the control knows about the last press. Everything but `idle` names the target it
 * is about, and is shown only while that target is the one on screen. */
type ExportState =
  | { kind: "idle" }
  | { kind: "sending"; target: ExportTarget }
  | { kind: "saved"; target: ExportTarget; name: string; transferId: string }
  /** Nothing was saved; the next press for the same target sends the same attempt again. */
  | { kind: "resend"; target: ExportTarget; attempt: ExportAttempt; why: Resend }
  | { kind: "refused"; target: ExportTarget; problem: ProblemModel };

type Resend = "no-answer" | "not-verified" | "not-usable";
const RESEND: Record<Resend, string> = {
  "no-answer": "応答を受け取れませんでした。通信断のときは、形式を変えずにもう一度押してください。同じ出力として送り直すため、二重には登録されません。",
  "not-verified": "保存を止めました。受渡し記録が無いか、受け取った内容のSHA-256が登録済みの値と一致しません。もう一度押すと、同じ出力を受け取り直します。",
  // The answer arrived; what failed is this browser reading, checking or saving the file.
  "not-usable": "ファイルは保存していません。サーバーの応答は届きましたが、このブラウザーでは受け取ったファイルを検証または保存できませんでした。受渡しは既に記録されている可能性があります。形式を変えずにもう一度押すと、同じ出力として受け取り直します（二重には登録されません）。",
};

/**
 * Saves one publication of the scope as a file, in the format chosen here. The requests and
 * their order are the protocol's (publicationExport.ts); this island keeps the chosen format
 * and what the last press led to, both bound to the publication and format they belong to.
 */
export default function ExportPublication({ scope, publication, version }: { scope: string; publication: string; version: number }) {
  const live = useLive();
  const id = useId();
  const [format, setFormat] = useState<ExportFormat>("json");
  const [state, setState] = useState<ExportState>({ kind: "idle" });
  const target: ExportTarget = { scopeId: scope, publicationId: publication, version, format };
  // The last outcome, when it is about what is on screen now; an outcome of another
  // publication, version or format is neither shown nor continued.
  const shown = state.kind !== "idle" && sameTarget(state.target, target) ? state : null;
  const sending = state.kind === "sending";

  async function press() {
    const attempt = attemptFor(shown?.kind === "resend" ? shown.attempt : null, target);
    setState({ kind: "sending", target: attempt.target });
    const step = await advanceExport(live.client, attempt);
    if (step.kind === "verified") {
      // The transfer is recorded by now. A browser that cannot save the file has not saved
      // it: that is said, and the same attempt (the same two keys) can ask for it again.
      try { saveFile(step.file); } catch { setState({ kind: "resend", target: attempt.target, attempt, why: "not-usable" }); return; }
      setState({ kind: "saved", target: attempt.target, name: step.file.name, transferId: step.file.transferId });
    } else if (step.kind === "refused") {
      setState({ kind: "refused", target: attempt.target, problem: problemFrom(step.error) });
    } else {
      setState({ kind: "resend", target: attempt.target, attempt: step.pending, why: step.kind === "unknown" ? "no-answer" : step.kind === "unusable" ? "not-usable" : "not-verified" });
    }
  }

  const said = shown?.kind === "saved" ? `${shown.name} を保存しました。受渡し記録：${shown.transferId}。この受渡し先での消去は、未確認として記録されています。`
    : shown?.kind === "resend" ? RESEND[shown.why]
    : "";
  return <section className="ideal-v3-export" aria-label="公開版の登録済み出力">
    <label htmlFor={`${id}-format`}>出力形式</label>
    <select id={`${id}-format`} className="ideal-input" aria-describedby={`${id}-formats`} value={format} disabled={sending} onChange={(event) => setFormat(event.target.value as ExportFormat)}>
      {FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    <p id={`${id}-formats`} className="ideal-note">JSONは他のシステムとの連携用で、元の識別子をそのまま含みます。CSVは人が読むための形式で、勤務区間ごと、または日別の一覧です。</p>
    <p className="ideal-note">サーバーが出力を管理領域に登録し、受渡しを記録してから渡します。受け取った内容は、登録済みのSHA-256と一致したときだけ保存します。</p>
    <div className="ideal-actions"><button type="button" className="ideal-button ideal-button--secondary" disabled={sending} onClick={() => void press()}>{sending ? "出力しています…" : "この公開版を出力"}</button></div>
    {shown?.kind === "refused" && <InlineProblem problem={shown.problem} />}
    {/* Always present, so that what is put into it is announced. */}
    <p className={shown?.kind === "resend" ? "ideal-note" : "ideal-done"} role="status">{said}</p>
  </section>;
}
