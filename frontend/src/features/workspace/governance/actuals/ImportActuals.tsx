"use client";

import { useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { problemFrom } from "@/ideal/api/errors";
import { definite } from "@/ideal/api/mutations";
import { InlineProblem } from "@/ideal/live/parts";
import type { ProblemModel } from "@/ideal/model";
import { PlanningError } from "@/lib/planningTransport";
import ConfirmSurface from "../../shared/ConfirmSurface";
import { jstText } from "../../shared/jst";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type ImportCommitBody, type ImportCommitted, type ImportPreview, type ImportPreviewRow } from "../api";
import { personName, rowErrorsOf, type RowError } from "./model";
import WhyDisabled from "../../shared/WhyDisabled";
import Identifiers from "../../shared/Identifiers";

/** The size the server accepts (it checks again). */
const LIMIT = 2_000_000;
const versionOf = (row: ImportPreviewRow | undefined) => (row ? `保存済み ${row.expected_revision > 0 ? `第${row.expected_revision}版` : "なし"} → 取込後 第${row.expected_revision + 1}版` : "（なし）");

/**
 * Imports a source file of actuals: choose the file, let the server check it against the
 * stored actuals, confirm, save. The file is read in the browser (size and UTF-8 only) and
 * its text is kept in memory for the two requests; it is never written anywhere else. The
 * server finds the row errors; all rows are saved, or none.
 */
