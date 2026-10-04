"use client";
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';
import AnnualSegments, {segmentErrors, type AnnualSegment} from './AnnualSegments';
import NewStaffTaskList, {type StartKind} from './NewStaffTaskList';

import {API_BASE_URL as API} from '@/lib/apiTarget';
import ContextLink from '@/features/workspace/shared/ContextLink';
import {errorText} from '@/lib/errorText';
type Evidence={reference:string;status:'unverified'|'verified'|'rejected';verified_by:string|null;valid_until:string|null};
type Kind='person'|'contract'|'establishment'|'capability'|'agreement'|'rule_review'|'rule_decision'|'accounting_transition'|'site_attribution_decision'|'annual_calendar'|'employment'|'management_model'|'leave_policy'|'leave_account'|'leave_record'|'leave_obligation'|'ledger_recording'|'employer'|'capability_amendment'|'demand';
type Payload=Record<string,unknown>;
type Row={kind:string;entity_id:string;revision:number;payload:Payload};
type Person={person_id:string;name:string};
type Context={input_hash?:string;demands?:Payload[];employers?:Payload[];capability_amendments?:Payload[];capability_targets?:{target_hash:string;payload:Payload}[];management_models?:Payload[];leave_policies?:Payload[];leave_accounts?:Payload[];leave_records?:Payload[];leave_obligations?:Payload[];ledger_recordings?:Payload[];staging_valid?:boolean;validation_issues?:{message:string;location:string|unknown[]}[];agreements?:Payload[];rule_reviews?:Payload[];rule_decisions?:Payload[];accounting_transitions?:Payload[];site_attribution_decisions?:Payload[];annual_calendars?:Payload[];rule_revision?:string;role:string;people:Person[];contracts:Payload[];employments:Payload[];establishments:Payload[];capabilities:Payload[];duty_options:{kind:string;task:string;location:string}[];records:Row[]};
type Selection={key:string;revision:number;payload:Payload;label:string};
type Impact={review_id:string;rule_id:string;source_sha256:string;impact_hash:string;impact_count:number;publications:{publication_id:string;period_key:string;version:number;rule_revision:string}[];grant_assessments:{assessment_id:string;as_of:string;rule_revision:string}[];grant_records:{account_id:string;granted_on:string}[]};
const labels:Record<Kind,string>={demand:'時間帯別の必要配置',person:'職員',contract:'契約改定',establishment:'事業場',capability:'資格・監督条件',agreement:'36協定',rule_review:'規則の適用確認',rule_decision:'改定規則の公開判断',accounting_transition:'制度切替の集計条件',site_attribution_decision:'事業場間の時間外の帰属の判断',annual_calendar:'1年単位の変形労働時間制のカレンダー',employment:'雇用関係・兼業制度',management_model:'兼業の管理モデル',leave_policy:'年休の取得規則',leave_account:'人事原本の年休付与',leave_record:'年休の予約・取得・取消',leave_obligation:'年5日の管理期間',ledger_recording:'人事原本の記録日時',employer:'雇用主の登録',capability_amendment:'資格の取消・失効'};
const field='block w-full min-w-0 max-w-full';
const emptyEvidence=():Evidence=>({reference:'',status:'unverified',verified_by:null,valid_until:null});
const local=(value:unknown)=>typeof value==='string'&&value?new Date(new Date(value).getTime()+9*3600000).toISOString().slice(0,19):'';
const utc=(value:string)=>value?new Date(value+'+09:00').toISOString():'';
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const identity=(kind:Kind,payload:Payload)=>String(payload[({person:'person_id',contract:'revision_id',establishment:'establishment_id',agreement:'agreement_id',rule_review:'review_id',rule_decision:'decision_id',accounting_transition:'transition_id',site_attribution_decision:'decision_id',annual_calendar:'calendar_id',capability:'person_id',employment:'revision_id',management_model:'model_id',leave_policy:'policy_id',leave_account:'account_id',leave_record:'event_id',leave_obligation:'obligation_id',ledger_recording:'recording_id',employer:'employer_id',capability_amendment:'amendment_id',demand:'demand_id'} as const)[kind]]??'');
const personName=(context:Context,id:unknown)=>context.people.find(p=>p.person_id===id)?.name??String(id??'');
const evidenceNames:Record<string,string>={variable_evidence:'変形労働時間制の根拠（就業規則・労使協定）',evidence:'原本確認',regime_evidence:'労働時間制度の確認',dispatch_evidence:'派遣の適用根拠',invocation_evidence:'特別条項の適用根拠',declaration:'兼業申告の確認',first_consent:'先契約の雇用主の合意',second_consent:'後契約の雇用主の合意',notification:'通知の確認',half_day_request_evidence:'半日取得の本人請求確認'};

// Working-time systems: the fields of the other systems are cleared (the server
// omits empty ones, so stored records keep their form and hash).
const workingTimeDefaults=(system:string):Payload=>({working_time_system:system,variable_anchor:system==='monthly_variable'?'':null,variable_period_days:null,
 variable_evidence:['monthly_variable','flex'].includes(system)?emptyEvidence():null,annual_calendar_id:system==='annual_variable'?'':null,
 flex_anchor:system==='flex'?'':null,flex_months:system==='flex'?1:null,flex_full_two_day_weekend:false,flex_rest_weekdays:[],flex_other_rest_days:[]});
const clock=(seconds:number)=>`${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}${seconds%60?':'+String(seconds%60).padStart(2,'0'):''}`;
const compactChoice=(label:string,max=10)=>{const characters=Array.from(label);return characters.length>max?characters.slice(0,max).join('')+'…':label;};
const isoDate=/^\d{4}-\d{2}-\d{2}$/;
const hours=(text:string)=>{const m=/^(\d{1,4}):([0-5]\d)(?::([0-5]\d))?$/.exec(text);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]??0):null;};
type Parsed<T>={items:T[];errors:string[]};
function parseLines<T>(text:string,read:(parts:string[])=>T|null):Parsed<T>{
 const items:T[]=[],errors:string[]=[];
 text.split('\n').forEach((line,i)=>{const parts=line.trim().split(/\s+/).filter(Boolean);if(!parts.length)return;const item=read(parts);if(item===null)errors.push(`${i+1}行目：${line.trim()}`);else items.push(item);});
 return {items,errors};
}
const parseDays=(text:string)=>parseLines(text,p=>p.length===2&&isoDate.test(p[0])&&hours(p[1])!==null&&hours(p[1])!>0?{day:p[0],seconds:hours(p[1])!}:null);
const parseRanges=(text:string)=>parseLines(text,p=>p.length===2&&isoDate.test(p[0])&&isoDate.test(p[1])?{start:p[0],end:p[1]}:null);


function LinesField<T>({label,help,initial,parse,onParsed}:{label:string;help:string;initial:string;parse:(text:string)=>Parsed<T>;onParsed:(items:T[],errors:string[])=>void}){
 const [text,setText]=useState(initial),helpId=useId(),{errors}=parse(text);
 return <div className="min-w-0 space-y-1"><label className="block">{label}<textarea className={"ui-control "+(field)} rows={4} aria-describedby={helpId} value={text} onChange={e=>{setText(e.target.value);const parsed=parse(e.target.value);onParsed(parsed.items,parsed.errors);}}/></label>
  <p id={helpId} className="text-sm">{help}</p>{errors.length>0&&<p role="alert">読み取れない行：{errors.join('、')}</p>}</div>;
}

function DateTimeField({label,value,onChange,required=false}:{label:string;value:unknown;onChange:(value:string)=>void;required?:boolean}){
 const helpId=useId(),display=local(value);
 return <div className="min-w-0 space-y-1"><label className="block">{label}<input className={"ui-control "+(field)} type="datetime-local" step="1" required={required} value={display} aria-describedby={helpId} onChange={e=>onChange(e.target.value)}/></label><p id={helpId} className="min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere] text-sm">現在値：{display?display.replace('T',' ')+'（日本時間）':'未入力'}</p></div>;
}

// Each field sends only what it changed; the parent merges it into the latest state,
// so two changes within one frame never overwrite each other with a stale copy.
function EvidenceInput({name,value,onChange}:{name:string;value:Evidence;onChange:(patch:Partial<Evidence>)=>void}){
 return <fieldset className="workflow-fieldset border p-3 space-y-2 min-w-0"><legend>{name}</legend>
  <label className="block">{name}の資料名・参照先<input className={"ui-control "+(field)} required value={value.reference} onChange={e=>onChange({reference:e.target.value})}/></label>
  <label className="block">{name}の状態<select className={"ui-control "+(field)} value={value.status} onChange={e=>onChange({status:e.target.value as Evidence['status'],...(e.target.value==='verified'?{}:{verified_by:null})})}><option value="unverified">未確認</option><option value="verified">確認済み</option><option value="rejected">不採用</option></select></label>
  {value.status==='verified'&&<label className="block">{name}の確認責任者<input className={"ui-control "+(field)} required value={value.verified_by??''} onChange={e=>onChange({verified_by:e.target.value})}/></label>}
  <DateTimeField label={`${name}の有効期限（任意・日本時間）`} value={value.valid_until} onChange={next=>onChange({valid_until:next?utc(next):null})}/>
 </fieldset>;
}

