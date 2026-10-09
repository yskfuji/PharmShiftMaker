'use client';
import {useId,useRef,useState} from 'react';
import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
type Artifact={copy_id:string;revision:number;content_hash:string};
type Attempt={format:string;prepareKey:string;downloadKey:string;artifact?:Artifact};

export default function PublicationExport({scope,publication,version}:{scope:string;publication:string;version:number}){
 const [format,setFormat]=useState('json'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const formatHelpId=useId();
 const attempt=useRef<Attempt|null>(null);
 const query=`?scope_id=${encodeURIComponent(scope)}`;
 async function post(path:string,body:unknown){
  const r=await fetch(`${API}/planning${path}${query}`,{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){if(r.status===409)attempt.current=null;throw new Error(r.status===409?'保存版・消去状態が変わりました。内容を再確認してください。':`出力を完了できませんでした（${r.status}）。`);}
  return r;
 }
 async function download(){
  setBusy(true);setMessage('');
  try{
   if(!attempt.current||attempt.current.format!==format)attempt.current={format,prepareKey:crypto.randomUUID(),downloadKey:crypto.randomUUID()};
   const current=attempt.current;
   if(!current.artifact)current.artifact=await(await post(`/publications/${publication}/artifacts`,{expected_revision:version,idempotency_key:current.prepareKey,format})).json() as Artifact;
   const artifact=current.artifact;
   const r=await post(`/artifacts/${artifact.copy_id}/download`,{expected_revision:artifact.revision,idempotency_key:current.downloadKey,destination:'browser-download'});
   const bytes=await r.arrayBuffer();
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   const transfer=r.headers.get('X-Transfer-ID');
   if(!transfer||hash!==artifact.content_hash)throw new Error('受渡し記録または内容ハッシュが一致しないため保存を停止しました。');
   const url=URL.createObjectURL(new Blob([bytes],{type:r.headers.get('content-type')??'application/octet-stream'}));
   const link=document.createElement('a');link.href=url;link.download=`schedule-${publication}.${format==='json'?'json':'csv'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setMessage(`受渡し記録：${transfer}。ダウンロード先の消去確認は未確認です。`);attempt.current=null;
  }catch(e){setMessage(`${errorText(e)} 通信断の場合は同じ形式で再送できます。`);}finally{setBusy(false);}
 }
 return <section className="workflow-panel space-y-2" aria-label="公開版の登録済み出力">
  <label className="block">出力形式<select className="ui-control block" aria-describedby={formatHelpId} value={format} disabled={busy} onChange={e=>{setFormat(e.target.value);attempt.current=null;setMessage('');}}><option value="json">JSON（機械連携）</option><option value="csv">CSV（勤務区間）</option><option value="csv-wide">CSV（日別一覧）</option></select></label>
  <p id={formatHelpId}>JSONは元IDを保持します。CSVは人が確認する勤務区間または日別一覧です。</p>
  <button type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={download}>{busy?'出力を確認中…':'この公開版を出力'}</button>
  <p>管理領域で検証し、受渡し先を記録してから保存します。CSVは表計算での閲覧用です。</p>
  {message&&<p role="status" className="break-all">{message}</p>}
 </section>;
}
