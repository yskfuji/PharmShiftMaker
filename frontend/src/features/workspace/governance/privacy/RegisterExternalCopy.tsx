"use client";

import { useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import ConfirmSurface from "../../shared/ConfirmSurface";
import JstDateTimeField from "../../shared/JstDateTimeField";
import { jstText } from "../../shared/jst";
import { CheckField } from "../../shared/records/fields";
import { conflictOutcome, useConfirmedSend } from "../../shared/records/useConfirmedSend";
import { useStepFocus } from "../../shared/useStepFocus";
import useUnsavedNavigation from "../../shared/useUnsavedNavigation";
import { useLive } from "../../shell/WorkspaceRuntime";
import { governanceApi, type CopyRegistered, type CopyRegistrationBody, type Named } from "../api";
import { ANCHORS, anchorLabel, nameIn } from "./model";
import WhyDisabled from "../../shared/WhyDisabled";
import Identifiers from "../../shared/Identifiers";

type Entry = { destination: string; anchor: string; at: string; reference: string; reviewer: string; verified: boolean; people: string[] };
const EMPTY: Entry = { destination: "", anchor: "last_activity", at: "", reference: "", reviewer: "", verified: false, people: [] };
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * Registers a copy that was handed to somebody outside (an export, a printout's source):
 * choose the file, say whom it contains and where it went, confirm. The file is hashed in
 * this browser (SHA-256) and only that hash is sent; its content is never sent, stored or
 * logged. Registering erases nothing: the outside copy stays until its custodian confirms.
 */
export default function RegisterExternalCopy({ people }: { people: Named[] }) {
  const live = useLive();
  const api = governanceApi(live.client);
  const id = useId();
  const steps = useStepFocus<"content">();
  const picker = useRef<HTMLInputElement>(null);
  const hashing = useRef(0);
  // The identifier of the registration being prepared, with the request content (the body
  // without the identifier) it was made for.
  const identity = useRef<{ draft: string; copyId: string } | null>(null);
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [entry, setEntry] = useState<Entry>(EMPTY);
  const [body, setBody] = useState<CopyRegistrationBody | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const send = useConfirmedSend<CopyRegistrationBody, CopyRegistered, never>({
    name: "copy-register",
    send: (request, key) => api.registerCopy(live.scopeId, { ...request, idempotency_key: key }),
    // A new registration has no current version to compare with: a 409 is the server's refusal.
    readCurrent: () => Promise.reject(new Error("no current version")),
  });
  useUnsavedNavigation(Boolean(file) || JSON.stringify(entry) !== JSON.stringify(EMPTY));

  async function hash(chosen: File | undefined) {
    const generation = ++hashing.current;
    setFile(null); setFileProblem(null); setDone(null);
    if (!chosen) return;
    setFile({ name: chosen.name, hash: "" });
    try {
      const digest = hex(await crypto.subtle.digest("SHA-256", await chosen.arrayBuffer()));
      if (generation === hashing.current) setFile({ name: chosen.name, hash: digest });
    } catch {
      if (generation === hashing.current) { setFile(null); setFileProblem("ファイルのハッシュを計算できませんでした。ファイルを選び直してください。"); }
    }
  }
  function review() {
    if (!file?.hash || entry.people.length === 0) { setFileProblem("原本ファイルと、ファイルに含む対象職員を選んでください。"); return; }
    setFileProblem(null); setDone(null); send.clear();
    // What will be sent, but for the identifier.
    const content: Omit<CopyRegistrationBody["payload"], "copy_id"> = {
      category: "exports", medium: "external", relative_path: entry.destination, content_hash: file.hash, person_ids: entry.people,
      anchor: entry.anchor, anchor_at: entry.at, subject_status: entry.verified ? "VERIFIED" : "UNVERIFIED",
      evidence: { reference: entry.reference, status: entry.verified ? "verified" : "unverified", verified_by: entry.verified ? entry.reviewer : null },
    };
    // One identifier per draft, and a draft is the request it makes: confirming again what
    // builds the identical body sends it with the same identifier and the idempotency key
    // of the first attempt, so an attempt whose outcome is unknown is never registered a
    // second time. That holds when a field that is not sent was changed in between (the
    // reviewer of an unverified list, the name of a file with the same content). A changed
    // body is another registration, with an identifier of its own.
    const draft = JSON.stringify(content);
    if (identity.current?.draft !== draft) identity.current = { draft, copyId: crypto.randomUUID() };
    setBody({ expected_revision: 0, payload: { copy_id: identity.current.copyId, ...content } });
  }
  async function save() {
    if (!body) return;
    const result = await send.run(body);
    if (!result.done) return;
    setBody(null); setFile(null); setEntry(EMPTY);
    identity.current = null;
    if (picker.current) picker.current.value = "";
    setDone(`外部コピーの来歴を登録しました（第${result.result.revision}版）。外部の実物の消去を確認した状態ではありません。`);
    steps.moveTo("content");
  }

  return <div className="ideal-v3-record">
    <h3 className="ideal-v3-heading" {...steps.heading("content")}>1. 受け渡したファイルと受渡し先を入力する</h3>
    {!body && <form className="ideal-form" onSubmit={(event) => { event.preventDefault(); review(); }}>
      <p className="ideal-note">対象のファイルは、この端末でハッシュ（SHA-256）を計算します。ファイルの本文は送信しません。</p>
      <details className="ideal-v3-disclosure ideal-v3-disclosure--info"><summary>ここで登録するものと、自動で登録されるもの</summary>
        <p className="ideal-note">管理ファイルとバックアップは、作成の経路が自動で登録します。外部の印刷物や複製先も、処理の確認を記録するまでは残存として扱われます。</p>
      </details>
      <div>
        <label className="ideal-file"><FileUp aria-hidden="true" />受け渡した原本ファイル<input ref={picker} id={`${id}-file`} type="file" onChange={(event) => void hash(event.target.files?.[0])} /></label>
        <p className="ideal-note" role="status">{file ? <><span data-verbatim>{file.name}</span>{file.hash ? `：SHA-256 ${file.hash}` : "：ハッシュを計算しています。"}</> : "原本は選ばれていません。"}</p>
        {fileProblem && <p className="ideal-note" role="alert">{fileProblem}</p>}
      </div>
      <fieldset className="ideal-fieldset"><legend>ファイルに含む対象職員</legend>
        {people.map((person) => <CheckField key={person.person_id} label={person.name} checked={entry.people.includes(person.person_id)}
          onChange={(checked) => setEntry((old) => ({ ...old, people: checked ? [...old.people, person.person_id] : old.people.filter((item) => item !== person.person_id) }))} />)}
      </fieldset>
      <label htmlFor={`${id}-destination`}>受渡し先・管理場所</label>
      <input id={`${id}-destination`} className="ideal-input" required value={entry.destination} onChange={(event) => setEntry({ ...entry, destination: event.target.value })} />
      <label htmlFor={`${id}-anchor`}>保存期間の起算方式</label>
      <select id={`${id}-anchor`} className="ideal-input" value={entry.anchor} onChange={(event) => setEntry({ ...entry, anchor: event.target.value })}>
        {Object.entries(ANCHORS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
      <JstDateTimeField label="選んだ保存起算の日時（日本時間）" required value={entry.at} onChange={(at) => setEntry({ ...entry, at })} />
      <label htmlFor={`${id}-reference`}>人物一覧と受渡しの確認根拠</label>
      <input id={`${id}-reference`} className="ideal-input" required value={entry.reference} onChange={(event) => setEntry({ ...entry, reference: event.target.value })} />
      <label htmlFor={`${id}-reviewer`}>確認者</label>
      <input id={`${id}-reviewer`} className="ideal-input" required={entry.verified} value={entry.reviewer} onChange={(event) => setEntry({ ...entry, reviewer: event.target.value })} />
      <CheckField label="原本と全対象者・受渡し先を照合した" checked={entry.verified} onChange={(verified) => setEntry({ ...entry, verified })} />
      <div className="ideal-actions"><button type="submit" className="ideal-button ideal-button--primary" disabled={!file?.hash} aria-describedby={file ? undefined : `${id}-why`}>登録の内容を確認する</button></div>
      <WhyDisabled id={`${id}-why`}>{!file && "受け渡した原本ファイルを選ぶと押せます。"}</WhyDisabled>
    </form>}
    {body && <ConfirmSurface title="2. 登録前の確認"
      changes={[
        { label: "受け渡したファイル", before: "（なし）", after: `${file?.name ?? ""}（本文は送信せず、SHA-256だけを登録）`, verbatim: true },
        { label: "ファイルに含む対象職員", before: "（なし）", after: body.payload.person_ids.map((person) => nameIn(people, person)).join("、") },
        { label: "受渡し先・管理場所", before: "（なし）", after: body.payload.relative_path, verbatim: true },
        { label: "保存期間の起算", before: "（なし）", after: `${anchorLabel(body.payload.anchor)}・${jstText(body.payload.anchor_at)}` },
        { label: "対象者一覧の確認", before: "（なし）", after: body.payload.subject_status === "VERIFIED" ? `確認済み（確認者 ${body.payload.evidence.verified_by}）` : "未確認", verbatim: true },
        { label: "確認根拠", before: "（なし）", after: body.payload.evidence.reference, verbatim: true },
      ]}
      version={{ from: 0, to: 1 }}
      notified="誰にも通知されません。登録の記録（保存物・操作者・時刻）は監査の履歴に残ります。"
      risk="登録前の時点では検出されていません。登録時にサーバーが、対象職員に人物制御が適用されていないことを照合します。適用済みの職員を含む場合は登録せず、競合として知らせます。1件の外部コピーだけを登録するため、一部だけが登録されることはありません。"
      outcome={conflictOutcome(send.outcome, () => ({ currentRevision: null, rows: [] }))}
      busy={send.busy} confirmLabel="この内容で外部コピーを登録する"
      onConfirm={() => void save()} onBack={() => { setBody(null); send.clear(); steps.moveTo("content"); }} onReviewed={() => { setBody(null); send.clear(); }}>
      <Identifiers items={[{ label: "SHA-256", value: body.payload.content_hash }, { label: "保存物の識別子", value: body.payload.copy_id }]} />
    </ConfirmSurface>}
    <p className="ideal-done" role="status">{done ?? ""}</p>
  </div>;
}
