"use client";

import { useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { ActionStatus, useAction } from "@/ideal/live/parts";
import { useEnteredBeforeMount } from "../../shared/hydration";
import { useLive } from "../../shell/WorkspaceRuntime";

const LIMIT = 5 * 1024 * 1024;

/** Registers an input file as a new input version. The JSON is read in the browser first
 * and registered only after the confirmation; the server validates it. The chosen file's
 * name and content are the only state.
 *
 * A file this browser turns away (too large, or not JSON) was never sent: that is said as
 * a refusal of the file, with nothing registered. It is not a failed change, so it does not
 * go through the action's problem, which would call it an unknown outcome. A refused file
 * also ends the confirmation of the file chosen before it, so that the confirmation never
 * names a file other than the one in the picker. */
export default function ImportInput({ revision }: { revision: number }) {
  const live = useLive();
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ name: string; snapshot: unknown } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const action = useAction();
  // Each choice has a number: a file still being read when another is chosen is dropped
  // when its reading ends, so the confirmation and the refusal are of the last choice only.
  const choice = useRef(0);
  const refuse = (message: string) => { setPreview(null); setRefused(message); };
  function choose(file: File | undefined) {
    if (!file) return;
    const mine = ++choice.current;
    action.clear(); setRefused(null);
    if (file.size > LIMIT) { refuse("取込ファイルは5MB以内にしてください。"); return; }
    setPreview(null);
    void file.text().then((text) => JSON.parse(text) as unknown).then(
      (snapshot) => { if (mine === choice.current) setPreview({ name: file.name, snapshot }); },
      () => { if (mine === choice.current) refuse("JSONとして読めませんでした。"); },
    );
  }
  // A file chosen before React attached raised no event here.
  useEnteredBeforeMount(picker, (input) => choose((input as HTMLInputElement).files?.[0]));
  return <section className="ideal-panel" aria-labelledby={`${id}-import`}><h2 id={`${id}-import`}>入力ファイルの取込</h2><p>JSONファイルをこのブラウザーで先に読み込み、ファイル名を確かめてから登録します。内容はサーバーが検証します。</p>
    <label className="ideal-file"><FileUp aria-hidden="true" />JSONを選ぶ<input ref={picker} type="file" accept=".json,application/json" onChange={(event) => choose(event.target.files?.[0])} /></label>
    {preview && <div className="ideal-confirm"><span className="ideal-eyebrow">登録するファイル</span><h3 data-verbatim>{preview.name}</h3>
      <dl className="ideal-definition-list"><div><dt>もとにする入力版</dt><dd>入力版 第{revision}版（登録時に、この版のままであることをサーバーが確かめます）</dd></div></dl>
      <p>登録前の確認です。既存入力は上書きせず、新しい入力版を作ります。</p><div className="ideal-actions"><button type="button" className="ideal-button ideal-button--primary" disabled={action.busy} onClick={() => void action.run(async () => {
      await live.client.registerInput(live.scopeId, { snapshot: preview.snapshot, expected_revision: revision });
      setPreview(null);
      await live.refresh();
      return "入力を登録しました。";
    })}>この内容で登録</button><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setPreview(null)}>取り消す</button></div></div>}
    {refused && <p className="ideal-v3-callout ideal-v3-callout--warn" role="alert">このファイルは登録していません。{refused}</p>}
    <ActionStatus problem={action.problem} done={action.done} />
  </section>;
}
