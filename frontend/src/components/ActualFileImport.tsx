'use client';
import {useRef,useState} from 'react';
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';
import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
type Preview={source_hash:string;preview_hash:string;rows:{row:number;external_id:string;expected_revision:number;person_id:string;start:string;end:string}[]};
type RowError={row:number;code:string;message:string};

export default function ActualFileImport({scope,onImported}:{scope:string;onImported:()=>Promise<void>}){
  const [source,setSource]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false);
  const retry=useRef<{body:string;key:string}|null>(null);
  const [rowErrors,setRowErrors]=useState<RowError[]>([]);
  useUnsavedNavigation(dirty);
  async function request(path:string,body:unknown){
    const r=await fetch(`${API}/planning/compliance/actual-import/${path}?scope_id=${encodeURIComponent(scope)}`,{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(r.status===409){setPreview(null);retry.current=null;throw new Error('保存済みの内容が変更されました。原本の確認をやり直してください。');}
    if(!r.ok){const error=await r.json();setRowErrors(error.detail?.row_errors??[]);throw new Error(typeof error.detail==='string'?error.detail:error.detail?.message??'形式・時刻・所定区分・権限を確認してください。');}
    return r.json();
  }
  async function inspect(){setBusy(true);setMessage('');setPreview(null);setRowErrors([]);try{setPreview(await request('preview',{source_text:source}));setMessage('プレビューのみです。まだ実績は保存されていません。');}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
  async function commit(){if(!preview)return;setBusy(true);try{
    const payload={source_text:source,preview_hash:preview.preview_hash},body=JSON.stringify(payload);
    if(retry.current?.body!==body)retry.current={body,key:crypto.randomUUID()};
    const saved=await request('commit',{expected_revision:0,idempotency_key:retry.current.key,payload});
    await onImported();
    setMessage(`${saved.count}件を保存しました。原本SHA-256：${saved.source_hash}`);setDirty(false);setPreview(null);setSource('');retry.current=null;
  }catch(e){setMessage(errorText(e)+' 通信断の場合は同じ原本のまま再送できます。');}finally{setBusy(false);}}
  return <section className="workflow-panel min-w-0 border p-3 space-y-3" aria-labelledby="actual-import-title"><h3 id="actual-import-title" className="font-semibold">実績原本のファイル取込</h3>
    <p>アプリ実績APIのJSON形式（pharmshift-actuals-v1、UTF-8、2MB・500件以内）を取り込みます。所定内外区分と原本改定番号が必要です。他社独自形式は推測変換しません。</p>
    <label className="block">実績原本ファイル<input className="ui-control block w-full min-w-0" type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{
      const file=e.target.files?.[0];if(!file)return;
      if(dirty&&!window.confirm('未保存の原本を破棄して別ファイルへ切り替えますか？')){e.target.value='';return;}
      setPreview(null);setRowErrors([]);retry.current=null;setSource('');setDirty(false);
      if(file.size>2_000_000){setMessage('原本は2MB以内にしてください。');return;}
      try{const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());setSource(text);setDirty(true);setMessage('原本のプレビューを実行してください。');}catch{setMessage('UTF-8の原本を読み込めませんでした。');}
    }}/></label>
    <button type="button" className="ui-button ui-button-secondary" disabled={busy||!source} onClick={inspect}>原本と保存済み実績を照合</button>
    {rowErrors.length>0&&<div role="alert"><p>保存していません。次の行を修正してください。</p><ul aria-label="実績原本の行別エラー">{rowErrors.map((e,i)=><li key={`${e.row}-${e.code}-${i}`}>{e.row}行目：{e.message}</li>)}</ul></div>}
    {preview&&<><p className="break-all">原本SHA-256：{preview.source_hash}</p><ul className="space-y-2" aria-label="実績取込プレビュー">{preview.rows.map(r=><li className="break-words" key={r.row}>{r.row}行目・原本 {r.external_id}：第{r.expected_revision}版 → 第{r.expected_revision+1}版、{r.start} ～ {r.end}</li>)}</ul><button type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={commit}>全件の差分を確認して保存・再送</button></>}
    {dirty&&<button type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={()=>{if(window.confirm('未保存の取込内容を破棄しますか？')){setSource('');setPreview(null);setDirty(false);retry.current=null;}}}>未保存の取込を破棄</button>}
    {(busy||message)&&<p role="status" className="break-words">{busy?'処理中… ':''}{message}</p>}
  </section>;
}
