"use client";

import { useId, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { ActionStatus, useAction } from "@/ideal/live/parts";
import { useEnteredBeforeMount } from "../../shared/hydration";
import { useLive } from "../../shell/WorkspaceRuntime";

const LIMIT = 5 * 1024 * 1024;

/** Registers an input file as a new input version. The JSON is read in the browser first
 * and registered only after the confirmation; the server validates it. The chosen file's
 * name and content are the only state. */
export default function ImportInput({ revision }: { revision: number }) {
  const live = useLive();
  const id = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ name: string; snapshot: unknown } | null>(null);
  const action = useAction();
  const refuse = (message: string) => void action.run(async () => { throw new Error(message); });
  function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > LIMIT) { refuse("取込ファイルは5MB以内にしてください。"); return; }
    void file.text().then((text) => setPreview({ name: file.name, snapshot: JSON.parse(text) })).catch(() => refuse("JSONとして読めませんでした。"));
  }
  // A file chosen before React attached raised no event here.
  useEnteredBeforeMount(picker, (input) => choose((input as HTMLInputElement).files?.[0]));
  return <section className="ideal-panel" aria-labelledby={`${id}-import`}><h2 id={`${id}-import`}>入力ファイルの取込</h2><p>JSONをブラウザ内で先に読み、scope・期間・件数を確認してから登録します。</p>
    <label className="ideal-file"><FileUp aria-hidden="true" />JSONを選ぶ<input ref={picker} type="file" accept=".json,application/json" onChange={(event) => choose(event.target.files?.[0])} /></label>
    {preview && <div className="ideal-confirm"><h3>{preview.name}</h3><p>登録前の確認です。既存入力は上書きせず、新しい入力版を作ります。</p><button type="button" className="ideal-button ideal-button--primary" disabled={action.busy} onClick={() => void action.run(async () => {
      await live.client.registerInput(live.scopeId, { snapshot: preview.snapshot, expected_revision: revision });
      setPreview(null);
      await live.refresh();
      return "入力を登録しました。";
    })}>この内容で登録</button><button type="button" className="ideal-button ideal-button--secondary" onClick={() => setPreview(null)}>取り消す</button></div>}
    <ActionStatus problem={action.problem} done={action.done} />
  </section>;
}
