"use client";
import {useCallback,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';

/*
 * Adopting flextime for a facility (労基法32条の3, 則12条の3; MHLW flextime guide p.5-11).
 * Off by default. One administrator enters the agreement and its participants,
 * checks the answers and registers; a different administrator reviews the impact
 * and confirms. The server records who did what; the page never sends identities.
 * Form conventions: デジタル庁デザインシステム (errors below the field, linked with
 * aria-describedby, an error summary that takes focus; no role=alert on fields),
 * WCAG 2.2 AA, and GOV.UK "check answers" with a change link per answer.
 */

import {API_BASE_URL as API} from '@/lib/apiTarget';
import ContextLink from '@/components/ContextLink';
type Evidence={reference:string;status:'unverified'|'verified';verified_by:string|null;valid_until:null};
type Window={start:string;end:string};
type Adoption={adoption_id:string;employer_id:string;establishment_id:string;start:string;end:string;target_scope:string;
  settlement_months:number;settlement_anchor:string;total_hours_rule:'statutory_frame'|'full_two_day_weekend';agreed_total_description:string;
  rest_weekdays?:number[];standard_day_seconds:number;core_time?:Window[];flexible_time?:Window[];work_rules_evidence:Evidence;agreement_evidence:Evidence;
  filing?:{filed_on:string;office:string;evidence:Evidence}|null;agreement_valid_until?:string;status:'registered'|'confirmed'|'withdrawn';
  created_by:string;created_at:string;reviewed_by?:string;reviewed_at?:string;decided_by?:string;withdrawal_reason?:string;end_reason?:string};
type Enrollment={enrollment_id:string;adoption_id:string;person_id:string;start:string;status:Adoption['status'];created_by:string;reviewed_by?:string};
type Row<T>={entity_id:string;revision:number;payload:T};
type Listing={viewer:string;can_manage:boolean;manage_refusal:string|null;adoptions:Row<Adoption>[];enrollments:Row<Enrollment>[];
  establishments:{establishment_id:string;employer_id:string;start:string;end:string}[];people:{person_id:string;name:string}[]};
type Impact={adoption_id:string;status:string;people:{person_id:string;enrollment_id:string;start:string;status:string;employment_revisions:string[]}[];
  timed_duties:{scope_id:string;duty_id:string;person_id:string;start:string}[];blocking:string[];next_steps:string[];impact_hash:string};
type Scope={scope_id:string;role:string};

type Form={establishment_id:string;target_scope:string;settlement_months:string;settlement_anchor:string;last_day:string;
  total_hours_rule:Adoption['total_hours_rule'];rest_weekdays:number[];agreed_total_description:string;standard_day:string;
  flexible_start:string;flexible_end:string;core_start:string;core_end:string;
  work_rules:Evidence;agreement:Evidence;filed_on:string;office:string;filing:Evidence;valid_until:string;participants:string[]};
type FieldName=Exclude<keyof Form,'work_rules'|'agreement'|'filing'>|'work_rules_reference'|'work_rules_verified_by'|'agreement_reference'|'agreement_verified_by'|'filing_reference'|'filing_verified_by';

const WEEKDAYS=['月','火','水','木','金','土','日'];
const STATUS:Record<Adoption['status'],string>={registered:'確認待ち',confirmed:'採用中',withdrawn:'取下げ済み'};
const emptyEvidence=():Evidence=>({reference:'',status:'unverified',verified_by:null,valid_until:null});
const emptyForm=():Form=>({establishment_id:'',target_scope:'',settlement_months:'1',settlement_anchor:'',last_day:'',total_hours_rule:'statutory_frame',
  rest_weekdays:[],agreed_total_description:'清算期間の暦日数 ÷ 7 × 40時間',standard_day:'8:00',flexible_start:'',flexible_end:'',core_start:'',core_end:'',
  work_rules:emptyEvidence(),agreement:emptyEvidence(),filed_on:'',office:'',filing:emptyEvidence(),valid_until:'',participants:[]});
const field='block w-full min-w-0 max-w-full text-base min-h-11';
const todayJst=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const addDays=(day:string,days:number)=>new Date(Date.parse(day+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const jstDay=(instant:string)=>new Date(Date.parse(instant)+9*3600000).toISOString().slice(0,10);
const midnight=(day:string)=>`${day}T00:00:00+09:00`;
const seconds=(text:string)=>{const m=/^(\d{1,2}):([0-5]\d)$/.exec(text.trim());return m?Number(m[1])*3600+Number(m[2])*60:null;};
const minutes=(time:string)=>{const m=/^(\d{2}):(\d{2})$/.exec(time);return m?Number(m[1])*60+Number(m[2]):null;};
const hm=(total:number)=>`${Math.floor(total/3600)}:${String(Math.floor(total%3600/60)).padStart(2,'0')}`;

/** Settlement start days from the anchor (month steps, clamped to the month's end as the server does). */
export function settlementStarts(anchor:string,months:number,until:string,after='',limit=24):string[]{
  // Only days after `after` count toward the limit, so a long-running adoption still offers its next starts.
  const [y,m,d]=anchor.split('-').map(Number),result:string[]=[];
  for(let i=0;result.length<limit;i+=months){
    const month=m-1+i,year=y+Math.floor(month/12),index=((month%12)+12)%12;
    const last=new Date(Date.UTC(year,index+1,0)).getUTCDate();
    const day=`${year}-${String(index+1).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`;
    if(day>=until)break;
    if(day>after)result.push(day);
  }
  return result;
}

/** Client-side checks mirroring the server's (the server checks again). */
export function validate(form:Form):Partial<Record<FieldName,string>>{
  const e:Partial<Record<FieldName,string>>={},months=Number(form.settlement_months),today=todayJst();
  if(!form.establishment_id)e.establishment_id='事業場を選んでください。';
  if(!form.target_scope.trim())e.target_scope='協定で定めた対象労働者の範囲を入力してください。';
  if(!form.settlement_anchor)e.settlement_anchor='清算期間の起算日を入力してください。';
  else if(form.settlement_anchor<=today)e.settlement_anchor='起算日は明日以降の日付にしてください（さかのぼって採用することはできません）。';
  if(!form.last_day)e.last_day='採用の最終日を入力してください。';
  else if(form.settlement_anchor&&form.last_day<form.settlement_anchor)e.last_day='最終日は起算日以降にしてください。';
  if(!form.agreed_total_description.trim())e.agreed_total_description='協定で定めた総労働時間を入力してください。';
  const standard=seconds(form.standard_day);
  if(standard===null||standard<=0||standard>86400)e.standard_day='標準となる1日の労働時間を「8:00」の形で入力してください。';
  if(form.total_hours_rule==='full_two_day_weekend'&&form.rest_weekdays.length<2)e.rest_weekdays='完全週休2日制の特例では、毎週の休日を2日以上選んでください。';
  const flexible=[minutes(form.flexible_start),minutes(form.flexible_end)],core=[minutes(form.core_start),minutes(form.core_end)];
  if(Boolean(form.flexible_start)!==Boolean(form.flexible_end))e.flexible_end='フレキシブルタイムは開始と終了の両方を入力してください。';
  else if(form.flexible_start&&flexible[0]!>=flexible[1]!)e.flexible_end='フレキシブルタイムの終了は開始より後にしてください。';
  if(Boolean(form.core_start)!==Boolean(form.core_end))e.core_end='コアタイムは開始と終了の両方を入力してください。';
  else if(form.core_start){
    if(core[0]!>=core[1]!)e.core_end='コアタイムの終了は開始より後にしてください。';
    else if(!form.flexible_start)e.core_start='コアタイムを設ける場合は、フレキシブルタイムも入力してください。';
    else if(core[0]!<=flexible[0]!||core[1]!>=flexible[1]!)e.core_start='コアタイムは、フレキシブルタイムの内側に収めてください（手引き p.10）。';
    else if(standard!==null&&(core[1]!-core[0]!)*60>=standard)e.core_end='コアタイムは、標準となる1日の労働時間より短くしてください。';
  }
  for(const [key,value] of [['work_rules',form.work_rules],['agreement',form.agreement],...(months>1?[['filing',form.filing]] as const:[])] as const){
    if(!value.reference.trim())e[`${key}_reference` as FieldName]='資料名・保管場所を入力してください。';
    if(value.status==='verified'&&!value.verified_by?.trim())e[`${key}_verified_by` as FieldName]='確認済みにする場合は、確認した人を入力してください。';
  }
  if(months>1){
    if(!form.filed_on)e.filed_on='1か月を超える清算期間では、労働基準監督署への届出日を入力してください。';
    else if(form.settlement_anchor&&form.filed_on>form.settlement_anchor)e.filed_on='届出日は起算日以前にしてください。';
    if(!form.office.trim())e.office='届出先の労働基準監督署を入力してください。';
    if(!form.valid_until)e.valid_until='1か月を超える清算期間では、協定の有効期間の終了日を入力してください。';
    else if(form.last_day&&form.last_day>form.valid_until)e.last_day='採用の最終日は、協定の有効期間の終了日以前にしてください。';
  }
  return e;
}

function toPayload(form:Form,listing:Listing,id:string):Record<string,unknown>{
  const months=Number(form.settlement_months),site=listing.establishments.find(s=>s.establishment_id===form.establishment_id);
  const clean=(v:Evidence):Evidence=>({...v,reference:v.reference.trim(),verified_by:v.status==='verified'?v.verified_by?.trim()??null:null});
  return {adoption_id:id,employer_id:site?.employer_id??'',establishment_id:form.establishment_id,start:midnight(form.settlement_anchor),end:midnight(addDays(form.last_day,1)),
    target_scope:form.target_scope.trim(),settlement_months:months,settlement_anchor:form.settlement_anchor,total_hours_rule:form.total_hours_rule,
    agreed_total_description:form.agreed_total_description.trim(),standard_day_seconds:seconds(form.standard_day),
    ...(form.total_hours_rule==='full_two_day_weekend'?{rest_weekdays:[...form.rest_weekdays].sort()}:{}),
    ...(form.flexible_start?{flexible_time:[{start:form.flexible_start,end:form.flexible_end}]}:{}),
    ...(form.core_start?{core_time:[{start:form.core_start,end:form.core_end}]}:{}),
    work_rules_evidence:clean(form.work_rules),agreement_evidence:clean(form.agreement),
    ...(months>1?{filing:{filed_on:form.filed_on,office:form.office.trim(),evidence:clean(form.filing)},agreement_valid_until:form.valid_until}:{})};
}

async function problem(response:Response):Promise<string>{
  const body=await response.json().catch(()=>null) as {detail?:unknown}|null,detail=body?.detail;
  if(response.status===401)return 'サインインし直してください。';
  if(response.status===403)return typeof detail==='string'&&/[ぁ-ん]/.test(detail)?detail:'この操作の権限がありません。';
  if(response.status===409)return typeof detail==='string'&&/[ぁ-ん]/.test(detail)?detail:'他の操作で記録が更新されました。最新の内容を読み込み直してから、もう一度確認してください。';
  if(typeof detail==='string')return detail;
  if(Array.isArray(detail))return 'サーバーが入力を受け付けませんでした：'+detail.map(d=>String((d as {msg?:string}).msg??'')).join('／');
  return `処理できませんでした（${response.status}）。`;
}

// デジタル庁デザインシステム: required fields say so in their label.
const REQUIRED=new Set<string>(['target_scope','settlement_anchor','last_day','agreed_total_description','standard_day','filed_on','office','valid_until']);
function Required(){return <span className="ml-1 font-normal">（必須）</span>;}
function Hint({id,children}:{id:string;children:ReactNode}){return <p id={id} className="text-base text-fg-muted">{children}</p>;}
function FieldError({id,message}:{id:string;message?:string}){return message?<p id={id} className="text-base font-semibold text-danger">エラー：{message}</p>:null;}

export default function FlexTimeSettings({scopeId}:{scopeId?:string}={}){
  const [scopes,setScopes]=useState<Scope[]>([]),[scope,setScope]=useState(''),[listing,setListing]=useState<Listing|null>(null);
  const [loadError,setLoadError]=useState(''),[status,setStatus]=useState(''),[failure,setFailure]=useState(''),[busy,setBusy]=useState(false);
  const [step,setStep]=useState<'overview'|'form'|'check'>('overview'),[form,setForm]=useState<Form>(emptyForm),[errors,setErrors]=useState<Partial<Record<FieldName,string>>>({});
  const [impact,setImpact]=useState<Impact|null>(null),[reasons,setReasons]=useState<Record<string,string>>({}),[joiners,setJoiners]=useState<Record<string,{person:string;start:string;id:string}>>({});
  const [endOn,setEndOn]=useState<Record<string,string>>({}),[loadedScopes,setLoadedScopes]=useState(false);
  // One adoption identity per registration attempt: a resend after a lost reply
  // carries the same identity and key, so it is not registered twice.
  const pendingId=useRef<string|null>(null);
  const summary=useRef<HTMLDivElement>(null),focusAfter=useRef<string|null>(null),keys=useRef(new Map<string,string>()),base=useId();
  const dirty=step!=='overview';
  useUnsavedNavigation(dirty);
  const id=(name:string)=>`${base}-${name}`;

  useEffect(()=>{let live=true;fetch(`${API}/planning/scopes`,{credentials:'include',cache:'no-store'}).then(async r=>{
    if(!r.ok)throw new Error(r.status===401?'サインインし直してください。':'所属を取得できませんでした。');
    const rows:Scope[]=(await r.json()).filter((s:Scope)=>s.role==='ADMIN');
    if(live){
      setScopes(rows);
      // The ideal workspace owns scope selection. Never replace its explicit scope
      // with the first ADMIN membership merely because that membership sorts first.
      setScope(scopeId ? (rows.some(row=>row.scope_id===scopeId) ? scopeId : '') : (rows[0]?.scope_id??''));
      setLoadedScopes(true);
    }
  }).catch(e=>{if(live)setLoadError(String(e instanceof Error?e.message:e));});return()=>{live=false;};},[scopeId]);
  const load=useCallback(async()=>{if(!scope)return;const r=await fetch(`${API}/planning/compliance/flex-adoptions?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store'});
    if(!r.ok)throw new Error(await problem(r));setListing(await r.json());},[scope]);
  useEffect(()=>{setListing(null);setImpact(null);setLoadError('');load().catch(e=>setLoadError(String(e instanceof Error?e.message:e)));},[load]);
  useEffect(()=>{if(focusAfter.current){document.getElementById(focusAfter.current)?.focus();focusAfter.current=null;}});

  // One idempotency key per distinct request, so a retry after a lost reply is not applied twice.
  const send=async(path:string,body:Record<string,unknown>)=>{
    const fingerprint=path+JSON.stringify(body);let key=keys.current.get(fingerprint);if(!key){key=crypto.randomUUID();keys.current.set(fingerprint,key);}
    const r=await fetch(`${API}/planning/compliance/${path}?scope_id=${encodeURIComponent(scope)}`,{method:'POST',credentials:'include',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,idempotency_key:key})});
    if(!r.ok)throw new Error(await problem(r));return r.json();
  };
  const run=async(action:()=>Promise<string>)=>{setBusy(true);setFailure('');setStatus('');
    try{const done=await action();setStatus(done);await load();}catch(e){setFailure(String(e instanceof Error?e.message:e));await load().catch(()=>undefined);}finally{setBusy(false);}};

  const change=(patch:Partial<Form>)=>setForm(old=>({...old,...patch}));
  const check=()=>{const found=validate(form);setErrors(found);
    if(Object.keys(found).length){focusAfter.current=id('summary');return;}
    setStep('check');focusAfter.current=id('check-heading');};
  const edit=(name:FieldName)=>{setStep('form');focusAfter.current=id(name);};
  const register=()=>run(async()=>{
    if(!listing)return '';
    pendingId.current??=`flex-${form.settlement_anchor}-${crypto.randomUUID().slice(0,8)}`;
    const adoptionId=pendingId.current;
    await send('flex-adoptions',{payload:toPayload(form,listing,adoptionId)});
    const failed:string[]=[];
    for(const person of form.participants){
      try{await send('flex-enrollments',{payload:{enrollment_id:`${adoptionId}-${person}`,adoption_id:adoptionId,person_id:person,start:midnight(form.settlement_anchor)}});}
      catch{failed.push(listing.people.find(p=>p.person_id===person)?.name??person);}
    }
    setForm(emptyForm());setErrors({});setStep('overview');keys.current.clear();pendingId.current=null;focusAfter.current=id('overview-heading');
    return failed.length?`採用を登録しました。参加者のうち ${failed.join('、')} は登録できませんでした。一覧の「参加者を追加」から登録し直してください。`
      :'採用を登録しました。別の管理者が影響を確認して確認するまで、フレックスタイム制は有効になりません。';
  });

  if(loadError&&!listing)return <div className="planning space-y-3"><p role="alert">{loadError}</p><button type="button" className="ui-button ui-button-secondary min-h-11" onClick={()=>{setLoadError('');void load().catch(e=>setLoadError(String(e instanceof Error?e.message:e)));}}>再読込</button></div>;
  if(!scopes.length)return <><p role="status">{loadError||(loadedScopes?'施設の設定は管理者だけが操作できます。管理者の所属がありません。':'管理者の所属を確認しています…')}</p>{loadedScopes&&!loadError&&<p className="text-sm">勤務表や休暇の申請は、<ContextLink className="text-primary underline underline-offset-4" href="/planning">勤務表・計画</ContextLink>から操作できます。</p>}</>;
  if(loadedScopes&&scopeId&&!scope)return <p role="alert">指定された施設・部署を管理する所属がありません。スコープ選択へ戻ってください。</p>;
  const who=(account?:string)=>!account?'':account===listing?.viewer?'あなた':account.length>24?`${account.slice(0,8)}…`:account;
  const name=(person:string)=>listing?.people.find(p=>p.person_id===person)?.name??person;
  const errorIds=(name:FieldName,hint?:boolean)=>[hint?id(name+'-hint'):'',errors[name]?id(name+'-error'):''].filter(Boolean).join(' ')||undefined;
  const invalid=(name:FieldName)=>errors[name]?true:undefined;
  const months=Number(form.settlement_months);

  const evidenceFields=(key:'work_rules'|'agreement'|'filing',title:string)=>{const value=form[key];
    return <fieldset className="workflow-fieldset border p-3 space-y-2 min-w-0"><legend className="font-semibold">{title}</legend>
      <label className="block" htmlFor={id(`${key}_reference`)}>資料名・保管場所<Required/></label>
      <input id={id(`${key}_reference`)} aria-required="true" className={"ui-control "+(field)} value={value.reference} aria-invalid={invalid(`${key}_reference` as FieldName)} aria-describedby={errorIds(`${key}_reference` as FieldName)} onChange={e=>change({[key]:{...value,reference:e.target.value}} as Partial<Form>)}/>
      <FieldError id={id(`${key}_reference-error`)} message={errors[`${key}_reference` as FieldName]}/>
      <label className="block" htmlFor={id(`${key}_status`)}>原本との照合</label>
      <select id={id(`${key}_status`)} className={"ui-control "+(field)} value={value.status} onChange={e=>change({[key]:{...value,status:e.target.value as Evidence['status'],verified_by:e.target.value==='verified'?value.verified_by:null}} as Partial<Form>)}>
        <option value="unverified">未確認（採用の確認はできません）</option><option value="verified">確認済み</option></select>
      {value.status==='verified'&&<><label className="block" htmlFor={id(`${key}_verified_by`)}>原本を確認した人<Required/></label>
        <input id={id(`${key}_verified_by`)} aria-required="true" className={"ui-control "+(field)} value={value.verified_by??''} aria-invalid={invalid(`${key}_verified_by` as FieldName)} aria-describedby={errorIds(`${key}_verified_by` as FieldName)} onChange={e=>change({[key]:{...value,verified_by:e.target.value}} as Partial<Form>)}/>
        <FieldError id={id(`${key}_verified_by-error`)} message={errors[`${key}_verified_by` as FieldName]}/></>}
    </fieldset>;};
  const text=(name:FieldName,label:string,hint?:string,type='text',multiline=false)=><div className="space-y-1 min-w-0">
    <label className="block font-semibold" htmlFor={id(name)}>{label}{REQUIRED.has(name)&&<Required/>}</label>{hint&&<Hint id={id(name+'-hint')}>{hint}</Hint>}
    {multiline?<textarea id={id(name)} aria-required={REQUIRED.has(name)||undefined} className={"ui-control "+(field)} rows={3} value={String(form[name as keyof Form]??'')} aria-invalid={invalid(name)} aria-describedby={errorIds(name,!!hint)} onChange={e=>change({[name]:e.target.value} as Partial<Form>)}/>
      :<input id={id(name)} aria-required={REQUIRED.has(name)||undefined} type={type} className={"ui-control "+(field)} value={String(form[name as keyof Form]??'')} aria-invalid={invalid(name)} aria-describedby={errorIds(name,!!hint)} onChange={e=>change({[name]:e.target.value} as Partial<Form>)}/>}
    <FieldError id={id(name+'-error')} message={errors[name]}/></div>;

  const answers:[FieldName,string,string][]=listing?[
    ['establishment_id','事業場',form.establishment_id],['target_scope','対象労働者の範囲',form.target_scope],
    ['settlement_months','清算期間',`${form.settlement_months}か月`],['settlement_anchor','起算日（採用の開始日）',form.settlement_anchor],
    ['last_day','採用の最終日',form.last_day],
    ['total_hours_rule','総労働時間の定め',form.total_hours_rule==='statutory_frame'?'法定の枠（暦日数÷7×40時間）':`完全週休2日制の特例（休日：${form.rest_weekdays.map(d=>WEEKDAYS[d]).join('・')}）`],
    ['agreed_total_description','協定で定めた総労働時間',form.agreed_total_description],['standard_day','標準となる1日の労働時間',form.standard_day],
    ['flexible_start','フレキシブルタイム',form.flexible_start?`${form.flexible_start}〜${form.flexible_end}`:'定めなし'],
    ['core_start','コアタイム',form.core_start?`${form.core_start}〜${form.core_end}`:'定めなし'],
    ['work_rules_reference','就業規則の規定',`${form.work_rules.reference}（${form.work_rules.status==='verified'?`確認済み・${form.work_rules.verified_by}`:'未確認'}）`],
    ['agreement_reference','労使協定',`${form.agreement.reference}（${form.agreement.status==='verified'?`確認済み・${form.agreement.verified_by}`:'未確認'}）`],
    ...(months>1?[['filed_on','協定届',`${form.filed_on} ${form.office}／${form.filing.reference}（${form.filing.status==='verified'?`確認済み・${form.filing.verified_by}`:'未確認'}）`] as [FieldName,string,string],
      ['valid_until','協定の有効期間の終了日',form.valid_until] as [FieldName,string,string]]:[]),
    ['participants','参加者',form.participants.map(name).join('、')||'なし（後から追加できます）'],
  ]:[];

  return <div className="planning space-y-6 min-w-0 text-base">
    <p role="status" aria-live="polite">{status}</p>
    {failure&&<p role="alert" className="border border-danger p-3 font-semibold">{failure}</p>}
    {scopes.length>1&&!scopeId&&<div className="space-y-1"><label className="block font-semibold" htmlFor={id('scope')}>施設・部署</label>
      <select id={id('scope')} className={"ui-control "+(field)} value={scope} disabled={dirty} onChange={e=>setScope(e.target.value)}>{scopes.map(s=><option key={s.scope_id}>{s.scope_id}</option>)}</select></div>}
    {!listing&&<p role="status">採用の状況を読み込み中…</p>}

    {listing&&step==='overview'&&<section aria-labelledby={id('overview-heading')} className="space-y-4">
      <h3 id={id('overview-heading')} tabIndex={-1} className="text-xl font-bold">この施設のフレックスタイム制</h3>
      {!listing.adoptions.some(a=>a.payload.status!=='withdrawn')&&<p>採用していません（既定）。採用すると、参加者には時刻付きの勤務を割り当てず、実績から清算期間ごとに清算します。</p>}
      {!listing.can_manage&&<p className="border p-3">{listing.manage_refusal??'採用の登録と確認はできません。'}（閲覧のみ）</p>}
      {listing.adoptions.map(({entity_id,revision,payload:a})=>{
        const people=listing.enrollments.filter(n=>n.payload.adoption_id===entity_id);
        const mine=a.created_by===listing.viewer,shown=impact?.adoption_id===entity_id?impact:null;
        const upcoming=settlementStarts(a.settlement_anchor,a.settlement_months,jstDay(a.end),todayJst());
        // Before the start an adoption is withdrawn; after it, it is ended at a later
        // settlement period start, so no settlement period that has begun is undone.
        const started=jstDay(a.start)<=todayJst(),joiner=joiners[entity_id]??{person:'',start:'',id:''};
        return <article key={entity_id} aria-labelledby={id(entity_id)} className="border p-4 space-y-3 min-w-0">
          <h4 id={id(entity_id)} className="text-lg font-semibold">{a.establishment_id}：{jstDay(a.start)} から {addDays(jstDay(a.end),-1)} まで <span className="border px-2">{STATUS[a.status]}</span></h4>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_1fr]">
            <dt className="font-semibold">対象労働者の範囲</dt><dd>{a.target_scope}</dd>
            <dt className="font-semibold">清算期間</dt><dd>{a.settlement_months}か月（起算日 {a.settlement_anchor}）</dd>
            <dt className="font-semibold">総労働時間</dt><dd>{a.total_hours_rule==='statutory_frame'?'法定の枠':'完全週休2日制の特例'}：{a.agreed_total_description}</dd>
            <dt className="font-semibold">標準となる1日</dt><dd>{hm(a.standard_day_seconds)}</dd>
            <dt className="font-semibold">フレキシブル・コア</dt><dd>{a.flexible_time?.map(w=>`${w.start}〜${w.end}`).join('、')||'定めなし'}／{a.core_time?.map(w=>`${w.start}〜${w.end}`).join('、')||'定めなし'}</dd>
            <dt className="font-semibold">根拠</dt><dd>就業規則 {a.work_rules_evidence.status==='verified'?'確認済み':'未確認'}・労使協定 {a.agreement_evidence.status==='verified'?'確認済み':'未確認'}{a.filing?`・協定届 ${a.filing.filed_on}（${a.filing.evidence.status==='verified'?'確認済み':'未確認'}）`:''}</dd>
            <dt className="font-semibold">登録・確認</dt><dd>登録 {who(a.created_by)}{a.reviewed_by?`／確認 ${who(a.reviewed_by)}`:''}{a.decided_by?`／${a.end_reason?'終了':'取下げ'} ${who(a.decided_by)}（${a.end_reason??a.withdrawal_reason}）`:''}</dd>
          </dl>
          <h5 className="font-semibold">参加者</h5>
          {people.length?<ul className="space-y-1">{people.map(({entity_id:enrollment,revision:rev,payload:n})=>{
            // Unconfirmed enrolments never took effect; confirmed ones only before their start.
            const canWithdraw=listing.can_manage&&(n.status==='registered'||(n.status==='confirmed'&&jstDay(n.start)>todayJst()));
            return <li key={enrollment} className="flex flex-wrap items-center gap-2">
            <span>{name(n.person_id)}：{jstDay(n.start)} から（{STATUS[n.status]}・登録 {who(n.created_by)}{n.reviewed_by?`・確認 ${who(n.reviewed_by)}`:''}）</span>
            {listing.can_manage&&a.status==='confirmed'&&n.status==='registered'&&(n.created_by===listing.viewer
              ?<span>登録した本人は確認できません。別の管理者が確認します。</span>
              :<button type="button" className="ui-button ui-button-secondary min-h-11" disabled={busy} onClick={()=>void run(async()=>{await send(`flex-enrollments/${encodeURIComponent(enrollment)}/confirm`,{expected_revision:rev});return `${name(n.person_id)} の参加を確認しました。`;})}>{name(n.person_id)} の参加を確認する</button>)}
            {listing.can_manage&&n.status==='confirmed'&&jstDay(n.start)<=todayJst()&&<span>開始済みです。本人を外すときは、清算期間の初日から通常の雇用条件を登録してください。</span>}
            {canWithdraw&&<label className="block w-full">参加を取り下げる理由（必須）<input className={"ui-control "+(field)} value={reasons[enrollment]??''} onChange={e=>setReasons(r=>({...r,[enrollment]:e.target.value}))}/></label>}
            {canWithdraw&&<button type="button" className="ui-button ui-button-secondary min-h-11" aria-describedby={id(enrollment+'-why')} disabled={busy||!reasons[enrollment]?.trim()} onClick={()=>void run(async()=>{await send(`flex-enrollments/${encodeURIComponent(enrollment)}/withdraw`,{expected_revision:rev,reason:reasons[enrollment]});return `${name(n.person_id)} の参加を取り下げました。`;})}>{name(n.person_id)} の参加を取り下げる</button>}
            {canWithdraw&&<p id={id(enrollment+'-why')} className="text-base">理由を入力すると取り下げられます。</p>}
          </li>;})}</ul>:<p>参加者はいません。</p>}

          {listing.can_manage&&a.status==='registered'&&(mine
            ?<p className="border p-3">あなたが登録したため、確認は別の管理者が行います（登録と確認を同じ人が行うことはできません）。</p>
            :<div className="space-y-3">
              <button type="button" className="ui-button ui-button-secondary min-h-11" disabled={busy} onClick={()=>void run(async()=>{const r=await fetch(`${API}/planning/compliance/flex-adoptions/${encodeURIComponent(entity_id)}/impact?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store'});if(!r.ok)throw new Error(await problem(r));setImpact(await r.json());focusAfter.current=id(entity_id+'-impact');return '影響を表示しました。内容を確認してください。';})}>確認の前に影響を表示する</button>
              {shown&&<section aria-labelledby={id(entity_id+'-impact')} className="workflow-panel border p-3 space-y-2">
                <h5 id={id(entity_id+'-impact')} tabIndex={-1} className="font-semibold">確認すると変わること</h5>
                <p>参加者 {shown.people.length}人：{shown.people.map(p=>`${name(p.person_id)}（${jstDay(p.start)} から）`).join('、')||'なし'}</p>
                <p>開始日以降の時刻付きの勤務（割当から外す必要があります）：{shown.timed_duties.length}件</p>
                {shown.timed_duties.length>0&&<ul className="list-disc pl-6">{shown.timed_duties.slice(0,20).map(d=><li key={d.scope_id+d.duty_id}>{name(d.person_id)} {jstDay(d.start)}（{d.scope_id}）</li>)}{shown.timed_duties.length>20&&<li>ほか {shown.timed_duties.length-20}件</li>}</ul>}
                <h6 className="font-semibold">確認の後に行うこと</h6><ol className="list-decimal pl-6">{shown.next_steps.map(s=><li key={s}>{s}</li>)}</ol>
                {shown.blocking.length>0&&<><h6 className="font-semibold">確認できない理由</h6><ul className="list-disc pl-6">{shown.blocking.map(b=><li key={b}>{b}</li>)}</ul></>}
                <button type="button" className="ui-button ui-button-secondary min-h-11 font-semibold" disabled={busy||shown.blocking.length>0} aria-describedby={shown.blocking.length?id(entity_id+'-blocked'):undefined}
                  onClick={()=>void run(async()=>{const r=await send(`flex-adoptions/${encodeURIComponent(entity_id)}/confirm`,{expected_revision:revision,impact_hash:shown.impact_hash}) as {enrollments_needing_another_admin:string[]};setImpact(null);
                    return r.enrollments_needing_another_admin.length?'採用を確認しました。あなたが登録した参加者は、さらに別の管理者の確認が必要です。':'採用を確認しました。参加者ごとに、フレックスタイム制の雇用条件を登録してください。';})}>内容と影響を確認して採用する</button>
                {shown.blocking.length>0&&<p id={id(entity_id+'-blocked')}>上の理由を解消するまで確認できません。</p>}
              </section>}
            </div>)}

          {listing.can_manage&&a.status!=='withdrawn'&&upcoming.length>0&&<details className="border p-3"><summary className="min-h-11 cursor-pointer">参加者を追加</summary>
            <div className="space-y-2 pt-2">
              <label className="block" htmlFor={id(entity_id+'-person')}>職員</label>
              <select id={id(entity_id+'-person')} className={"ui-control "+(field)} value={joiner.person} onChange={e=>setJoiners(j=>({...j,[entity_id]:{...joiner,person:e.target.value,id:crypto.randomUUID().slice(0,8)}}))}><option value="">選んでください</option>
                {listing.people.filter(p=>!people.some(n=>n.payload.person_id===p.person_id&&n.payload.status!=='withdrawn')).map(p=><option key={p.person_id} value={p.person_id}>{p.name}</option>)}</select>
              <label className="block" htmlFor={id(entity_id+'-start')}>参加の開始日（清算期間の初日）</label>
              <select id={id(entity_id+'-start')} className={"ui-control "+(field)} value={joiner.start} onChange={e=>setJoiners(j=>({...j,[entity_id]:{...joiner,start:e.target.value,id:crypto.randomUUID().slice(0,8)}}))}><option value="">選んでください</option>{upcoming.map(d=><option key={d}>{d}</option>)}</select>
              <button type="button" className="ui-button ui-button-secondary min-h-11" disabled={busy||!joiner.person||!joiner.start} onClick={()=>void run(async()=>{await send('flex-enrollments',{payload:{enrollment_id:`${entity_id}-${joiner.person}-${joiner.id}`,adoption_id:entity_id,person_id:joiner.person,start:midnight(joiner.start)}});const added=name(joiner.person);setJoiners(j=>({...j,[entity_id]:{person:'',start:'',id:''}}));return `${added} の参加を登録しました。別の管理者の確認が必要です。`;})}>参加を登録する</button>
            </div></details>}

          {listing.can_manage&&a.status==='confirmed'&&started&&!a.end_reason&&upcoming.length>0&&<details className="border p-3"><summary className="min-h-11 cursor-pointer">採用を終了する</summary>
            <div className="space-y-2 pt-2"><p>終了日は、将来の清算期間の初日から選びます。始まっている清算期間は最後まで清算します。終了日より後に始まる参加は取り下げます。参加者の雇用条件は、終了日から通常の労働時間制で登録し直してください。</p>
              <label className="block" htmlFor={id(entity_id+'-end')}>終了日（この日から採用しない）</label>
              <select id={id(entity_id+'-end')} className={"ui-control "+(field)} value={endOn[entity_id]??''} onChange={e=>setEndOn(v=>({...v,[entity_id]:e.target.value}))}><option value="">選んでください</option>{upcoming.map(d=><option key={d}>{d}</option>)}</select>
              <label className="block" htmlFor={id(entity_id+'-end-reason')}>終了する理由（必須）</label>
              <textarea id={id(entity_id+'-end-reason')} className={"ui-control "+(field)} value={reasons[entity_id+':end']??''} onChange={e=>setReasons(r=>({...r,[entity_id+':end']:e.target.value}))}/>
              <button type="button" className="ui-button ui-button-secondary min-h-11" disabled={busy||!endOn[entity_id]||!reasons[entity_id+':end']?.trim()} onClick={()=>void run(async()=>{await send(`flex-adoptions/${encodeURIComponent(entity_id)}/end`,{expected_revision:revision,end_on:endOn[entity_id],reason:reasons[entity_id+':end']});return `採用を ${endOn[entity_id]} で終了します。参加者の雇用条件を通常の労働時間制で登録し直してください。`;})}>理由を記録して終了する</button>
            </div></details>}

          {listing.can_manage&&(a.status==='registered'||(a.status==='confirmed'&&!started))&&<details className="border p-3"><summary className="min-h-11 cursor-pointer">採用を取り下げる</summary>
            <div className="space-y-2 pt-2"><p>取り下げると、参加者のフレックスタイム制の雇用条件は「採用されていない」として公開前の確認で止まります。</p>
              <label className="block" htmlFor={id(entity_id+'-reason')}>取り下げる理由（必須）</label>
              <textarea id={id(entity_id+'-reason')} className={"ui-control "+(field)} value={reasons[entity_id]??''} onChange={e=>setReasons(r=>({...r,[entity_id]:e.target.value}))}/>
              <button type="button" className="ui-button ui-button-secondary min-h-11" disabled={busy||!reasons[entity_id]?.trim()} onClick={()=>void run(async()=>{await send(`flex-adoptions/${encodeURIComponent(entity_id)}/withdraw`,{expected_revision:revision,reason:reasons[entity_id]});return '採用を取り下げました。';})}>理由を記録して取り下げる</button>
            </div></details>}
        </article>;})}
      {listing.can_manage&&<button type="button" className="ui-button ui-button-secondary min-h-11 font-semibold" onClick={()=>{setStep('form');focusAfter.current=id('form-heading');}}>フレックスタイム制の採用を登録する</button>}
    </section>}

    {listing&&step==='form'&&<form noValidate className="space-y-4" aria-labelledby={id('form-heading')} onSubmit={e=>{e.preventDefault();check();}}>
      <h3 id={id('form-heading')} tabIndex={-1} className="text-xl font-bold">採用の登録（1/2：入力）</h3>
      <p>就業規則と労使協定で定めた内容を、原本のとおりに入力します（労働基準法第32条の3、同施行規則第12条の3）。「（必須）」の項目は必ず入力してください。</p>
      {Object.keys(errors).length>0&&<div id={id('summary')} ref={summary} tabIndex={-1} className="border-2 border-danger p-3 space-y-1">
        <h4 id={id('summary-title')} className="font-semibold">入力内容に誤りがあります（{Object.keys(errors).length}件）</h4>
        <ul className="list-disc pl-6">{(Object.entries(errors) as [FieldName,string][]).map(([name,message])=><li key={name}><a className="underline" href={`#${id(name)}`} onClick={e=>{e.preventDefault();document.getElementById(id(name))?.focus();}}>{message}</a></li>)}</ul></div>}
      <div className="space-y-1 min-w-0"><label className="block font-semibold" htmlFor={id('establishment_id')}>事業場<Required/></label>
        <select id={id('establishment_id')} aria-required="true" className={"ui-control "+(field)} value={form.establishment_id} aria-invalid={invalid('establishment_id')} aria-describedby={errorIds('establishment_id')} onChange={e=>change({establishment_id:e.target.value})}>
          <option value="">選んでください</option>{listing.establishments.map(s=><option key={s.establishment_id} value={s.establishment_id}>{s.establishment_id}（{s.employer_id}）</option>)}</select>
        <FieldError id={id('establishment_id-error')} message={errors.establishment_id}/></div>
      {text('target_scope','対象労働者の範囲','協定の文言のとおりに入力します（例：薬剤部の常勤の薬剤師）。','text',true)}
      <div className="space-y-1"><label className="block font-semibold" htmlFor={id('settlement_months')}>清算期間</label>
        <select id={id('settlement_months')} className={"ui-control "+(field)} value={form.settlement_months} onChange={e=>change({settlement_months:e.target.value})}><option value="1">1か月</option><option value="2">2か月（届出が必要）</option><option value="3">3か月（届出が必要）</option></select></div>
      {text('settlement_anchor','清算期間の起算日（採用の開始日）','明日以降の日付。参加者はこの日か、後の清算期間の初日から参加します。','date')}
      {text('last_day','採用の最終日（この日を含む）',months>1?'協定の有効期間の終了日以前にします。':undefined,'date')}
      <fieldset id={id('total_hours_rule')} tabIndex={-1} className="workflow-fieldset border p-3 space-y-2 min-w-0" aria-describedby={errors.rest_weekdays?id('rest_weekdays-error'):undefined}><legend className="font-semibold">総労働時間の定め</legend>
        <label className="flex items-center gap-2 min-h-11"><input className="ui-choice" type="radio" name={id('rule')} checked={form.total_hours_rule==='statutory_frame'} onChange={()=>change({total_hours_rule:'statutory_frame',rest_weekdays:[]})}/> 法定の枠（清算期間の暦日数 ÷ 7 × 40時間）</label>
        <label className="flex items-center gap-2 min-h-11"><input className="ui-choice" type="radio" name={id('rule')} checked={form.total_hours_rule==='full_two_day_weekend'} onChange={()=>change({total_hours_rule:'full_two_day_weekend'})}/> 完全週休2日制の特例（8時間 × 所定労働日数。労使協定が必要）</label>
        {form.total_hours_rule==='full_two_day_weekend'&&<fieldset id={id('rest_weekdays')} tabIndex={-1} className="workflow-fieldset space-y-1"><legend>毎週の休日（2日以上）</legend>{WEEKDAYS.map((day,i)=><label key={day} className="inline-flex items-center gap-1 mr-4 min-h-11"><input className="ui-choice" type="checkbox" checked={form.rest_weekdays.includes(i)} onChange={e=>change({rest_weekdays:e.target.checked?[...form.rest_weekdays,i]:form.rest_weekdays.filter(d=>d!==i)})}/> {day}</label>)}</fieldset>}
        <FieldError id={id('rest_weekdays-error')} message={errors.rest_weekdays}/></fieldset>
      {text('agreed_total_description','協定で定めた総労働時間','協定の文言のとおりに入力します。')}
      {text('standard_day','標準となる1日の労働時間','「時間:分」の形（例：7:45）。年次有給休暇の1日分の時間です。')}
      <fieldset className="workflow-fieldset border p-3 space-y-2 min-w-0"><legend className="font-semibold">フレキシブルタイムとコアタイム（定めがある場合）</legend>
        <p>コアタイムは、フレキシブルタイムの内側で、標準となる1日の労働時間より短くします。</p>
        <div className="grid gap-3 sm:grid-cols-2">{text('flexible_start','フレキシブルタイムの開始',undefined,'time')}{text('flexible_end','フレキシブルタイムの終了',undefined,'time')}
          {text('core_start','コアタイムの開始',undefined,'time')}{text('core_end','コアタイムの終了',undefined,'time')}</div></fieldset>
      {evidenceFields('work_rules','就業規則の規定（始業・終業の時刻を労働者に委ねる定め）')}
      {evidenceFields('agreement','労使協定')}
      {months>1&&<fieldset className="workflow-fieldset border p-3 space-y-3 min-w-0"><legend className="font-semibold">協定届（1か月を超える清算期間）</legend>
        {text('filed_on','届出日','起算日以前の日付。','date')}{text('office','届出先の労働基準監督署')}{text('valid_until','協定の有効期間の終了日',undefined,'date')}
        {evidenceFields('filing','届出の控え')}</fieldset>}
      <fieldset id={id('participants')} tabIndex={-1} className="workflow-fieldset border p-3 space-y-1 min-w-0"><legend className="font-semibold">参加者（起算日から参加）</legend>
        {listing.people.map(p=><label key={p.person_id} className="flex items-center gap-2 min-h-11"><input className="ui-choice" type="checkbox" checked={form.participants.includes(p.person_id)} onChange={e=>change({participants:e.target.checked?[...form.participants,p.person_id]:form.participants.filter(x=>x!==p.person_id)})}/> {p.name}</label>)}
        {!listing.people.length&&<p>この部署の勤務計画の入力に職員がいません。</p>}</fieldset>
      <div className="flex flex-wrap gap-3"><button type="submit" className="ui-button ui-button-secondary min-h-11 font-semibold">入力内容を確認する</button>
        <button type="button" className="ui-button ui-button-secondary min-h-11" onClick={()=>{if(window.confirm('入力した内容を破棄しますか？')){setForm(emptyForm());setErrors({});setStep('overview');focusAfter.current=id('overview-heading');}}}>入力をやめる</button></div>
    </form>}

    {listing&&step==='check'&&<section aria-labelledby={id('check-heading')} className="space-y-4">
      <h3 id={id('check-heading')} tabIndex={-1} className="text-xl font-bold">採用の登録（2/2：内容の確認）</h3>
      <p>登録しても、別の管理者が影響を確認して確認するまで、フレックスタイム制は有効になりません。</p>
      <dl className="divide-y border">{answers.map(([name,label,value])=><div key={name} className="grid gap-2 p-3 sm:grid-cols-[14rem_1fr_auto]">
        <dt className="font-semibold">{label}</dt><dd className="break-words">{value}</dd>
        <dd><button type="button" className="ui-button ui-button-secondary underline min-h-11" onClick={()=>edit(name)}>変更<span className="sr-only">（{label}）</span></button></dd></div>)}</dl>
      {(form.work_rules.status!=='verified'||form.agreement.status!=='verified'||(months>1&&form.filing.status!=='verified'))&&<p className="border p-3">根拠に未確認のものがあります。登録はできますが、確認済みにするまで採用の確認はできません。</p>}
      <div className="flex flex-wrap gap-3"><button type="button" className="ui-button ui-button-secondary min-h-11 font-semibold" disabled={busy} onClick={()=>void register()}>この内容で登録する（確認待ち）</button>
        <button type="button" className="ui-button ui-button-secondary min-h-11" onClick={()=>{setStep('form');focusAfter.current=id('form-heading');}}>入力に戻る</button></div>
    </section>}
  </div>;
}
