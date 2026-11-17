"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';
import ConflictTable from '@/features/workspace/shared/ConflictTable';
import {Button} from '@/components/ui/Button';
import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
type Piece={start:string;end:string};
type Declaration={declaration_id:string;person_id:string;employer_id:string;establishment_id:string;contract_order:number|null;activity:string;start:string;end:string;reference:string;status:string;work_report_complete:boolean;scheduled_work:Piece[];additional_work:Piece[];other_holiday_work?:Piece[];review_evidence:unknown};
type Row={entity_id:string;revision:number;payload:Declaration;kind:string};
const local=(value?:string)=>value?new Date(new Date(value).getTime()+9*3600000).toISOString().slice(0,19):'';
const instant=(value:string)=>new Date(value+'+09:00').toISOString();
const labels:Record<string,string>={SUBMITTED:'照合待ち',REVIEWED:'確認済み',RETURNED:'再確認',WITHDRAWN:'取下げ済み'};
const fieldLabels:Record<string,string>={declaration_id:'申告ID',person_id:'本人',employer_id:'他社の雇用主',establishment_id:'他社の事業場',contract_order:'契約の順序',activity:'就業の種類',start:'申告の開始',end:'申告の終了',work_report_complete:'実績報告の完了',reference:'申告の参照',status:'状態',valid_until:'照合の有効期限','review_evidence.reference':'照合根拠','review_evidence.status':'照合根拠の状態','review_evidence.verified_by':'照合した人','review_evidence.valid_until':'照合の有効期限'};
function JapaneseDateTime({name,label,initial,required=false}:{name:string;label:string;initial?:string;required?:boolean}){
 const [value,setValue]=useState(()=>local(initial));
 const displayValue=value.replace(/\.0+$/,'');
 const displayed=displayValue?(displayValue.length===16?displayValue+':00':displayValue).replace('T',' ')+'（日本時間）':'未入力';
 return <div className="min-w-0 space-y-1"><label className="block">{label}<input name={name} type="datetime-local" step="1" required={required} value={value} onChange={e=>setValue(e.target.value)} className="ui-control block w-full min-w-0 max-w-full"/></label><p data-current-for={name} className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere] text-sm">現在値：{displayed}</p></div>;
}

// Declared hours grouped by Japan-time week (Monday start) and month, for the
// administrator's comparison with the other employer's records.
export function summarize(pieces:Piece[]){
 const byWeek=new Map<string,number>(),byMonth=new Map<string,number>();
 for(const p of pieces){const start=new Date(p.start),end=new Date(p.end);const seconds=Math.max(0,(end.getTime()-start.getTime())/1000);
  const jst=new Date(start.getTime()+9*3600000);const day=jst.getUTCDay();const monday=new Date(jst.getTime()-((day+6)%7)*86400000);
  const week=monday.toISOString().slice(0,10),month=jst.toISOString().slice(0,7);
  byWeek.set(week,(byWeek.get(week)??0)+seconds);byMonth.set(month,(byMonth.get(month)??0)+seconds);}
 return {weeks:Array.from(byWeek.entries()).sort(),months:Array.from(byMonth.entries()).sort()};
}
const hours=(seconds:number)=>`${Math.floor(seconds/3600)}時間${Math.round(seconds%3600/60)}分`;
function Reconciliation({declaration}:{declaration:Declaration}){
 const scheduled=summarize(declaration.scheduled_work),extra=summarize([...declaration.additional_work,...(declaration.other_holiday_work??[])]),holiday=summarize(declaration.other_holiday_work??[]);
 const evidence=declaration.review_evidence as {reference?:string;verified_by?:string;valid_until?:string|null}|null;
 const table=(title:string,rows:[string,number][])=><table className="ui-data-table border text-sm"><caption className="text-left">{title}</caption><tbody>{rows.length?rows.map(([k,v],index)=><tr key={`${k}-${index}`}><th className="border px-2 text-left">{k}</th><td className="border px-2">{hours(v)}</td></tr>):<tr><td className="border px-2">記載なし</td></tr>}</tbody></table>;
 return <section aria-label="他社勤務の照合用集計" className="workflow-panel border p-3 space-y-2"><h3>照合用の集計（申告内容）</h3>
  <p>契約締結順：{declaration.contract_order??'未記載（通算の割当ができないため未確認として扱います）'}／区分：{declaration.activity==='employment'?'雇用':'非雇用活動（労働時間に通算しません）'}／状態：{labels[declaration.status]??declaration.status}</p>
  <div className="flex flex-wrap gap-3">{table('所定・週別（月曜始まり）',scheduled.weeks)}{table('所定外・週別（月曜始まり）',extra.weeks)}{table('所定・月別',scheduled.months)}{table('所定外・月別',extra.months)}{table('うち他社の法定休日の労働・週別',holiday.weeks)}{table('うち他社の法定休日の労働・月別',holiday.months)}</div>
  <p>照合根拠：{evidence?.reference??'未記録'}／照合担当者：{evidence?.verified_by??'未記録'}／確認の有効期限：{evidence?.valid_until??'期限なし'}</p>
  <p>照合済みの申告だけが、自社の労働時間と通算されます。照合待ち・再確認の申告があると、その職員の通算結果は未確認になり公開できません。</p></section>;
}