function description(payload:Payload,context:Context):string{
 return Object.entries(payload).filter(([key])=>!['person_id','revision_id','relationship_id','employer_id','facility_id','department_id','establishment_id'].includes(key)).map(([key,value])=>{
  const names:Record<string,string>={name:'氏名',start:'開始',end:'終了',period_max_seconds:'期間上限秒',period_min_seconds:'期間下限秒',contractual_week_seconds:'週所定秒',rest_seconds:'勤務間休息秒',time_category:'勤務時間区分',engagement:'雇用形態',fixed_term:'有期契約',regime:'労働時間制度',external_work_confirmed:'兼業確認',max_consecutive_days:'最大連続勤務日',allowed_weekdays:'勤務可能曜日',allowed_kinds:'勤務種類',evidence:'原本確認',regime_evidence:'制度根拠',dispatch_evidence:'派遣根拠',dispatch_tasks:'派遣対象業務',task:'業務',location:'場所',supervision_required:'監督必要',supervisor_capacity:'監督可能数',overtime_agreement_id:'適用協定'};
  if(key==='segments'&&Array.isArray(value))return '区分期間：\n'+(value as AnnualSegment[]).map((s,i)=>{const c=s.consent;return `${i+1}. ${s.start} ～ ${s.end}（終了日を含まない）・${s.working_days}日・${s.total_seconds}秒・確定日 ${s.fixed_on??'未確定'}${c?`\n同意：${({verified:'確認済み',unverified:'未確認',rejected:'不採用'} as const)[c.status]??'未対応'}・資料 ${c.reference}・確認責任者 ${c.verified_by??'未登録'}・有効期限 ${c.valid_until??'なし'}`:'\n同意資料なし'}`;}).join('\n');
  if(key==='start'||key==='end')return `${names[key]}：${local(value)}`;
  if(value&&typeof value==='object'&&!Array.isArray(value)&&'reference' in value){const e=value as Evidence;return `${names[key]??key}：${e.reference}（${e.status}・${e.verified_by??'確認者なし'}・${local(e.valid_until)||'期限なし'}）`;}
  return `${names[key]??key}：${Array.isArray(value)?value.join('、'):String(value??'なし')}`;
 }).join('\n')+(payload.person_id?'\n職員：'+personName(context,payload.person_id):'');
}