export default function ImportActuals({ names, onSaved }: { names: Record<string, string>; onSaved: () => void }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"file">();
  const picker = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ name: string; text: string } | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<{ problem: ProblemModel; rows: RowError[] } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rebased, setRebased] = useState(false);
  const [done, setDone] = useState<{ count: number; hash: string } | null>(null);
  const commit = useConfirmedSend<ImportCommitBody, ImportCommitted, ImportPreview>({
    name: "actual-import",
    send: (body, key) => api.commitActualImport(live.scopeId, { ...body, idempotency_key: key }),
    // What the server holds now is what the same file is checked against now.
    readCurrent: () => api.previewActualImport(live.scopeId, { source_text: source?.text ?? "" }),
  });
  useUnsavedNavigation(Boolean(source));

  function forget() { setSource(null); setPreview(null); setRefusal(null); setRebased(false); commit.clear(); }
  async function choose(file: File | undefined) {
    forget(); setFileProblem(null); setDone(null);
    if (!file) return;
    if (file.size > LIMIT) { setFileProblem("原本は2MB以内にしてください。"); return; }
    try {
      setSource({ name: file.name, text: new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) });
    } catch {
      setFileProblem("UTF-8の原本を読み込めませんでした。");
    }
  }
  async function check() {
    if (!source) return;
    setChecking(true); setRefusal(null); setDone(null);
    try {
      setPreview(await api.previewActualImport(live.scopeId, { source_text: source.text }));
    } catch (error) {
      // Nothing was saved by the check: only a definite refusal is the server's judgement.
      setRefusal({ problem: problemFrom(error, error instanceof PlanningError && definite(error.status) ? "write" : "read"), rows: rowErrorsOf(error) });
    } finally {
      setChecking(false);
    }
  }
  function discard() {
    forget(); setFileProblem(null);
    if (picker.current) picker.current.value = "";
    steps.moveTo("file");
  }
  async function save() {
    if (!source || !preview) return;
    const result = await commit.run({ expected_revision: 0, payload: { source_text: source.text, preview_hash: preview.preview_hash } });
    if (!result.done) return;
    discard();
    setDone({ count: result.result.count, hash: result.result.source_hash });
    onSaved();
  }
  function reviewed() {
    if (commit.outcome.kind !== "conflict") return;
    const now = commit.outcome.current;
    commit.clear();
    if (now) { setPreview(now); setRebased(true); }
  }

  const rowLabel = (row: ImportPreviewRow) => `${row.row}行目 ${personName(names, row.person_id)} ${jstText(row.start)} 〜 ${jstText(row.end)}`;
  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("file")}>1. 原本ファイルを選び、サーバーで照合する</h3>
    <p className="ideal-note">勤怠の原本ファイル（このアプリの実績形式）を選び、保存済みの実績と照らし合わせます。照合では何も保存しません。保存されるのは、次の確認で「この内容で取り込む」を押したときです。</p>
    <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>取り込めるファイルの形式</summary>
      <p className="ideal-note">アプリの実績形式（pharmshift-actuals-v1、UTF-8のJSON、2MB・500件以内）の原本です。所定内外の区分と原本の改定番号が必要です。ほかの形式を推測して変換することはしません。</p>
    </details>
    <div>
      <label className="ideal-file"><FileUp aria-hidden="true" />実績原本ファイル<input ref={picker} id={`${id}-file`} type="file" accept=".json,application/json" disabled={checking || Boolean(preview)} onChange={(event) => void choose(event.target.files?.[0])} /></label>
      {source && <p className="ideal-note">選んだ原本：<span data-verbatim>{source.name}</span></p>}
      {fileProblem && <p className="ideal-note" role="alert">{fileProblem}</p>}
      {!preview && <div className="ideal-actions">
        <button type="button" className="ideal-button ideal-button--primary" disabled={!source || checking} aria-describedby={source ? undefined : `${id}-why`} onClick={() => void check()}>原本と保存済み実績を照合する</button>
        {source && <button type="button" className="ideal-button ideal-button--secondary" disabled={checking} onClick={discard}>取込をやめる</button>}
      </div>}
      {!preview && <WhyDisabled id={`${id}-why`}>{!source && "実績原本ファイルを選ぶと押せます。"}</WhyDisabled>}
    </div>
    {refusal && !preview && <div>
      <InlineProblem problem={refusal.problem} />
      {refusal.rows.length > 0 && <>
        <p className="ideal-note">保存していません。原本の次の行を修正してください。</p>
        <ul role="list" className="ideal-note-list" aria-label="実績原本の行別エラー">{refusal.rows.map((item, index) => <li key={`${item.row}-${item.code}-${index}`}>{item.row}行目：{item.message}</li>)}</ul>
      </>}
    </div>}
    {source && preview && <ConfirmSurface title="2. 取込前の確認"
      changes={preview.rows.map((row) => ({ label: rowLabel(row), before: row.expected_revision > 0 ? `第${row.expected_revision}版` : "（なし）", after: `第${row.expected_revision + 1}版` }))}
      version={{ from: 0, to: 1 }}
      versionText={`実績 ${preview.rows.length}件のそれぞれに、上の「変更内容」の版を作成します。行ごとの所定区分の記録も保存します。`}
      notified="誰にも通知されません。取込の記録（件数・原本の照合値・操作した役割・時刻）は監査の履歴に残ります。取り込んだ実績を含む計画は、再検証の対象になります。"
      risk="保存前の時点では検出されていません。保存時にサーバーが、この照合の後に保存済みの実績と所定区分が変わっていないことを照合します。変わっていれば1件も保存せず、競合として知らせます。全件を保存するか、1件も保存しないかのどちらかで、一部だけが保存されることはありません。"
      outcome={conflictOutcome(commit.outcome, (current) => ({
        currentRevision: null,
        currentText: "保存済みの実績が、照合した後に変わりました。同じ原本を現在の保存内容と照合し直した結果を「現在」に示します。",
        rows: preview.rows.map((row) => ({ label: rowLabel(row), base: versionOf(row), current: versionOf(current?.rows.find((item) => item.row === row.row)), proposed: versionOf(row) })),
      }))}
      busy={commit.busy} confirmLabel="この内容で取り込む" backLabel="取り込まずに戻る"
      onConfirm={() => void save()} onBack={() => { setPreview(null); setRebased(false); commit.clear(); steps.moveTo("file"); }} onReviewed={reviewed}>
      <Identifiers items={[{ key: "source", label: "原本のSHA-256", value: preview.source_hash }, ...preview.rows.map((row) => ({ key: `row:${row.row}`, label: `${row.row}行目の原本の識別子`, value: row.external_id }))]} />
      {rebased && <p className="ideal-note" role="status">現在の保存内容に対する取込として確認し直します。各行の版を確かめて、もう一度操作してください。</p>}
    </ConfirmSurface>}
    <div className="ideal-done" role="status">{done && <>
      <p>{done.count}件を保存しました。取り込んだ実績を含む計画は、再検証の対象になります。</p>
      <Identifiers items={[{ label: "原本のSHA-256", value: done.hash }]} />
    </>}</div>
  </div>;
}