export default function OutsideDeclarationForm({scope,personId,admin=false}:{scope:string;personId:string;admin?:boolean}){
 const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState<Row|null>(null),[loaded,setLoaded]=useState(false),[epoch,setEpoch]=useState(0);
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [conflict,setConflict]=useState<{base:Row|null;current:Row;proposed:Declaration}|null>(null);
 const [reviewDirty,setReviewDirty]=useState(false);
 const [scheduled,setScheduled]=useState(1),[extra,setExtra]=useState(1),[holiday,setHoliday]=useState(1);
 const [candidates,setCandidates]=useState<{employers:{employer_id:string;name:string}[];establishments:{establishment_id:string;employer_id:string;name?:string}[]}>({employers:[],establishments:[]});
 const [employer,setEmployer]=useState('');const declarationId=useRef<string>('');
 const retry=useRef<{body:string;key:string}|null>(null);
 const load=useCallback(async()=>{const r=await fetch(`${API}/planning/compliance/declaration-context?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store'});if(!r.ok)throw new Error('申告の候補と現在版を取得できません。');const context=await r.json();setCandidates(context);setRows(context.declarations);setLoaded(true);if(!declarationId.current)declarationId.current=crypto.randomUUID();return context.declarations as Row[];},[scope]);
 useEffect(()=>{void load().catch(e=>setError(errorText(e)));},[load]);
 useUnsavedNavigation(dirty||reviewDirty);
 function choose(row:Row|null){declarationId.current=row?.entity_id??crypto.randomUUID();setEmployer(row?.payload.employer_id??'');setSelected(row);setScheduled(Math.max(1,row?.payload.scheduled_work.length??1));setExtra(Math.max(1,row?.payload.additional_work.length??1));setHoliday(Math.max(1,row?.payload.other_holiday_work?.length??1));setDirty(false);setReviewDirty(false);setConflict(null);setError('');setEpoch(n=>n+1);retry.current=null;}
 async function save(payload:Declaration,base=selected){setBusy(true);setError('');setMessage('');const serialized=JSON.stringify({payload,expected_revision:base?.revision??0});if(retry.current?.body!==serialized)retry.current={body:serialized,key:crypto.randomUUID()};try{
   const response=await fetch(`${API}/planning/compliance/outside-declarations?scope_id=${encodeURIComponent(scope)}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(serialized),idempotency_key:retry.current.key})});
   if(response.status===409){const current=(await load()).find(r=>r.entity_id===payload.declaration_id);if(current)setConflict({base,current,proposed:payload});throw new Error('申告が別の操作で更新されています。差分を確認してください。');}
   if(!response.ok)throw new Error('申告を保存できませんでした。入力と権限を確認してください。');
   const result=await response.json();const current=(await load()).find(r=>r.entity_id===payload.declaration_id);choose(current??null);setMessage(`申告を記録しました（版 ${result.revision}、${labels[result.status]??result.status}）。`);window.dispatchEvent(new Event('planning-records-changed'));
 }catch(e){setError(errorText(e));}finally{setBusy(false);}}
 const item=selected?.payload;
 function workFields(prefix:string,count:number,setCount:(n:number)=>void,pieces:Piece[]){const name=prefix==='scheduled'?'所定':prefix==='holiday'?'他社の法定休日の':'所定外';return <fieldset className="workflow-fieldset border space-y-2 min-w-0 w-full"><legend>{name}労働区間（日本時間）</legend>{prefix==='holiday'&&<p>他社の法定休日に働いた区間です。こちらでは休日労働ではなく、他社の所定外労働として通算します（副業・兼業ガイドラインQ&A 問1-4-2）。</p>}{Array.from({length:count},(_,i)=><div key={i} className="min-w-0"><JapaneseDateTime name={`${prefix}Start${i}`} label={`${name}労働の開始 ${i+1}`} initial={pieces[i]?.start}/><JapaneseDateTime name={`${prefix}End${i}`} label={`${name}労働の終了 ${i+1}`} initial={pieces[i]?.end}/></div>)}<button type="button" className="ui-button ui-button-secondary" onClick={()=>{setCount(count+1);setDirty(true);}}>区間を追加</button><p>区間を取り除く場合は開始・終了を両方空欄にしてください。</p></fieldset>;}
 return <section className="space-y-3" aria-labelledby="outside-heading"><h2 id="outside-heading" className="text-xl font-semibold">本人の兼業・非雇用活動を申告または訂正</h2><p>申告と照合判断を分けて記録します。非雇用活動を法定労働時間へ自動合算しません。</p>
 {!loaded?<p role="status">申告を読み込み中…</p>:<><label className="block">訂正・取下げする申告<select className="ui-control block max-w-full" disabled={busy||dirty||reviewDirty} value={selected?.entity_id??''} onChange={e=>choose(rows.find(r=>r.entity_id===e.target.value)??null)}><option value="">新しい申告</option>{rows.map(r=><option key={r.entity_id} value={r.entity_id}>{r.payload.person_id}：{r.entity_id}（{labels[r.payload.status]}・版{r.revision}）</option>)}</select></label><p>取得した現在版：{selected?.revision??0}</p>
 <form key={`declaration-${epoch}`} className="space-y-3" onChange={()=>setDirty(true)} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{
 const pieces=(prefix:string,count:number)=>Array.from({length:count},(_,i)=>{const start=String(f.get(`${prefix}Start${i}`)??''),end=String(f.get(`${prefix}End${i}`)??'');if(Boolean(start)!==Boolean(end))throw new Error('区間の開始・終了を両方入力してください。');return start?{start:instant(start),end:instant(end)}:null;}).filter((p):p is Piece=>p!==null);
 const payload:Declaration={declaration_id:item?.declaration_id??declarationId.current,person_id:item?.person_id??personId,employer_id:String(f.get('employer')),establishment_id:String(f.get('site')),contract_order:f.get('order')?Number(f.get('order')):null,activity:String(f.get('activity')),start:instant(String(f.get('start'))),end:instant(String(f.get('end'))),reference:String(f.get('reference')),status:'SUBMITTED',review_evidence:null,work_report_complete:f.get('complete')==='on',scheduled_work:pieces('scheduled',scheduled),additional_work:pieces('extra',extra),other_holiday_work:pieces('holiday',holiday)};void save(payload);
 }catch(e){setError(errorText(e));}}}>
 <p>申告の識別子と現在版は自動管理します。候補にない勤務先は管理者による雇用主・事業場の登録が必要です。</p>
 <label className="block">他の雇用主・活動先<select name="employer" required value={employer} onChange={e=>setEmployer(e.target.value)} className="ui-control block w-full"><option value="">選択してください</option>{candidates.employers.map(c=><option key={c.employer_id} value={c.employer_id}>{c.name}</option>)}</select></label>
 <label className="block">申告する事業場<select key={employer} name="site" required defaultValue={item?.employer_id===employer?item?.establishment_id:''} className="ui-control block w-full"><option value="">選択してください</option>{candidates.establishments.filter(c=>c.employer_id===employer).map(c=><option key={c.establishment_id} value={c.establishment_id}>{c.name??c.establishment_id}</option>)}</select></label>
 <button type="button" className="ui-button ui-button-secondary" onClick={()=>void load().catch(e=>setError(errorText(e)))}>勤務先候補を再取得</button>
 <label className="block">活動の区分<select name="activity" defaultValue={item?.activity??'employment'} className="ui-control block"><option value="employment">雇用</option><option value="nonemployment">非雇用活動</option></select></label><label className="block">契約締結順（不明の場合は空欄）<input name="order" type="number" min="1" defaultValue={item?.contract_order??''} className="ui-control block w-full min-w-0 max-w-full"/></label>
 <JapaneseDateTime name="start" label="適用開始（日本時間）" required initial={item?.start}/><JapaneseDateTime name="end" label="適用終了（日本時間）" required initial={item?.end}/>
 {workFields('scheduled',scheduled,setScheduled,item?.scheduled_work??[])}{workFields('extra',extra,setExtra,item?.additional_work??[])}{workFields('holiday',holiday,setHoliday,item?.other_holiday_work??[])}
 <label className="block"><input className="ui-choice" type="checkbox" name="complete" defaultChecked={item?.work_report_complete}/>この期間の労働区間をすべて記載した</label><label className="block">契約・所定時間・所定外時間の照合資料<textarea name="reference" required maxLength={2000} defaultValue={item?.reference} className="ui-control block w-full"/></label>
 <div className="flex flex-wrap gap-2"><Button type="submit" className="h-auto min-h-10 whitespace-normal text-base" disabled={busy||!!conflict||reviewDirty||(!admin&&item?.status==='REVIEWED')}>申告・訂正を記録</Button><Button variant="outline" className="h-auto min-h-10 whitespace-normal text-base" type="button" disabled={busy} onClick={()=>{if((!dirty&&!reviewDirty)||window.confirm('未保存の変更を破棄しますか？'))choose(selected);}}>未保存の編集を破棄</Button></div></form>
 {item&&item.status!=='WITHDRAWN'&&(admin||item.status!=='REVIEWED')&&<button className="ui-button ui-button-secondary" disabled={busy||dirty||reviewDirty} onClick={()=>void save({...item,status:'WITHDRAWN',review_evidence:null})}>この申告を取り下げる</button>}
 {item&&!admin&&item.status==='REVIEWED'&&<p>照合済みの申告は本人では変更・取り下げできません。副業を終えた場合など、適用終了の訂正は管理者に依頼してください（照合済みの時間は、訂正されるまで通算に残ります）。</p>}
 {admin&&item&&item.status!=='WITHDRAWN'&&<form key={`review-${epoch}`} className="border p-3 space-y-2" onChange={()=>setReviewDirty(true)} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void save({...item,status:String(f.get('status')),review_evidence:{reference:String(f.get('reference')),verified_by:null,status:'verified',valid_until:f.get('validUntil')?instant(String(f.get('validUntil'))):null}});}}><h3 className="text-lg font-semibold">管理者による他社資料との照合判断</h3><Reconciliation declaration={item}/><label className="block">判断<select name="status" className="ui-control block"><option value="REVIEWED">照合済み</option><option value="RETURNED">再確認を依頼</option></select></label><label className="block">照合根拠<input name="reference" required className="ui-control block w-full"/></label><p>照合担当者：ログイン中の管理者アカウントとして、サーバーが記録します。</p><JapaneseDateTime name="validUntil" label="照合の有効期限（空欄なら期限なし）"/><Button type="submit" className="h-auto min-h-10 whitespace-normal text-base" disabled={busy||dirty||!!conflict}>照合判断を記録</Button></form>}
 </>}
 {conflict&&<section className="workflow-panel border p-3"><h3>競合した内容の比較</h3><p>編集開始時：版 {conflict.base?.revision??0}／現在：版 {conflict.current.revision}</p><ConflictTable base={conflict.base?.payload} current={conflict.current.payload} proposed={conflict.proposed} labels={fieldLabels}/><button className="ui-button ui-button-secondary" disabled={busy} onClick={()=>{const value=conflict;setConflict(null);void save(value.proposed,value.current);}}>差分を確認して編集中の内容を適用</button><button className="ui-button ui-button-secondary" disabled={busy} onClick={()=>choose(conflict.current)}>編集を破棄して現在版を開く</button></section>}
 {(dirty||reviewDirty)&&<p role="status">未保存の申告・照合判断があります。</p>}{busy&&<p role="status">保存中…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