/** Dedicated forms. Updates retain unedited fields and never silently rebase a 409. */
export default function ContractWorkflow({scope,onChanged,group='contracts',inputHash,initialPersonId}:{scope:string;onChanged:()=>void|Promise<void>;group?:'contracts'|'leave'|'demand';inputHash?:string;initialPersonId?:string}){
 const [context,setContext]=useState<Context|null>(null),[kind,setKind]=useState<Kind>(group==='leave'?'leave_account':group==='demand'?'demand':initialPersonId?'contract':'person'),[base,setBase]=useState<Selection|null>(null),[value,setValue]=useState<Payload|null>(null);
 const [leaveAccountBase,setLeaveAccountBase]=useState<Selection|null>(null);
 const [lineErrors,setLineErrors]=useState<Record<string,string[]>>({});
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[conflict,setConflict]=useState<Selection|null>(null);
 const retry=useRef<{fingerprint:string;key:string}|null>(null);
 const [impact,setImpact]=useState<Impact|null>(null);
 const loadImpact=async(reviewId:string)=>{const response=await fetch(`${API}/planning/compliance/rule-impact/${encodeURIComponent(reviewId)}?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error(`影響の一覧を取得できませんでした（${response.status}）。`);const next:Impact=await response.json();
  // A response for a review that is no longer selected must not bind its hash.
  setValue(old=>{if(!old||old.review_id!==reviewId)return old;setImpact(next);setDirty(true);return {...old,rule_id:next.rule_id,source_sha256:next.source_sha256,impact_hash:next.impact_hash,impact_count:next.impact_count};});};
 useUnsavedNavigation(dirty);
 const load=useCallback(async()=>{const response=await fetch(`${API}/planning/compliance/workflow-context?scope_id=${encodeURIComponent(scope)}${inputHash?'&input_hash='+encodeURIComponent(inputHash):''}`,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('契約・制度の候補を取得できませんでした。');const next:Context=await response.json();setContext(next);return next;},[scope,inputHash]);
 useEffect(()=>{let live=true;setContext(null);setValue(null);setBase(null);setLeaveAccountBase(null);setDirty(false);load().catch(e=>{if(live)setError(errorText(e));});return()=>{live=false;};},[load]);
 const selections=(ctx:Context,k:Kind):Selection[]=>{
  const collection:Record<Kind,Payload[]>={demand:ctx.demands??[],person:ctx.people,contract:ctx.contracts,establishment:ctx.establishments,capability:ctx.capabilities??[],agreement:ctx.agreements??[],rule_review:ctx.rule_reviews??[],rule_decision:ctx.rule_decisions??[],accounting_transition:ctx.accounting_transitions??[],site_attribution_decision:ctx.site_attribution_decisions??[],annual_calendar:ctx.annual_calendars??[],employment:ctx.employments,management_model:ctx.management_models??[],leave_policy:ctx.leave_policies??[],leave_account:ctx.leave_accounts??[],leave_record:ctx.leave_records??[],leave_obligation:ctx.leave_obligations??[],ledger_recording:ctx.ledger_recordings??[],employer:ctx.employers??[],capability_amendment:ctx.capability_amendments??[]};
  const describeRow=(v:Payload)=>{
   const name=personName(ctx,v.person_id),employer=String(ctx.employers?.find(e=>e.employer_id===v.employer_id)?.name??v.employer_id??'');
   const date=(d:unknown)=>typeof d==='string'&&d.length===10?d:local(d);
   if(k==='person'||k==='employer')return String(v.name);
   if(k==='leave_account')return `${name} ${employer} ${v.granted_on}付与 ${v.granted_days}日（失効 ${v.expires_on}）`;
   if(k==='leave_record')return `${v.effective_on} ${v.kind} ${v.quantity} ${v.unit}`;
   if(k==='ledger_recording')return `${v.external_event_id} 原本第${v.external_revision}版（把握 ${local(v.recorded_at)}）`;
   if(k==='capability_amendment')return `${name} ${local(v.effective_at)} 資格の取消・失効 ${v.reason}`;
   if(k==='rule_review')return `${v.rule_id} ${v.provision}（確認 ${v.reviewed_on}${v.document_version?`・資料 ${v.document_version}`:''}）`;
   if(k==='rule_decision')return `${v.rule_id} ${v.decision==='publish'?'公開する':'公開を保留する'}（影響 ${v.impact_count}件・判断 ${v.decided_on}）`;
   if(k==='accounting_transition')return `${v.calculation_basis}（${(v.evidence as Evidence)?.reference??'未確認'}）`;
   if(k==='annual_calendar')return `${employer} ${v.start} ～ ${v.end}（${(v.days as unknown[]??[]).length}日確定）`;
   if(k==='site_attribution_decision')return `${employer} ${v.reading==='time_order'?'働いた順':'所定を先に'} ${local(v.start)} ～ ${local(v.end)}`;
   return `${[name,employer].filter(Boolean).join(' ')} ${k==='capability'?`${v.task}・${v.location} `:''}${date(v.start)} ～ ${date(v.end)}`;
  };
  const result=collection[k].map((payload,index)=>{const record=k==='capability'?ctx.records.find(r=>r.kind===k&&canonical(r.payload)===canonical(payload)):ctx.records.find(r=>r.kind===k&&r.entity_id===identity(k,payload));const current=record?.payload??payload;return {key:record?.entity_id??(k==='capability'?`snapshot:${index}`:identity(k,payload)),revision:record?.revision??0,payload:current,label:describeRow(current)};});
  for(const row of ctx.records.filter(r=>r.kind===k))if(!result.some(r=>r.key===row.entity_id))result.push({key:row.entity_id,revision:row.revision,payload:row.payload,label:describeRow(row.payload)});
  return result;
 };
 const choose=(nextKind:Kind,key='new',preset:Payload={})=>{
  if(!context||(dirty&&!window.confirm('未保存の変更を破棄して対象を切り替えますか？')))return;
  setKind(nextKind);setConflict(null);setLeaveAccountBase(null);setLineErrors({});setDirty(false);setError('');setMessage('');retry.current=null;
  if(key!=='new'){const found=selections(context,nextKind).find(s=>s.key===key);if(found){setBase(found);setValue(structuredClone(found.payload));if(nextKind==='leave_record')setLeaveAccountBase(selections(context,'leave_account').find(a=>a.key===found.payload.account_id)??null);}return;}
  const id=crypto.randomUUID(),[facility_id,department_id]=scope.split('/');
  const initial:Payload=nextKind==='demand'?{demand_id:id,task:'',location:'',minimum:0,target:0,start:'',end:'',evidence:emptyEvidence()}:nextKind==='employer'?{employer_id:id,name:'',evidence:emptyEvidence()}:nextKind==='capability_amendment'?{amendment_id:id,person_id:'',target_hash:'',effective_at:'',reason:'',evidence:emptyEvidence()}:nextKind==='employment'?{revision_id:id,relationship_id:crypto.randomUUID(),person_id:'',employer_id:'',establishment_id:'',start:'',end:'',contract_order:null,activity:'employment',method:'standard',week_start:0,statutory_holidays:[],calendar_confirmed:false,declaration:emptyEvidence(),agreement_id:null}:nextKind==='management_model'?{model_id:id,person_id:'',first_employer:'',second_employer:'',start:'',end:'',month_anchor:'',first_month_limit_seconds:0,second_month_limit_seconds:0,first_consent:emptyEvidence(),second_consent:emptyEvidence(),notification:emptyEvidence()}:nextKind==='leave_policy'?{policy_id:id,person_id:'',employer_id:'',start:'',end:'',hourly_enabled:false,half_day_enabled:false,hours_per_day:8,hourly_quantum:1,hourly_year_start:'',hourly_cap_days:5,evidence:emptyEvidence()}:nextKind==='leave_account'?{account_id:id,person_id:'',employer_id:'',granted_on:'',expires_on:'',statutory_days:0,granted_days:0,evidence:emptyEvidence(),grant_cycle_id:null}:nextKind==='leave_record'?{event_id:id,account_id:'',kind:'reserve',unit:'day',quantity:1,effective_on:'',policy_id:'',interval:{start:'',end:''},related_event_id:null,evidence:emptyEvidence(),conversion_old_hours:null,conversion_new_hours:null}:nextKind==='leave_obligation'?{obligation_id:id,person_id:'',employer_id:'',start:'',end:'',required_half_days:10,qualifying_grant_ids:[],evidence:emptyEvidence(),method:'separate',rounding_unit:'day',half_day_request_evidence:null}:nextKind==='ledger_recording'?{recording_id:id,object_kind:'leave_account',object_id:'',external_event_id:'',external_revision:1,recorded_at:'',evidence:emptyEvidence()}:nextKind==='agreement'?{agreement_id:id,employer_id:'',establishment_id:'',start:'',end:'',year_start:'',month_anchor:'',daily_limit_seconds:0,monthly_limit_seconds:0,annual_limit_seconds:0,special_clause:false,holiday_work_permitted:false,evidence:emptyEvidence(),invocation_evidence:null}:nextKind==='rule_decision'?{decision_id:id,review_id:'',rule_id:'',source_sha256:'',decision:'hold',impact_hash:'',impact_count:0,decided_on:'',evidence:emptyEvidence()}:nextKind==='rule_review'?{review_id:id,rule_id:context.rule_revision??'',source_url:'',document_version:'',source_sha256:'',provision:'',transitional_provision:'',reviewed_on:'',next_review_on:'',start:'',end:'',evidence:emptyEvidence()}:nextKind==='annual_calendar'?{calendar_id:id,employer_id:'',establishment_id:'',start:'',end:'',first_period_end:'',week_start:0,days:[],segments:[],special_periods:[],evidence:emptyEvidence()}:nextKind==='site_attribution_decision'?{decision_id:id,employer_id:'',reading:'scheduled_first',reason:'',start:'',end:'',evidence:emptyEvidence()}:nextKind==='accounting_transition'?{transition_id:id,before_revision_id:'',after_revision_id:'',calculation_basis:'effective_calendar_windows',evidence:emptyEvidence()}:nextKind==='person'?{person_id:id,name:''}:nextKind==='establishment'?{establishment_id:id,employer_id:'',start:'',end:'',evidence:emptyEvidence()}:nextKind==='capability'?{person_id:'',task:'',location:'',start:'',end:'',evidence:emptyEvidence(),supervision_required:false,supervisor_capacity:0}:{revision_id:id,relationship_id:'',person_id:'',employer_id:'',facility_id,department_id,start:'',end:'',engagement:'direct',fixed_term:false,time_category:'full_time',regime:'general',evidence:emptyEvidence(),regime_evidence:emptyEvidence(),dispatch_evidence:null,dispatch_tasks:[],external_work_confirmed:false,allowed_weekdays:[0,1,2,3,4,5,6],allowed_kinds:[],period_min_seconds:0,period_max_seconds:0,contractual_week_seconds:144000,rest_seconds:0,max_consecutive_days:6,overtime_agreement_id:null};
  const personBound=['contract','capability','employment','management_model','leave_policy','leave_account','leave_obligation'];
  const seeded={...initial,...(initialPersonId&&personBound.includes(nextKind)?{person_id:initialPersonId}:{}),...preset};
  setBase({key:'new',revision:0,payload:structuredClone(seeded),label:'新規登録'});setValue(seeded);
 };
 const change=(next:Partial<Payload>)=>{setValue(old=>old?{...old,...next}:old);setDirty(true);};
 // Same limits as the server: special clause under 100h/month (Labour Standards Act 36(6)(ii)),
 // otherwise 45h/360h. A stored 100h agreement stays savable while that value is unchanged.
 const agreementLimitError=(next:Payload,stored:Payload|undefined)=>{
  const monthly=Number(next.monthly_limit_seconds??0),annual=Number(next.annual_limit_seconds??0),special=Boolean(next.special_clause);
  const kept=Number(stored?.monthly_limit_seconds)===monthly;
  if(special&&monthly>=100*3600&&!kept)return '特別条項の月上限は100時間（360000秒）未満にしてください。';
  if(!special&&(monthly>45*3600||annual>360*3600))return '特別条項がない協定の上限は、月45時間（162000秒）・年360時間（1296000秒）以内にしてください。';
  if(annual>720*3600)return '協定の年上限は720時間（2592000秒）以内にしてください。';
  return null;
 };
 const save=async()=>{
  if(!context||!base||!value||conflict)return;setBusy(true);setMessage('');setError('');
  try{
   if(!['person','rule_decision','accounting_transition','leave_account','leave_record','ledger_recording','employer','capability_amendment'].includes(kind)&&new Date(String(value.start))>=new Date(String(value.end)))throw new Error('適用終了は開始より後にしてください。');
   if(kind==='annual_calendar'&&Object.values(lineErrors).some(list=>list.length))throw new Error('カレンダーの行に読み取れない内容があります。表示された行を直してください。');
   if(kind==='annual_calendar'){const errors=segmentErrors((value.segments as AnnualSegment[])??[]);if(errors.length)throw new Error(errors.join('、'));}
   if(kind==='contract'&&(!Array.isArray(value.allowed_kinds)||!value.allowed_kinds.length))throw new Error('勤務種類を選択してください。');
   if(kind==='agreement'){const limit=agreementLimitError(value,base.payload);if(limit)throw new Error(limit);}
   // Capability identity is its full payload hash. A changed qualification is a new record, not an overwrite.
   if(kind==='leave_record'&&(!leaveAccountBase||leaveAccountBase.key!==value.account_id||leaveAccountBase.revision<1))throw new Error('対象付与原本の現在版を確認してください。未登録の場合は先に人事原本の年休付与を照合・登録してください。');
   const expected=kind==='leave_record'?leaveAccountBase!.revision:kind==='capability'&&canonical(base.payload)!==canonical(value)?0:base.revision;
   const payload=kind==='leave_record'&&['expire','conversion'].includes(String(value.kind))&&!(value.interval as Payload|null)?.start&&!(value.interval as Payload|null)?.end?{...value,interval:null}:value;
   if(kind==='demand'&&(!context.input_hash||(inputHash&&context.input_hash!==inputHash)))throw new Error('対象期間の入力版が確認できません。候補を再取得してください。');
   const body={expected_revision:expected,payload,...(kind==='demand'?{input_hash:context.input_hash}:{})},fingerprint=kind+JSON.stringify(body);
   if(retry.current?.fingerprint!==fingerprint)retry.current={fingerprint,key:crypto.randomUUID()};
   const response=await fetch(`${API}/planning/compliance/${kind==='leave_record'?'leave-events':`records/${kind}`}?scope_id=${encodeURIComponent(scope)}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,idempotency_key:retry.current.key})});
   if(response.status===409){const fresh=await load(),current=kind==='leave_record'?selections(fresh,'leave_account').find(r=>r.key===value.account_id):selections(fresh,kind).find(r=>r.key===base.key);if(current)setConflict(current);throw new Error(current?'別の更新があります。編集開始時・現在・編集中を比較してください。':'保存対象の版または識別条件が変わりました。編集中の内容を保持しています。対象を再選択して確認してください。');}
   if(!response.ok)throw new Error(`保存できませんでした（${response.status}）。${await response.text()}`);
   const fresh=await load();const current=selections(fresh,kind).find(r=>kind==='capability'?canonical(r.payload)===canonical(value):identity(kind,r.payload)===identity(kind,value));
   if(current){setBase(current);setValue(structuredClone(current.payload));if(kind==='leave_record')setLeaveAccountBase(selections(fresh,'leave_account').find(a=>a.key===value.account_id)??null);}else{setBase(null);setValue(null);}
   setDirty(false);setConflict(null);retry.current=null;
   // Keep the form disabled until dependent panels have reloaded. Otherwise a
   // fast next edit can race a parent refresh and be replaced by the older
   // controlled value, even though the preceding record was stored correctly.
   try{await onChanged();}catch(e){setError('記録は保存しましたが、関連する表示を更新できませんでした。再読込して保存結果を確認してください。 '+errorText(e));}
   window.dispatchEvent(new Event('planning-records-changed'));
   setMessage('記録を保存して再取得しました。勤務入力へ反映した後、再検証してください。');
  }catch(e){setError(errorText(e)+' 通信が途切れた場合は、内容を変えずに同じ保存ボタンから再送できます。');}finally{setBusy(false);}
 };
 if(!context)return <section aria-label="職員と契約の専用操作"><p role="status">職員と契約の候補を読み込み中…</p>{error&&<p role="alert">{error}</p>}<button className="ui-button ui-button-secondary" onClick={()=>load().catch(e=>setError(errorText(e)))}>候補の再読込</button></section>;
 if(context.role!=='ADMIN'&&!(group==='demand'&&context.role==='LEADER'))return null;
 const text=(key:string,label:string,required=true)=><label className="block">{label}<input className={"ui-control "+(field)} required={required} value={String(value?.[key]??'')} onChange={e=>change({[key]:e.target.value})}/></label>;
 const selectChange=(key:string,next:string)=>{
  const reset:Payload={};
  if(key==='person_id'){if(kind==='contract')Object.assign(reset,{relationship_id:'',employer_id:''});if(['leave_policy','leave_account','leave_obligation'].includes(kind))reset.employer_id='';if(kind==='leave_obligation')reset.qualifying_grant_ids=[];if(kind==='management_model')Object.assign(reset,{first_employer:'',second_employer:''});}
  if(key==='employer_id'&&kind==='leave_obligation')reset.qualifying_grant_ids=[];
  if(key==='first_employer')reset.second_employer='';
  if(key==='object_kind')reset.object_id='';
  if(key==='review_id'&&kind==='rule_decision'){Object.assign(reset,{rule_id:'',source_sha256:'',impact_hash:'',impact_count:0});setImpact(null);}
  if(key==='task'&&kind==='demand')reset.location='';
  if(key==='account_id'){Object.assign(reset,{policy_id:'',related_event_id:null});setLeaveAccountBase(selections(context,'leave_account').find(a=>a.key===next)??null);}
  if(key==='kind'&&kind==='leave_record')Object.assign(reset,{related_event_id:null,conversion_old_hours:null,conversion_new_hours:null});
  if(key==='establishment_id'&&kind==='annual_calendar')reset.employer_id=String(context?.establishments.find(e=>e.establishment_id===next)?.employer_id??'');
  change({[key]:['week_start','flex_months'].includes(key)?(next===''?null:Number(next)):next||null,...reset});
 };
 const select=(key:string,label:string,options:{value:string;label:string}[],required=true)=>{const selectedIndex=options.findIndex(o=>o.value===String(value?.[key]??'')),selected=selectedIndex>=0?options[selectedIndex]:undefined;return <div className="min-w-0 space-y-1"><label className="block">{label}<select className={"ui-control "+(field)} required={required} value={String(value?.[key]??'')} onChange={e=>selectChange(key,e.target.value)}><option value="">選択してください</option>{options.map((o,index)=><option key={o.value} value={o.value}>{index+1}. {compactChoice(o.label)}</option>)}</select></label><p data-selected-for={key} className="max-w-full whitespace-normal break-words [overflow-wrap:anywhere] text-sm">{label}の選択内容：{selected?`${selectedIndex+1}. ${selected.label}`:'未選択'}</p></div>;};
 const check=(key:string,label:string)=><label className="block"><input className="ui-choice" type="checkbox" checked={Boolean(value?.[key])} onChange={e=>change({[key]:e.target.checked})}/> {label}</label>;
 const seconds=(key:string,label:string,min=0,max?:number)=><label className="block">{label}（秒・丸めなし）<input className={"ui-control "+(field)} type="number" required min={min} max={max} step="1" value={Number(value?.[key]??0)} onChange={e=>change({[key]:Number(e.target.value)})}/></label>;
 const employers=Array.from(new Set([...(context.employers??[]),...context.records.filter(r=>r.kind==='employer').map(r=>r.payload),...context.contracts,...context.employments,...context.establishments].map(x=>String(x.employer_id)))).filter(x=>x&&x!=='undefined');
 const employerName=(id:unknown)=>String(context.employers?.find(e=>e.employer_id===id)?.name??context.records.find(r=>r.kind==='employer'&&r.entity_id===id)?.payload.name??id);
 const personOptions=[...context.people,...context.records.filter(r=>r.kind==='person'&&!context.people.some(p=>p.person_id===r.entity_id)).map(r=>r.payload as Person)].map(p=>({value:p.person_id,label:p.name}));
 const duties=context.duty_options??[];
 const sites=[...context.establishments,...context.records.filter(r=>r.kind==='establishment').map(r=>r.payload)].filter((v,i,all)=>all.findIndex(x=>x.establishment_id===v.establishment_id)===i);
 const employments=[...context.employments,...context.records.filter(r=>r.kind==='employment').map(r=>r.payload)].filter((v,i,all)=>all.findIndex(x=>x.revision_id===v.revision_id)===i);
 const before=employments.find(e=>e.revision_id===value?.before_revision_id);
 const nextEmployments=before?employments.filter(e=>['person_id','relationship_id','employer_id','establishment_id'].every(k=>e[k]===before[k])&&Date.parse(String(before.end))===Date.parse(String(e.start))):[];
 const whole=(key:string,label:string,min=0,max?:number)=><label className="block">{label}<input className={"ui-control "+(field)} type="number" step="1" required min={min} max={max} value={Number(value?.[key]??0)} onChange={e=>change({[key]:Number(e.target.value)})}/></label>;
 const merged=(name:keyof Context,k:string)=>{const original=(Array.isArray(context[name])?context[name]:[]) as Payload[];return [...original,...context.records.filter(r=>r.kind===k).map(r=>r.payload)].filter((v,i,all)=>all.findIndex(x=>identity(k as Kind,x)===identity(k as Kind,v))===i);};
 const accounts=merged('leave_accounts','leave_account'),policies=merged('leave_policies','leave_policy'),events=merged('leave_records','leave_record');
 const selectedAccount=accounts.find(a=>a.account_id===value?.account_id);
 const employerOptions=Array.from(new Set([...context.contracts,...employments].filter(e=>e.person_id===value?.person_id).map(e=>String(e.employer_id)))).map(e=>({value:e,label:employerName(e)}));
 const visibleKinds:Kind[]=group==='demand'?['demand']:group==='leave'?['leave_account','leave_policy','leave_record','leave_obligation','ledger_recording']:['person','employer','contract','employment','establishment','agreement','management_model','capability','capability_amendment','rule_review','rule_decision','accounting_transition','site_attribution_decision','annual_calendar'];
 // Contract kinds follow the dependency order: employer→site→employment, person→employment→contract, person→capability.
 const kindGroups:[string,Kind[]][]=group==='contracts'?[['雇用主と事業場（施設で一度だけ）',['employer','establishment','management_model']],['職員の登録（上から順に）',['person','employment','contract','capability','capability_amendment']],['規則・協定・判断',['agreement','rule_review','rule_decision','accounting_transition','site_attribution_decision','annual_calendar']]]:[['',visibleKinds]];
 const staffRecords={people:personOptions.map(p=>({person_id:p.value,name:p.label})),sites,employments,contracts:[...context.contracts,...context.records.filter(r=>r.kind==='contract').map(r=>r.payload)],capabilities:[...context.capabilities,...context.records.filter(r=>r.kind==='capability').map(r=>r.payload)]};
 const startStep=(k:StartKind,personId:string)=>choose(k,'new',personId&&['employment','contract','capability'].includes(k)?{person_id:personId}:{});
 const selectedRecords=selections(context,kind).filter(r=>!initialPersonId||!Object.hasOwn(r.payload,'person_id')||r.payload.person_id===initialPersonId);
 const dateInput=(key:string,label:string)=><div className="min-w-0 space-y-1"><label className="block">{label}<input className={"ui-control "+(field)} type="date" required value={String(value?.[key]??'')} onChange={e=>change({[key]:e.target.value})}/></label><p className="min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere] text-sm">現在値：{String(value?.[key]??'')||'未入力'}</p></div>;
 return <section aria-label={group==='demand'?'必要配置の専用操作':group==='leave'?'年休原本の専用操作':'職員と契約の専用操作'} className="workflow-section space-y-4 min-w-0"><h3 className="text-lg font-semibold">{group==='demand'?'時間帯別の必要配置':group==='leave'?'年休の原本・取得・管理期間':'職員・契約・事業場・制度'}</h3>
  <p>対象と現在版は候補から取得します。登録しても勤務入力には自動反映されません。{group==='contracts'&&<>反映は<ContextLink className="text-primary underline underline-offset-4" href={`/planning?scope=${encodeURIComponent(scope)}#contract-heading`}>勤務表・計画の「契約と適用期間」</ContextLink>で行います。</>}</p>
{group==='contracts'&&<NewStaffTaskList records={staffRecords} scope={scope} busy={busy} onStart={startStep} initialPersonId={initialPersonId}/>}
  {context.staging_valid===false&&<section role="alert" aria-label="編集中の契約・制度の不整合" className="workflow-panel border border-danger p-3 space-y-2"><h4>編集中の記録に不整合があります</h4><p>登録した記録は修正できますが、勤務入力への反映・生成・公開の前に以下を解消してください。</p><ul className="list-disc pl-5">{context.validation_issues?.map((issue,i)=><li key={i} className="break-words">{Array.isArray(issue.location)?issue.location.join(' / '):issue.location}：{issue.message}</li>)}</ul></section>}

  <div className="workflow-master-detail"><div className="workflow-selector space-y-4">
  <h4 className="font-semibold">1. 対象を選ぶ</h4>
  <label className="block">登録する業務<select className={"ui-control "+(field)} value={kind} disabled={busy} onChange={e=>choose(e.target.value as Kind)}>{kindGroups.map(([title,kinds])=>title?<optgroup key={title} label={title}>{kinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</optgroup>:kinds.map(k=><option key={k} value={k}>{labels[k]}</option>))}</select></label>
  <label className="block">編集する対象<select className={"ui-control "+(field)} disabled={busy} value={base?.key??''} onChange={e=>choose(kind,e.target.value)}><option value="">対象を選択してください</option><option value="new">新規登録</option>{selectedRecords.map((r,index)=><option key={r.key} value={r.key}>{index+1}. {compactChoice(r.label)}（第{r.revision}版）</option>)}</select></label>
  <p className="min-w-0 max-w-full whitespace-normal break-words [overflow-wrap:anywhere] text-sm">選択中の記録：{base?`${base.label}（登録第${base.revision}版）`:'対象未選択'}</p>
  </div><div className="min-w-0 space-y-4">
  <h4 className="font-semibold">2. 内容・根拠を確認して保存</h4>
  {!base&&<p className="rounded-lg bg-canvas p-4 text-fg-muted">左の候補から対象を選択してください。狭い画面では上に表示されます。</p>}
  {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="break-words">{error}</p>}
  {base&&value&&<form className="space-y-3 min-w-0" onSubmit={e=>{e.preventDefault();void save();}}><fieldset disabled={busy} className="workflow-fieldset space-y-3 min-w-0">
   {kind==='person'?text('name','職員の氏名'):<>
    {['contract','capability','employment','management_model','leave_policy','leave_account','leave_obligation'].includes(kind)&&select('person_id','対象職員',personOptions)}
    {kind==='contract'&&<><label className="block">適用する雇用関係<select className={"ui-control "+(field)} required value={String(value.relationship_id??'')} onChange={e=>{const employment=context.employments.find(x=>x.relationship_id===e.target.value&&x.person_id===value.person_id),contract=context.contracts.find(x=>x.relationship_id===e.target.value&&x.person_id===value.person_id);const selected=employment??contract;if(selected)change({relationship_id:e.target.value,employer_id:selected.employer_id});}}><option value="">選択してください</option>{Array.from(new Map([...context.employments,...context.contracts].filter(x=>x.person_id===value.person_id).map(x=>[String(x.relationship_id),x])).values()).map(x=><option key={String(x.relationship_id)} value={String(x.relationship_id)}>{employerName(x.employer_id)}（{local(x.start)} ～ {local(x.end)}）</option>)}</select></label><p>契約の部署：{scope}</p></>}
    {kind==='establishment'&&select('employer_id','事業場の雇用主',employers.map(e=>({value:e,label:employerName(e)})))}
    {!['accounting_transition','rule_decision','leave_account','leave_record','leave_obligation','ledger_recording','employer','capability_amendment','annual_calendar'].includes(kind)&&(['start','end'] as const).map(key=><DateTimeField key={key} label={`${key==='start'?'適用開始':'適用終了'}（日本時間）`} value={value[key]} required onChange={next=>change({[key]:utc(next)})}/>)}
    {kind==='demand'&&<>{select('task','配置する業務',Array.from(new Set(duties.map(d=>d.task))).map(v=>({value:v,label:v})))}{select('location','配置する場所',Array.from(new Set(duties.filter(d=>d.task===value.task).map(d=>d.location))).map(v=>({value:v,label:v})))}{whole('minimum','必須の配置人数')}{whole('target','希望する配置人数')}<p>必須人数を満たせない場合は公開できません。配置条件の変更後は勤務入力へ反映して再生成・検証してください。</p></>}
    {kind==='employer'&&<>{text('name','雇用主の正式名称')}<p>不変の識別子は自動発行します。名称を変更しても同じ雇用主として履歴を保持します。</p></>}
    {kind==='capability_amendment'&&<>
     <label className="block">取消・失効の対象資格<select className={"ui-control "+(field)} required value={String(value.target_hash??'')} onChange={e=>{const target=context.capability_targets?.find(c=>c.target_hash===e.target.value);change({target_hash:e.target.value,person_id:target?.payload.person_id??''});}}><option value="">選択してください</option>{context.capability_targets?.map(target=><option key={target.target_hash} value={target.target_hash}>{personName(context,target.payload.person_id)} {String(target.payload.task)}・{String(target.payload.location)} {local(target.payload.start)} ～ {local(target.payload.end)}</option>)}</select></label>
     <DateTimeField label="資格を使用できなくなる日時（日本時間）" value={value.effective_at} required onChange={next=>change({effective_at:utc(next)})}/>{text('reason','資格の取消・失効理由')}
     <p>原本の開始日時から取り消す場合は開始と同じ日時を指定します。原本の内容・ハッシュは保持し、過去入力の履歴と現在の有効期間を区別します。</p>
    </>}
    {kind==='employment'&&<>
     <label className="block">雇用関係の履歴<select className={"ui-control "+(field)} value={employments.some(e=>e.relationship_id===value.relationship_id)?String(value.relationship_id):'new'} onChange={e=>change({relationship_id:e.target.value==='new'?crypto.randomUUID():e.target.value})}><option value="new">新しい雇用関係を作成</option>{Array.from(new Map(employments.filter(e=>e.person_id===value.person_id).map(e=>[String(e.relationship_id),e])).values()).map(e=><option key={String(e.relationship_id)} value={String(e.relationship_id)}>{employerName(e.employer_id)} {local(e.start)} ～ {local(e.end)}</option>)}</select></label>
     <label className="block">雇用先の事業場<select className={"ui-control "+(field)} required value={String(value.establishment_id??'')} onChange={e=>{const site=sites.find(s=>s.establishment_id===e.target.value);change({establishment_id:e.target.value,employer_id:site?.employer_id??''});}}><option value="">選択してください</option>{sites.map(site=><option key={String(site.establishment_id)} value={String(site.establishment_id)}>{employerName(site.employer_id)} {local(site.start)} ～ {local(site.end)}</option>)}</select></label>
     <label className="block">契約締結順（未確認の場合は空欄）<input className={"ui-control "+(field)} type="number" min="1" step="1" value={value.contract_order===null?'':Number(value.contract_order)} onChange={e=>change({contract_order:e.target.value?Number(e.target.value):null})}/></label>
     {select('activity','活動の区分',[{value:'employment',label:'雇用による労働'},{value:'nonemployment',label:'非雇用の活動（法定通算と区別）'}])}{select('method','時間管理方式',[{value:'standard',label:'原則方式'},{value:'management',label:'確認済み2雇用主の管理モデル'}])}
     <label className="block">週の起算曜日<select className={"ui-control "+(field)} value={Number(value.week_start)} onChange={e=>change({week_start:Number(e.target.value)})}>{['月','火','水','木','金','土','日'].map((day,i)=><option key={day} value={i}>{day}曜日</option>)}</select></label>
     <fieldset className="workflow-fieldset border p-3 min-w-0"><legend>法定休日の日付</legend>{(value.statutory_holidays as string[]).map((date,i)=><div key={i} className="flex flex-wrap gap-2"><label>法定休日 {i+1}<input className={"ui-control "+(field)} type="date" required value={date} onChange={e=>change({statutory_holidays:(value.statutory_holidays as string[]).map((d,j)=>j===i?e.target.value:d)})}/></label><button type="button" className="ui-button ui-button-secondary" onClick={()=>change({statutory_holidays:(value.statutory_holidays as string[]).filter((_,j)=>i!==j)})}>この休日を除く</button></div>)}<button type="button" className="ui-button ui-button-secondary" onClick={()=>change({statutory_holidays:[...value.statutory_holidays as string[],'']})}>法定休日を追加</button></fieldset>
     {check('calendar_confirmed','週起算と法定休日を原本照合した')}
     <label className="block">法定休日の与え方<select className={"ui-control "+(field)} value={String(value.holiday_system??'weekly')} onChange={e=>change(e.target.value==='four_week'?{holiday_system:'four_week',four_week_start:''}:{holiday_system:'weekly',four_week_start:null})}><option value="weekly">毎週1日（週休制）</option><option value="four_week">4週4日（変形休日制）</option></select></label>
     {value.holiday_system==='four_week'&&dateInput('four_week_start','変形休日制の起算日（就業規則の定め）')}
     <label className="block">労働時間制度<select className={"ui-control "+(field)} value={String(value.working_time_system??'standard')} onChange={e=>change(workingTimeDefaults(e.target.value))}><option value="standard">通常の労働時間制</option><option value="monthly_variable">1か月以内の変形労働時間制（1か月単位・4週単位など）</option><option value="annual_variable">1年単位の変形労働時間制</option><option value="flex">フレックスタイム制</option></select></label>
     {value.working_time_system==='monthly_variable'&&<>{dateInput('variable_anchor','変形期間の起算日')}<label className="block">変形期間の日数（空欄なら起算日から1か月ごと。4週単位なら28。28日まで）<input className={"ui-control "+(field)} type="number" min={1} max={28} step={1} value={value.variable_period_days==null?'':String(value.variable_period_days)} onChange={e=>change({variable_period_days:e.target.value===''?null:Number(e.target.value)})}/></label><p>時間外は、日（所定が8時間超ならその所定）・週（所定が40時間超ならその所定）・変形期間（40時間×暦日数÷7。28日なら160時間）の順に判定します。29日以上の固定の周期は、2月をまたぐと1か月を超えるため指定できません。他社との兼業や制度の混在は未対応として公開を止めます。</p></>}
     {value.working_time_system==='annual_variable'&&<>{select('annual_calendar_id','適用するカレンダー（同じ事業場・週の起算曜日）',merged('annual_calendars','annual_calendar').filter(c=>c.establishment_id===value.establishment_id&&Number(c.week_start)===Number(value.week_start)).map(c=>({value:String(c.calendar_id),label:`${c.start} ～ ${c.end}`})))}<p>勤務はカレンダーの労働日に、その日の所定時間の範囲でだけ割り当てます。時間外は、日（所定が8時間超ならその所定）・週（所定が40時間超ならその所定）・対象期間（40時間×暦日数÷7）の順に判定し、対象期間が3か月を超える場合の36協定の限度は月42時間・年320時間です。途中入退社の清算時間は計算結果に示します（賃金は給与側）。</p></>}
     {value.working_time_system==='flex'&&<>{dateInput('flex_anchor','清算期間の起算日')}{select('flex_months','清算期間の長さ',[{value:'1',label:'1か月'},{value:'2',label:'2か月'},{value:'3',label:'3か月'}])}
      <label className="block"><input className="ui-choice" type="checkbox" checked={Boolean(value.flex_full_two_day_weekend)} onChange={e=>change({flex_full_two_day_weekend:e.target.checked})}/> 完全週休2日制の特例（労使協定により総枠を8時間×所定労働日数とする）</label>
      {Boolean(value.flex_full_two_day_weekend)&&<><fieldset className="workflow-fieldset border p-3"><legend>毎週の所定休日（2日以上）</legend>{['月','火','水','木','金','土','日'].map((day,i)=><label key={day} className="inline-block mr-4"><input className="ui-choice" type="checkbox" checked={((value.flex_rest_weekdays as number[])??[]).includes(i)} onChange={e=>change({flex_rest_weekdays:e.target.checked?[...((value.flex_rest_weekdays as number[])??[]),i].sort():((value.flex_rest_weekdays as number[])??[]).filter(v=>v!==i)})}/> {day}</label>)}</fieldset>
      <label className="block">その他の所定休日（1行に1日、YYYY-MM-DD）<textarea className={"ui-control "+(field)} value={((value.flex_other_rest_days as string[])??[]).join('\n')} onChange={e=>change({flex_other_rest_days:e.target.value.split('\n').map(v=>v.trim()).filter(Boolean)})}/></label></>}
      <p role="note">フレックスタイム制は、施設が就業規則と労使協定で採用し、別の管理者が確認した後に使えます。雇用条件は、本人の参加の開始日から、採用と同じ清算期間・起算日で登録してください（<a className="underline" href="/settings">施設の設定</a>）。フレックスタイム制では始業・終業の時刻を本人が決めるため（平30.9.7基発0907第1号）、時刻付きの勤務は割り当てません。実績から清算期間ごとに時間外を計算します（1か月を超える清算期間は、各月の週平均50時間超と、最終月の総枠超）。</p></>}
     {select('agreement_id','雇用関係に適用する協定',merged('agreements','agreement').filter(a=>a.employer_id===value.employer_id&&a.establishment_id===value.establishment_id).map(a=>({value:String(a.agreement_id),label:`${local(a.start)} ～ ${local(a.end)}`})),false)}
    </>}
    {kind==='management_model'&&<>
     {select('first_employer','先契約の雇用主',employerOptions)}{select('second_employer','後契約の雇用主',employerOptions.filter(e=>e.value!==value.first_employer))}{dateInput('month_anchor','管理モデルの月起算日')}
     {seconds('first_month_limit_seconds','先契約側の法定外時間上限')}{seconds('second_month_limit_seconds','後契約側の総労働時間上限')}
     <p>両雇用主の合意と通知をそれぞれ確認してください。3社以上や不明な混合方式を自動適用しません。</p>
    </>}
    {['leave_policy','leave_account','leave_obligation'].includes(kind)&&select('employer_id','年休を管理する雇用主',employerOptions)}
    {kind==='leave_policy'&&<>
     {check('hourly_enabled','時間単位年休を認める協定がある')}{check('half_day_enabled','半日単位の取得を認める')}{whole('hours_per_day','1日に相当する時間数',1,24)}{whole('hourly_quantum','時間年休の取得単位（時間）',1,24)}{whole('hourly_cap_days','年間の時間年休上限（日相当）',0,5)}{dateInput('hourly_year_start','時間年休上限の年起算日')}
     <p>換算変更は新しい規則として登録してください。1日を24時間とする換算は行いません。</p>
    </>}
    {kind==='leave_account'&&<>
     {dateInput('granted_on','原本の付与日')}{dateInput('expires_on','失効日（この日を含まない）')}{whole('granted_days','原本の付与日数')}{whole('statutory_days','うち法定付与日数')}
     <label className="block">外部人事の付与系列の参照（任意）<input className={"ui-control "+(field)} value={String(value.grant_cycle_id??'')} onChange={e=>change({grant_cycle_id:e.target.value||null})}/></label>
     <p>付与原本は上書きできません。日数の減額や訂正は「人事原本と照合して年休の付与・取得を訂正」で行います。</p>
    </>}
    {kind==='leave_record'&&<>
     {leaveAccountBase&&<p>確認した付与台帳の版：{leaveAccountBase.revision}。他の月の予約・取得も含む共有残高の変更を照合します。</p>}
     {select('account_id','対象の付与原本',accounts.map(a=>({value:String(a.account_id),label:`${personName(context,a.person_id)} ${a.granted_on}付与 ${a.granted_days}日`})))}
     {select('policy_id','対象者・雇用主の取得規則',policies.filter(p=>p.person_id===selectedAccount?.person_id&&p.employer_id===selectedAccount?.employer_id).map(p=>({value:String(p.policy_id),label:`${local(p.start)} ～ ${local(p.end)} 1日${p.hours_per_day}時間`})))}
     {select('kind','年休イベント',[{value:'reserve',label:'予約'},{value:'release',label:'予約を解除'},{value:'take',label:'実際に取得した'},{value:'reverse',label:'取得を取り消す'},{value:'expire',label:'失効'},{value:'conversion',label:'契約変更時の換算'}])}{select('unit','記録する取得単位',[{value:'day',label:'日'},{value:'half_day',label:'半日'},{value:'hour',label:'時間'}])}{whole('quantity','記録する数量',value.kind==='conversion'?0:1)}{dateInput('effective_on','イベントの効力日')}
     {['release','reverse'].includes(String(value.kind))&&select('related_event_id','解除・取消の元イベント',events.filter(e=>e.account_id===value.account_id&&e.kind===(value.kind==='release'?'reserve':'take')).map(e=>({value:String(e.event_id),label:`${e.effective_on} ${e.quantity} ${e.unit}`})))}
     <DateTimeField label="対象区間の開始（日本時間）" value={(value.interval as Payload|null)?.start} required={!['expire','conversion'].includes(String(value.kind))} onChange={next=>change({interval:{...(value.interval as Payload??{}),start:utc(next)}})}/><DateTimeField label="対象区間の終了（日本時間）" value={(value.interval as Payload|null)?.end} required={!['expire','conversion'].includes(String(value.kind))} onChange={next=>change({interval:{...(value.interval as Payload??{}),end:utc(next)}})}/>
     {value.kind==='conversion'&&<>{whole('conversion_old_hours','換算前の1日相当時間',1,24)}{whole('conversion_new_hours','換算後の1日相当時間',1,24)}</>}
     <p>予約を取得済みにしません。日・半日・時間を区別し、取消元は同じ付与原本の記録から選択します。</p>
    </>}
    {kind==='leave_obligation'&&<>
     {dateInput('start','管理期間の開始日')}{dateInput('end','管理期間の終了日（この日を含まない）')}{whole('required_half_days','必要な取得量（半日を1として記録）')}{select('method','基準日が重なる場合の管理方法',[{value:'separate',label:'基準日別に管理'},{value:'consolidated',label:'根拠を確認して期間を統合'},{value:'split_advance',label:'前倒し・分割付与の管理'}])}{select('rounding_unit','取得管理の単位',[{value:'day',label:'日単位'},{value:'half_day',label:'本人請求を確認した半日単位'}])}
     <fieldset className="workflow-fieldset border p-3"><legend>対象判定に用いた付与原本</legend>{accounts.filter(a=>a.person_id===value.person_id&&a.employer_id===value.employer_id).map(a=><label className="block" key={String(a.account_id)}><input className="ui-choice" type="checkbox" checked={(value.qualifying_grant_ids as string[]).includes(String(a.account_id))} onChange={e=>change({qualifying_grant_ids:e.target.checked?[...value.qualifying_grant_ids as string[],a.account_id]:(value.qualifying_grant_ids as string[]).filter(id=>id!==a.account_id)})}/> {String(a.granted_on)}付与 法定{String(a.statutory_days)}日</label>)}</fieldset>
     <p>時間単位年休は年5日取得へ算入しません。繰越残数から対象者を推定しません。</p>
    </>}
    {kind==='ledger_recording'&&<>
     {select('object_kind','記録日時を照合する原本の種類',[{value:'leave_account',label:'付与原本'},{value:'leave_record',label:'予約・取得等の原本'}])}{select('object_id','記録日時を付す原本',(value.object_kind==='leave_account'?accounts:events).map(a=>({value:String(a[value.object_kind==='leave_account'?'account_id':'event_id']),label:value.object_kind==='leave_account'?`${personName(context,a.person_id)} ${a.granted_on}付与`:`${a.effective_on} ${a.kind} ${a.quantity}${a.unit}`})))}
     {text('external_event_id','外部人事の原本イベント番号')}{whole('external_revision','外部人事の原本改定番号',1)}<DateTimeField label="原本を把握した日時（日本時間）" value={value.recorded_at} required onChange={next=>change({recorded_at:utc(next)})}/>
     <p>把握日時と効力日時を区別します。未来の把握日時や旧原本の上書きはできません。</p>
    </>}
    {kind==='agreement'&&<>
     <label className="block">協定を適用する事業場<select className={"ui-control "+(field)} required value={String(value.establishment_id??'')} onChange={e=>{const site=sites.find(s=>s.establishment_id===e.target.value);change({establishment_id:e.target.value,employer_id:site?.employer_id??''});}}><option value="">選択してください</option>{sites.map(site=><option key={String(site.establishment_id)} value={String(site.establishment_id)}>{employerName(site.employer_id)}（{local(site.start)} ～ {local(site.end)}）</option>)}</select></label>
     {dateInput('year_start','協定年の起算日')}{dateInput('month_anchor','協定月の起算日')}
     {seconds('daily_limit_seconds','協定の日時間外上限')}{seconds('monthly_limit_seconds','協定の月時間外上限',0,value.special_clause?(Number(base?.payload.monthly_limit_seconds)>=100*3600?Number(base?.payload.monthly_limit_seconds):100*3600-1):45*3600)}{seconds('annual_limit_seconds','協定の年時間外上限',0,value.special_clause?720*3600:360*3600)}
     {check('special_clause','特別条項の定めがある')}{check('holiday_work_permitted','休日労働を認める定めがある')}
     <p>協定の上限と、兼業通算する単月・複数月の法定上限は別に検証します。特別条項の設定だけで適用確認済みにはなりません。</p>
    </>}
    {kind==='rule_review'&&<>
     {select('rule_id','適用を確認する規則版',Array.from(new Set([context.rule_revision,...(context.rule_reviews??[]).map(r=>String(r.rule_id)),...context.records.filter(r=>r.kind==='rule_review').map(r=>String(r.payload.rule_id)),String(value.rule_id??'')].filter((v):v is string=>!!v))).map(v=>({value:v,label:v})))}
     {text('source_url','一次資料のURL')}{text('document_version','資料の版（改正日など）')}{text('source_sha256','取得した資料のSHA-256（16進64桁）')}{text('provision','照合した条項')}{text('transitional_provision','経過措置・非該当の理由')}
     {dateInput('reviewed_on','今回の確認日')}{dateInput('next_review_on','次回の確認期限')}
     <p>未確認の根拠を確認済みへ自動変更しません。次回確認期限は確認日より後にしてください。資料のハッシュを記録した確認には、影響を確かめた公開判断が必要です。</p>
    </>}
    {kind==='rule_decision'&&<>
     {select('review_id','判断する制度確認（資料のハッシュ付き）',(context.rule_reviews??[]).filter(r=>r.source_sha256).map(r=>({value:String(r.review_id),label:`${r.rule_id} ${r.provision}（資料 ${r.document_version??''}）`})))}
     <button type="button" className="ui-button ui-button-secondary" disabled={!value.review_id||busy} onClick={()=>loadImpact(String(value.review_id)).catch(e=>setError(errorText(e)))}>影響を表示する</button>
     {impact&&impact.review_id===value.review_id&&<div role="status" className="min-w-0 break-words [overflow-wrap:anywhere]"><p>旧い規則版で決まった記録：公開 {impact.publications.length}件・付与照合 {impact.grant_assessments.length}件・付与原本 {impact.grant_records.length}件（合計 {impact.impact_count}件）</p><ul>{impact.publications.map(p=><li key={p.publication_id}>公開 {p.period_key} 第{p.version}版（{p.rule_revision}）</li>)}{impact.grant_assessments.map((a,i)=><li key={`${a.assessment_id}-${a.as_of}-${i}`}>付与照合 {a.assessment_id}（{a.rule_revision}・{a.as_of}）</li>)}{impact.grant_records.map(r=><li key={r.account_id}>付与原本 {r.account_id}（付与日 {r.granted_on}）</li>)}</ul></div>}
     {select('decision','判断',[{value:'hold',label:'公開を保留する'},{value:'publish',label:'影響を確認したので公開する'}])}
     {dateInput('decided_on','判断日')}
     <p>判断は、表示した影響の一覧に結び付けて保存します。一覧が変わると保存も公開も止まるので、表示し直してから判断してください。</p>
    </>}
    {kind==='accounting_transition'&&<>
     <label className="block">切替前の雇用条件<select className={"ui-control "+(field)} required value={String(value.before_revision_id??'')} onChange={e=>change({before_revision_id:e.target.value,after_revision_id:''})}><option value="">選択してください</option>{employments.map(e=><option key={String(e.revision_id)} value={String(e.revision_id)}>{personName(context,e.person_id)} {employerName(e.employer_id)} {local(e.start)} ～ {local(e.end)}</option>)}</select></label>
     {select('after_revision_id','連続する切替後の雇用条件',nextEmployments.map(e=>({value:String(e.revision_id),label:`${personName(context,e.person_id)} ${local(e.start)} ～ ${local(e.end)}`})))}
     {select('calculation_basis','確認した集計方法',[{value:'effective_calendar_windows',label:'各制度の有効なカレンダー区間で集計'},{value:'preserve_overlapping_full_weeks',label:'重複する完全な週の集計を維持'}])}
     <p>同一人物・雇用関係・雇用主・事業場の隣接する改定だけを選択できます。短縮週の比例計算は行いません。</p>
    </>}
    {kind==='annual_calendar'&&<>
     {select('establishment_id','カレンダーを適用する事業場',context.establishments.map(e=>({value:String(e.establishment_id),label:`${employerName(e.employer_id)} ${e.establishment_id}`})))}
     {dateInput('start','対象期間の初日')}{dateInput('end','対象期間の終了日（この日を含まない。1か月超1年以内）')}{dateInput('first_period_end','最初の期間の終了日（この日を含まない。ここまでを日ごとに確定）')}
     {select('week_start','週の起算曜日',['月','火','水','木','金','土','日'].map((d,i)=>({value:String(i),label:d+'曜日'})))}
     <LinesField key={`days-${base.key}`} label="確定した労働日と所定時間（1行に1日：YYYY-MM-DD 時:分）" help="例：2026-04-01 8:00。載っていない確定部分の日は休日です。" initial={((value.days as {day:string;seconds:number}[])??[]).map(d=>`${d.day} ${clock(d.seconds)}`).join('\n')} parse={parseDays} onParsed={(items,errors)=>{change({days:items});setLineErrors(old=>({...old,days:errors}));}}/>
     <AnnualSegments value={(value.segments as AnnualSegment[])??[]} onChange={update=>{setValue(old=>old?{...old,segments:update((old.segments as AnnualSegment[])??[])}:old);setDirty(true);}}/>
     <LinesField key={`special-${base.key}`} label="特定期間（1行に1期間：開始日 終了日）" help="特に業務が繁忙な期間。連続労働は1週1日の休日の範囲（最長12日）まで。" initial={((value.special_periods as Payload[])??[]).map(p=>`${p.start} ${p.end}`).join('\n')} parse={parseRanges} onParsed={(items,errors)=>{change({special_periods:items});setLineErrors(old=>({...old,special:errors}));}}/>
     <p>1日10時間・1週52時間・総枠（40時間×暦日数÷7）・3か月超では年280日（按分）と48時間超の週の制限・連続労働6日（特定期間は12日）を、保存後の検証で確かめます。</p>
    </>}
    {kind==='site_attribution_decision'&&<>
     {select('employer_id','判断の対象とする雇用主（複数の事業場を持つ）',employers.map(e=>({value:e,label:employerName(e)})))}
     {select('reading','時間外を帰属させる順序',[{value:'scheduled_first',label:'所定労働を先に数え、所定外をその後に数える'},{value:'time_order',label:'事業場をまたいで働いた順に数える'}])}
     <label className="block">判断の理由と根拠（人事・法務）<textarea className={"ui-control "+(field)} required maxLength={2000} value={String(value.reason??'')} onChange={e=>change({reason:e.target.value})}/></label>
     <p>同じ雇用主の複数の事業場で働いた日に、どの事業場の36協定に時間外を帰属させるかの判断です。公式の定めはありません。確認済みの判断が勤務の期間全体を覆う場合だけ、選んだ順序で計算し、「未確認」を解除します。他社での勤務もある人には「所定労働を先に」だけを適用できます。</p>
    </>}
    {kind==='contract'&&<>
     {select('engagement','雇用形態',[{value:'direct',label:'直接雇用'},{value:'agency',label:'派遣'}])}{check('fixed_term','有期契約')}{select('time_category','勤務時間区分',[{value:'full_time',label:'常勤'},{value:'part_time',label:'短時間'}])}
     {select('regime','労働時間制度',[{value:'general',label:'一般制'},{value:'variable',label:'1か月単位の変形労働時間制（雇用条件の設定が必要。1年単位は未対応）'},{value:'flex',label:'フレックスタイム制（施設の設定で採用の確認が必要）'},{value:'exempt',label:'適用除外（根拠の確認が必要）'}])}
     <fieldset className="workflow-fieldset border p-3"><legend>勤務できる曜日</legend>{['月','火','水','木','金','土','日'].map((day,i)=><label key={day} className="inline-block mr-4"><input className="ui-choice" type="checkbox" checked={(value.allowed_weekdays as number[]).includes(i)} onChange={e=>change({allowed_weekdays:e.target.checked?[...value.allowed_weekdays as number[],i].sort():(value.allowed_weekdays as number[]).filter(v=>v!==i)})}/> {day}</label>)}</fieldset>
     <fieldset className="workflow-fieldset border p-3"><legend>勤務できる種類</legend>{Array.from(new Set([...duties.map(d=>d.kind),...(value.allowed_kinds as string[])])).map(k=><label key={k} className="block"><input className="ui-choice" type="checkbox" checked={(value.allowed_kinds as string[]).includes(k)} onChange={e=>change({allowed_kinds:e.target.checked?[...value.allowed_kinds as string[],k]:(value.allowed_kinds as string[]).filter(v=>v!==k)})}/> {k}</label>)}</fieldset>
     {seconds('period_min_seconds','対象期間の契約下限')}{seconds('period_max_seconds','対象期間の契約上限')}{seconds('contractual_week_seconds','週の所定労働時間',1)}{seconds('rest_seconds','勤務間休息時間')}
     <label className="block">最大連続勤務日数<input className={"ui-control "+(field)} type="number" required min="1" step="1" value={Number(value.max_consecutive_days)} onChange={e=>change({max_consecutive_days:Number(e.target.value)})}/></label>
     {check('external_work_confirmed','兼業の有無と勤務情報を確認した')}
     {select('overtime_agreement_id','適用する協定（任意）',[...context.records.filter(r=>r.kind==='agreement').map(r=>({value:String(r.payload.agreement_id),label:`${r.payload.employer_id} ${local(r.payload.start)} ～ ${local(r.payload.end)}`})),...(value.overtime_agreement_id&&!context.records.some(r=>r.kind==='agreement'&&r.payload.agreement_id===value.overtime_agreement_id)?[{value:String(value.overtime_agreement_id),label:'現在の契約に指定された協定'}]:[])],false)}
     {value.engagement==='agency'&&<><fieldset className="workflow-fieldset border p-3"><legend>派遣を認める業務</legend>{Array.from(new Set([...duties.map(d=>d.task),...(value.dispatch_tasks as string[]??[])])).map(task=><label className="block" key={task}><input className="ui-choice" type="checkbox" checked={(value.dispatch_tasks as string[]??[]).includes(task)} onChange={e=>change({dispatch_tasks:e.target.checked?[...(value.dispatch_tasks as string[]??[]),task]:(value.dispatch_tasks as string[]??[]).filter(v=>v!==task)})}/> {task}</label>)}</fieldset></>}
    </>}
    {kind==='capability'&&<><p>資格内容の変更は別記録として追加します。既存資格の取消・失効は登録する業務から「資格の取消・失効」を選んでください。</p>{select('task','担当業務',Array.from(new Set([...duties.map(d=>d.task),String(value.task??'')])).filter(Boolean).map(v=>({value:v,label:v})))}{select('location','勤務場所',Array.from(new Set([...duties.map(d=>d.location),String(value.location??'')])).filter(Boolean).map(v=>({value:v,label:v})))}{check('supervision_required','監督者の配置が必要')}<label className="block">同時に監督できる人数<input className={"ui-control "+(field)} type="number" min="0" step="1" required value={Number(value.supervisor_capacity)} onChange={e=>change({supervisor_capacity:Number(e.target.value)})}/></label></>}
    {(kind==='employment'?['declaration',...(['monthly_variable','flex'].includes(String(value.working_time_system))?['variable_evidence']:[])]:kind==='management_model'?['first_consent','second_consent','notification']:kind==='leave_obligation'&&value.rounding_unit==='half_day'?['evidence','half_day_request_evidence']:kind==='contract'?['evidence','regime_evidence',...(value.engagement==='agency'?['dispatch_evidence']:[])]:kind==='agreement'&&value.special_clause?['evidence','invocation_evidence']:['evidence']).map(key=><EvidenceInput key={key} name={evidenceNames[key]} value={value[key] as Evidence??emptyEvidence()} onChange={patch=>{setValue(old=>old?{...old,[key]:{...((old[key] as Evidence|null)??emptyEvidence()),...patch}}:old);setDirty(true);}}/>)}
   </>}
   {conflict&&<section role="alert" className="workflow-panel border p-3 space-y-2"><h4>競合した内容の確認</h4>{kind==='leave_record'&&<p>共有残高の版：選択時 {leaveAccountBase?.revision??'未確認'} → 現在 {conflict.revision}。別月・別操作の予約や取得も含めて再確認してください。</p>}{[[kind==='leave_record'?'選択時の付与台帳':'編集開始時',kind==='leave_record'?leaveAccountBase?.payload??{}:base.payload],[kind==='leave_record'?'現在の付与台帳':'現在の保存内容',conflict.payload],[kind==='leave_record'?'追加する休暇イベント':'編集中の内容',value]].map(([title,payload])=><div key={String(title)}><h5>{String(title)}</h5><p className="whitespace-pre-wrap break-words">{description(payload as Payload,context)}</p></div>)}<button type="button" className="ui-button ui-button-secondary" onClick={()=>{if(kind==='leave_record')setLeaveAccountBase(conflict);else setBase(conflict);setConflict(null);retry.current=null;setMessage('現在版と差分を確認しました。保存ボタンで編集中の内容を送信してください。');}}>三つの内容を確認し、編集中の内容を保持</button></section>}
   <button className="ui-button ui-button-primary" disabled={!!conflict}>この内容を保存・再送</button><button className="ui-button ui-button-secondary ml-2" type="button" onClick={()=>{setValue(structuredClone(base.payload));setDirty(false);setConflict(null);retry.current=null;}}>未保存の内容を破棄</button>
   {dirty&&<p role="status">未保存の変更があります。</p>}
  </fieldset></form>}
  </div></div>
 </section>;
}
