"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';
import ActualFileImport from '@/features/workspace/governance/ActualFileImport';

import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
type Interval={start:string;end:string};
type Duty=Interval&{duty_id:string;person_id:string;relationship_id:string;work:Interval[];breaks:Interval[];source:string;[key:string]:unknown};
type Actual={external_id:string;revision:number;duty:Duty};
type Terms={duty_id:string;employment_revision_id:string;employment_revision_ids?:string[];scheduled_work:Interval[];planned_publication_id?:string;planned_duty_id?:string};
type RecordRow={kind:string;entity_id:string;revision:number;payload:Terms};
type Context={can_correct_actuals:boolean;people:{person_id:string;name:string}[];employments:{revision_id:string;relationship_id:string;person_id:string;start:string;end:string;working_time_system?:string}[];duty_options?:{kind:string;task:string;location:string}[];publications:{publication_id:string;version:number;period:string;assignments:Duty[]}[];actuals:Actual[];records:RecordRow[]};
type Edit={work:Interval[];breaks:Interval[];scheduled:Interval[];employmentIds:string[]};
// Inputs explicitly use Japan time; seconds are preserved, including historical values.
const local=(s:string)=>new Date(new Date(s).getTime()+9*3600000).toISOString().slice(0,19);
const instant=(s:string)=>new Date(s+'+09:00').toISOString();
const describe=(xs:Interval[])=>xs.map(x=>`${local(x.start)} ～ ${local(x.end)}`).join('、')||'なし';

function Intervals({label,value,onChange}:{label:string;value:Interval[];onChange:(next:Interval[])=>void}){
  return <fieldset className="workflow-fieldset min-w-0 border p-3 space-y-2"><legend>{label}（日本時間）</legend>{value.map((x,i)=><div key={i} className="flex flex-wrap gap-2">
    {(['start','end'] as const).map(k=><label key={k} className="min-w-0 w-full">{label}{i+1} {k==='start'?'開始':'終了'}<input className="ui-control block min-w-0 w-full max-w-full" type="datetime-local" step="1" required value={local(x[k])} onChange={e=>{if(e.target.value)onChange(value.map((v,j)=>j===i?{...v,[k]:instant(e.target.value)}:v));}}/></label>)}
    <button type="button" className="ui-button ui-button-danger" onClick={()=>onChange(value.filter((_,j)=>i!==j))}>{label}{i+1}を削除</button>
  </div>)}<button type="button" className="ui-button ui-button-secondary" onClick={()=>{const start=value.at(-1)?.end??new Date().toISOString();onChange([...value,{start,end:new Date(new Date(start).getTime()+3600000).toISOString()}]);}}>{label}を追加</button></fieldset>;
}

