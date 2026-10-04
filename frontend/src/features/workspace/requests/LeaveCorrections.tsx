"use client";
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';
import {useEffect, useRef, useState} from 'react';
import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
type Row={kind:string;entity_id:string;revision:number;payload:Record<string,unknown>};
type Props={scope:string;rows:Row[];onChanged:()=>void};
const unitNames:Record<string,string>={day:'日',half_day:'半日',hour:'時間'};
export default function LeaveCorrections({scope,rows,onChanged}:Props){
 const [mode,setMode]=useState('grant'),[identity,setIdentity]=useState(''),[action,setAction]=useState('replace');
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [baseline,setBaseline]=useState('');
 const fingerprint=(id:string)=>JSON.stringify(rows.filter(r=>r.entity_id===id || r.payload.object_id===id || r.payload.account_id===id || r.payload.event_id===id));
 const retry=useRef<{body:string;key:string;id:string}|null>(null);
 const selected=rows.find(r=>r.kind===(mode==='grant'?'leave_account':'leave_record')&&r.entity_id===identity);
 const recording=rows.find(r=>r.kind==='ledger_recording'&&r.payload.object_kind===(mode==='grant'?'leave_account':'leave_record')&&r.payload.object_id===identity);
 const corrections=rows.filter(r=>r.kind===(mode==='grant'?'grant_amendment':'leave_amendment')&&r.payload[mode==='grant'?'account_id':'event_id']===identity).sort((a,b)=>Number(a.payload.external_revision)-Number(b.payload.external_revision));
 const previous=corrections.at(-1)?.payload;
 const sourceRevision=Number(previous?.external_revision??recording?.payload.external_revision??0);
 const sourceEvent=previous?.external_event_id??recording?.payload.external_event_id;
 const account=mode==='grant'?selected:rows.find(r=>r.kind==='leave_account'&&r.entity_id===selected?.payload.account_id);
 useUnsavedNavigation(dirty);
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 const input='block max-w-full w-full';
 return <details><summary>人事原本と照合して年休の付与・取得を訂正</summary>
 <p>原本を上書きせず、外部イベントの次の改定を追加します。取得の取消には人事確認の根拠が必要です。自動的な欠勤への振替は行いません。</p>
 <label className="block">訂正の種類<select className={"ui-control "+(input)} value={mode} disabled={dirty||busy} onChange={e=>{setMode(e.target.value);setIdentity('');setError('');setMessage('');}}><option value="grant">付与日数の訂正</option><option value="event">取得・予約等の記録訂正</option></select></label>
 <label className="block">訂正する原本<select className={"ui-control "+(input)} value={identity} disabled={dirty||busy} onChange={e=>{setIdentity(e.target.value);setBaseline(fingerprint(e.target.value));setAction('replace');setError('');setMessage('');}}><option value="">選択してください</option>{rows.filter(r=>r.kind===(mode==='grant'?'leave_account':'leave_record')).map(r=><option key={r.entity_id} value={r.entity_id}>{r.entity_id}（{String(r.payload.person_id??r.payload.account_id)}）</option>)}</select></label>
 {selected&&<form key={mode+identity} className="space-y-3 mt-3" onChange={()=>setDirty(true)} onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);if(baseline!==fingerprint(identity)){setError('選択後に原本または訂正履歴が変わりました。未保存の訂正を破棄し、最新の原本を選び直してください。');return;}if(!recording||!sourceEvent||!account){setError('元記録の外部ID・改定番号・人物を照合できません。先に原本記録を確認してください。');return;}
 const evidence={reference:String(form.get('reference')),status:'verified',verified_by:String(form.get('verifier'))};
 const common={person_id:account.payload.person_id,external_event_id:sourceEvent,external_revision:sourceRevision+1,supersedes_revision:sourceRevision,recorded_at:String(form.get('recorded'))+':00+09:00',reason:form.get('reason'),evidence};
 const interval={start:String(form.get('start'))+':00+09:00',end:String(form.get('end'))+':00+09:00'};
 const payload=mode==='grant'?{...common,account_id:identity,effective_on:form.get('effective'),granted_days:Number(form.get('days')),statutory_days:Number(form.get('statutory'))}:{...common,event_id:identity,replacement:action==='cancel'?null:{...selected.payload,unit:form.get('unit'),quantity:Number(form.get('quantity')),effective_on:form.get('effective'),interval,evidence}};
 const serialized=JSON.stringify(payload);if(retry.current?.body!==serialized)retry.current={body:serialized,key:crypto.randomUUID(),id:crypto.randomUUID()};setBusy(true);setError('');setMessage('');
 try{const response=await fetch(`${API}/planning/compliance/${mode==='grant'?'grant-amendments':'leave-amendments'}?scope_id=${encodeURIComponent(scope)}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:0,idempotency_key:retry.current.key,payload:{...payload,amendment_id:retry.current.id}})});const result=await response.json();if(!response.ok)throw new Error(response.status===409?'競合しました。原本の最新改定を読み直して照合してください。':`記録されていません：${typeof result.detail==='string'?result.detail:'対象・日付・元記録の改定順を確認してください。'}`);setDirty(false);setMessage(result.requires_hr_reconciliation?'訂正を記録しました。残高または関連記録に未解消の差異があり、人事照合が必要です。':'訂正を記録しました。過去時点の台帳で訂正前後を確認してください。');onChanged();}catch(e){setError(errorText(e));}finally{setBusy(false);}}}>
 <p>外部原本：{String(sourceEvent??'未確認')} ／ 現在の外部改定 {sourceRevision} → {sourceRevision+1}</p>
 {mode==='grant'?<><p>元の付与：{String(selected.payload.granted_days)}日。最新訂正：{String(previous?.granted_days??selected.payload.granted_days)}日</p>
 <label className="block">訂正の効力日<input name="effective" type="date" required className={"ui-control "+(input)} defaultValue={String(selected.payload.granted_on)}/></label>
 <label className="block">訂正後の付与日数<input name="days" type="number" min="0" required className={"ui-control "+(input)} defaultValue={Number(previous?.granted_days??selected.payload.granted_days)}/></label>
 <label className="block">そのうち法定付与日数<input name="statutory" type="number" min="0" required className={"ui-control "+(input)} defaultValue={Number(previous?.statutory_days??selected.payload.statutory_days)}/></label></>:<>
 <p>元記録：{String(selected.payload.kind)}、{String(selected.payload.quantity)} {unitNames[String(selected.payload.unit)]}、{String(selected.payload.effective_on)}</p>
 <label className="block">訂正方法<select value={action} onChange={e=>setAction(e.target.value)} className={"ui-control "+(input)}><option value="replace">日付・単位・区間を訂正</option><option value="cancel">人事確認に基づき元記録を取消</option></select></label>
 {action==='replace'&&<><label className="block">訂正後の対象日<input name="effective" type="date" required className={"ui-control "+(input)} defaultValue={String(selected.payload.effective_on)}/></label>
 <label className="block">訂正後の取得単位<select name="unit" defaultValue={String(selected.payload.unit)} className={"ui-control "+(input)}><option value="day">日</option><option value="half_day">半日</option><option value="hour">時間</option></select></label>
 <label className="block">訂正後の数量（日・半日は1）<input name="quantity" type="number" min="1" required className={"ui-control "+(input)} defaultValue={Number(selected.payload.quantity)}/></label>
 <label className="block">訂正後の開始（日本時間）<input name="start" type="datetime-local" required className={"ui-control "+(input)}/></label>
 <label className="block">訂正後の終了（日本時間）<input name="end" type="datetime-local" required className={"ui-control "+(input)}/></label></>}</>}
 <label className="block">訂正を把握した日時（日本時間）<input name="recorded" type="datetime-local" required className={"ui-control "+(input)}/></label>
 <label className="block">訂正理由<textarea name="reason" required className={"ui-control "+(input)}/></label>
 <label className="block">照合した人事資料の参照<input name="reference" required className={"ui-control "+(input)}/></label>
 <label className="block">根拠の確認者<input name="verifier" required className={"ui-control "+(input)}/></label>
 <button className="ui-button ui-button-secondary" disabled={busy||!recording}>原本を保持して訂正を記録</button>
 <button className="ui-button ui-button-secondary" type="button" disabled={busy} onClick={()=>{setIdentity('');setDirty(false);retry.current=null;}}>未保存の訂正を破棄</button>
 </form>}
 {dirty&&<p role="status">未保存の訂正があります。</p>}{busy&&<p role="status">訂正を記録中…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </details>;
}
