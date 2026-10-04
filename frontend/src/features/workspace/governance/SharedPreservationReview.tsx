"use client";
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';
import {useState} from 'react';
import {errorText} from '@/lib/errorText';
type Projection={copy_id:string;revision:number;source_digest:string;payload_hash:string;person_ids:string[];payload:{archive_format:string;replayable:false;retained:Record<string,unknown>;removed_counts:Record<string,number>}};
export default function SharedPreservationReview({copyId,personId,read,save,onChanged}:{copyId:string;personId:string;read:(path:string)=>Promise<Projection>;save:(path:string,payload:unknown,revision:number)=>Promise<unknown>;onChanged:()=>void}){
 const [dirty,setDirty]=useState(false);useUnsavedNavigation(dirty);
 const [projection,setProjection]=useState<Projection|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmed,setConfirmed]=useState(false);
 async function load(){if(dirty&&!window.confirm('未保存の保全確認を破棄して再取得しますか？'))return;setDirty(false);setProjection(null);setBusy(true);setError('');setConfirmed(false);try{setProjection(await read(`/copies/${encodeURIComponent(copyId)}/projection?person_id=${encodeURIComponent(personId)}`));}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 return <details><summary>共有記録を再構成して他の職員の履歴を保全</summary><p>この操作は消去の実行ではありません。保存する内容と自由記述を確認後、消去対象を再確認してください。再構成後は計算入力・公開版として再利用できません。</p>
 <button type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={()=>void load()}>保全する内容を読み込む</button>
 {projection&&<form className="space-y-3" onChange={()=>setDirty(true)} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');void save('/copies/review-preservation',{copy_id:copyId,person_id:personId,content_hash:projection.source_digest,projection_hash:projection.payload_hash,shared_text_reviewed:true,evidence:{reference:String(f.get('reference')),verified_by:String(f.get('reviewer')),status:'verified'}},projection.revision).then(()=>{setDirty(false);onChanged();}).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));}}>
 <p className="break-all">保全する職員：{projection.person_ids.join('、')}。新しい内容ハッシュ：{projection.payload_hash}</p>
 <ul>{Object.entries(projection.payload.removed_counts).filter(([,n])=>n>0).map(([k,n])=><li key={k}>{k}：除去 {n} 件</li>)}</ul>
 <details><summary>再構成後に保存する全内容を確認</summary><pre className="whitespace-pre-wrap break-all max-h-96 overflow-auto border rounded-control p-3" tabIndex={0}>{JSON.stringify(projection.payload.retained,null,2)}</pre></details>
 <label className="block">保全・消去判断の根拠<input name="reference" required className="ui-control block w-full"/></label>
 <label className="block">確認者<input name="reviewer" required className="ui-control block w-full"/></label>
 <label className="flex gap-2 items-start"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="ui-choice size-6 shrink-0"/>他の職員の必要な情報が保持され、自由記述・共通情報にも消去対象者の情報が残らないことを、この内容で確認した</label>
 <button className="ui-button ui-button-secondary" disabled={busy||!confirmed}>この内容の保全判断を記録</button></form>}
 {error&&<p role="alert">{error}</p>}{busy&&<p role="status">処理中…</p>}</details>;
}