export default function ActualReconciliation({scope,onDirty}:{scope:string;onDirty?:(dirty:boolean)=>void}){
  const [context,setContext]=useState<Context|null>(null),[base,setBase]=useState<Actual|null>(null),[terms,setTerms]=useState<Terms|null>(null),[termsRevision,setTermsRevision]=useState(0);
  const [edit,setEdit]=useState<Edit|null>(null),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[review,setReview]=useState('');
  const [conflict,setConflict]=useState<{actual:Actual;record?:RecordRow}|null>(null);
  const [hasEdits,setHasEdits]=useState(false);
  const retry=useRef<{body:string;key:string}|null>(null);
  useUnsavedNavigation(dirty);
  useEffect(()=>{onDirty?.(dirty);return()=>onDirty?.(false);},[dirty,onDirty]);
  const load=useCallback(async()=>{const r=await fetch(`${API}/planning/compliance/workflow-context?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store'});if(!r.ok)throw new Error('実績と公開勤務を取得できませんでした。');const data:Context=await r.json();setContext(data);return data;},[scope]);
  useEffect(()=>{load().catch(e=>setMessage(errorText(e)));},[load]);
  const name=(id:string)=>context?.people.find(p=>p.person_id===id)?.name??id;
  const flexEmployments=(context?.employments??[]).filter(e=>e.working_time_system==='flex');
  const isFlex=!!edit&&edit.employmentIds.some(id=>flexEmployments.some(e=>e.revision_id===id));
  const choose=(value:string)=>{
    if(dirty&&!window.confirm('未保存の変更を破棄して対象を切り替えますか？'))return;
    if(!context||!value)return;
    let a:Actual,t:Terms|undefined;
    if(value.startsWith('actual:'))a=context.actuals.find(x=>x.external_id===value.slice(7))!;
    else if(value.startsWith('flex:')){
      // Flextime: the person set the hours, so the actual is recorded without a plan
      // and without scheduled hours (the server refuses them for flextime).
      const employment=context.employments.filter(e=>e.revision_id===value.slice(5))[0],option=context.duty_options?.[0];
      if(!employment||!option){setMessage('業務・場所の候補または雇用条件がないため、計画なしの実績を作成できません。');return;}
      const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10),start=instant(`${day}T09:00:00`),end=instant(`${day}T17:00:00`);
      a={external_id:`flex:${crypto.randomUUID()}`,revision:0,duty:{duty_id:crypto.randomUUID(),person_id:employment.person_id,relationship_id:employment.relationship_id,
        kind:option.kind,task:option.task,location:option.location,start,end,work:[{start,end}],breaks:[],source:'actual'}};
      t={duty_id:a.duty.duty_id,employment_revision_id:employment.revision_id,scheduled_work:[]};
    }
    else{
      const [pIndex,dIndex]=value.split(':').slice(1).map(Number),p=context.publications[pIndex],d=p.assignments[dIndex];
      const external_id=`manual:${p.publication_id}:${d.duty_id}`;
      a=context.actuals.find(x=>x.external_id===external_id)??{external_id,revision:0,duty:{...d,duty_id:crypto.randomUUID(),source:'actual'}};
      t={duty_id:a.duty.duty_id,employment_revision_id:'',scheduled_work:d.work,planned_publication_id:p.publication_id,planned_duty_id:d.duty_id};
    }
    const record=context.records.find(r=>r.kind==='work_terms'&&r.entity_id===a.duty.duty_id);
    t=record?.payload??t??{duty_id:a.duty.duty_id,employment_revision_id:'',scheduled_work:[]};
    setBase(a);setTerms(t);setTermsRevision(record?.revision??0);setEdit({work:a.duty.work,breaks:a.duty.breaks,scheduled:t.scheduled_work,employmentIds:t.employment_revision_ids?.length?t.employment_revision_ids:t.employment_revision_id?[t.employment_revision_id]:[]});
    setDirty(false);setHasEdits(false);setReview('');setConflict(null);setMessage('');retry.current=null;
  };
  const change=(next:Partial<Edit>)=>{setEdit(old=>old?{...old,...next}:old);setDirty(true);setHasEdits(true);};
  const submit=async(reviewOnly=false)=>{
    if(!base||!edit||!terms)return;
    setBusy(true);setMessage('');
    try{
      if(!reviewOnly&&(!edit.work.length||!edit.employmentIds.length))throw new Error('実労働区間と適用する雇用関係を選択してください。');
      const intervals=[...edit.work,...edit.breaks];
      if(!reviewOnly&&[...intervals,...edit.scheduled].some(x=>new Date(x.start)>=new Date(x.end)))throw new Error('終了は開始より後にしてください。');
      const payload=reviewOnly?{external_id:base.external_id,reason:review}:{external_id:base.external_id,revision:base.revision+1,
        duty:{...base.duty,source:'actual',work:edit.work,breaks:edit.breaks,start:new Date(Math.min(...intervals.map(x=>new Date(x.start).getTime()))).toISOString(),end:new Date(Math.max(...intervals.map(x=>new Date(x.end).getTime()))).toISOString()},
        work_terms:{...terms,employment_revision_id:edit.employmentIds[0],employment_revision_ids:edit.employmentIds.length>1?edit.employmentIds:[],scheduled_work:isFlex?[]:edit.scheduled},expected_work_terms_revision:termsRevision};
      const path=reviewOnly?'actual-reviews':'actual-events',body=JSON.stringify({expected_revision:base.revision,payload});
      const fingerprint=path+body;if(retry.current?.body!==fingerprint)retry.current={body:fingerprint,key:crypto.randomUUID()};
      const r=await fetch(`${API}/planning/compliance/${path}?scope_id=${encodeURIComponent(scope)}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(body),idempotency_key:retry.current.key})});
      if(r.status===409){const fresh=await load(),current=fresh.actuals.find(a=>a.external_id===base.external_id)??base;setConflict({actual:current,record:fresh.records.find(x=>x.kind==='work_terms'&&x.entity_id===base.duty.duty_id)});throw new Error('別の更新があります。差分を確認してから再送してください。');}
      if(!r.ok){const response=await r.json();throw new Error(typeof response.detail==='string'?response.detail:'保存できませんでした。入力を確認してください。');}
      const fresh=await load(),saved=fresh.actuals.find(a=>a.external_id===base.external_id);
      if(saved)setBase(saved);setTermsRevision(fresh.records.find(r=>r.kind==='work_terms'&&r.entity_id===base.duty.duty_id)?.revision??termsRevision);
      if(reviewOnly)setReview('');setHasEdits(false);setDirty(!reviewOnly&&!!review);setConflict(null);retry.current=null;setMessage(reviewOnly?'照合内容を記録しました。':'実績と勤務区分を保存しました。再検証対象として確認してください。');
    }catch(e){setMessage(errorText(e)+' 通信が途切れた場合は内容を変えずに再送できます。');}finally{setBusy(false);}
  };
  return <section className="space-y-4" aria-label="実績の照合と訂正"><h2 className="text-xl font-semibold">公開勤務と実績の照合</h2>
    <p>勤務時刻と所定労働を分けて記録します。休憩は実労働に含めません。</p>
    {context?.can_correct_actuals&&<ActualFileImport key={scope} scope={scope} onImported={async()=>{try{await load();}catch(e){setMessage(errorText(e));throw e;}}}/>}
    {message&&<p role="status" className="break-words">{message}</p>}
    <div className="workflow-master-detail"><div className="workflow-selector space-y-3"><h3 className="font-semibold">対象の勤務を選択</h3>
    {!context?<button className="ui-button ui-button-secondary" onClick={()=>load().catch(e=>setMessage(errorText(e)))}>実績を再読込</button>:<label className="block">照合する勤務<select className="ui-control block w-full" value="" onChange={e=>choose(e.target.value)} disabled={busy}><option value="">勤務を選択してください</option>
      <optgroup label="登録済み実績">{context.actuals.map(a=><option key={a.external_id} value={'actual:'+a.external_id}>{name(a.duty.person_id)} {local(a.duty.start)}（実績第{a.revision}版）</option>)}</optgroup>
      {context.can_correct_actuals&&flexEmployments.length>0&&<optgroup label="計画なしの実績を記録（フレックスタイム制）">{flexEmployments.map(e=><option key={e.revision_id} value={'flex:'+e.revision_id}>{name(e.person_id)}（{local(e.start).slice(0,10)} ～ {local(e.end).slice(0,10)}）</option>)}</optgroup>}
      {context.can_correct_actuals&&<optgroup label="公開勤務から実績を記録">{context.publications.flatMap((p,pi)=>p.assignments.map((d,di)=><option key={p.publication_id+d.duty_id} value={`planned:${pi}:${di}`}>{p.period} 公開第{p.version}版 {name(d.person_id)} {local(d.start)}</option>))}</optgroup>}
    </select></label>}
    {context&&!context.actuals.length&&!context.publications.length&&<p>照合する実績・公開勤務がありません。公開済み勤務または勤怠原本の取込後に確認できます。</p>}
    </div><div className="min-w-0 space-y-4">
    {!base&&<p>勤務を選ぶと、実績・所定区分・差分の確認と許可された操作が表示されます。</p>}
    {base&&edit&&<><h3 className="font-semibold">{name(base.duty.person_id)}：{local(base.duty.start)}（{base.revision?'実績第'+base.revision+'版':'新規実績'}）</h3>
      <p>確認開始時の実労働：{describe(base.duty.work)}</p>
      {context?.can_correct_actuals?<form className="space-y-3" onSubmit={e=>{e.preventDefault();submit();}}>
        <Intervals label="実労働" value={edit.work} onChange={work=>change({work})}/><Intervals label="休憩" value={edit.breaks} onChange={breaks=>change({breaks})}/>{isFlex?<p role="note">フレックスタイム制のため、所定労働区間は記録しません。始業・終業の時刻は本人が決め、実労働は清算期間ごとに清算します。</p>:<Intervals label="所定労働" value={edit.scheduled} onChange={scheduled=>change({scheduled})}/>}
        <fieldset className="workflow-fieldset min-w-0 border p-3"><legend>適用する雇用関係（改定を跨ぐ場合は複数選択）</legend>{context.employments.filter(e=>e.relationship_id===base.duty.relationship_id).map(e=><label className="block" key={e.revision_id}><input className="ui-choice" type="checkbox" checked={edit.employmentIds.includes(e.revision_id)} onChange={event=>change({employmentIds:event.target.checked?[...edit.employmentIds,e.revision_id]:edit.employmentIds.filter(id=>id!==e.revision_id)})}/> {local(e.start)} ～ {local(e.end)}</label>)}</fieldset>
        {conflict&&<section role="alert" className="workflow-panel border p-3 space-y-2"><h4>競合した内容を比較してください</h4><p>編集開始時：{describe(base.duty.work)}</p><p>現在の保存内容：{describe(conflict.actual.duty.work)}</p><p>編集中：{describe(edit.work)}</p><p>現在の所定労働：{describe(conflict.record?.payload.scheduled_work??[])}</p><p>編集中の所定労働：{describe(edit.scheduled)}</p><button type="button" className="ui-button ui-button-secondary" onClick={()=>{setBase(conflict.actual);setTermsRevision(conflict.record?.revision??0);setConflict(null);retry.current=null;setMessage('現在版を確認しました。編集中の内容で保存する場合は保存ボタンを押してください。');}}>差分を確認し、編集中の内容を保持</button></section>}
        <button className="ui-button ui-button-secondary" disabled={busy||!!conflict}>{busy?'保存中…':'実績と所定区分を保存・再送'}</button>{dirty&&<p>未保存の変更があります。</p>}
      </form>:<p>所定労働：{describe(edit.scheduled)}</p>}
      {!context?.can_correct_actuals&&conflict&&<section role="alert"><p>実績が第{base.revision}版から第{conflict.actual.revision}版へ変わりました。現在：{describe(conflict.actual.duty.work)}</p><button className="ui-button ui-button-secondary" onClick={()=>{setBase(conflict.actual);setConflict(null);retry.current=null;}}>現在の実績を確認して照合を続ける</button></section>}
      {base.revision>0&&<form className="space-y-2" onSubmit={e=>{e.preventDefault();submit(true);}}><label className="block">照合内容・差異の理由<textarea required className="ui-control block w-full" value={review} onChange={e=>{setReview(e.target.value);setDirty(true);}}/></label>{hasEdits&&<p>先に実績の編集中の内容を保存してから、照合結果を記録してください。</p>}<button className="ui-button ui-button-secondary" disabled={busy||!!conflict||hasEdits}>照合結果を記録・再送</button></form>}
    </>}
    </div></div>
  </section>;
}
