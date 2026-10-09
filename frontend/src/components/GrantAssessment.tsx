"use client";
import {useRef, useState} from 'react';
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';
import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
type Account={account_id:string;person_id:string;employer_id:string;granted_on:string;statutory_days:number;grant_cycle_id?:string|null};
type Context={input_hash:string;source_revision:number;accounts:Account[];findings:unknown[]};
type Result={status:string;computed_status?:string;expected_statutory_days:number|null;imported_statutory_days:number;findings:string[];source:string;guidance?:{version:string;basis_before_revision:boolean;confirmed:boolean|null}};
// Revision of the MHLW シフト制 guidance that states the actual-days method (2(4)ウ(ｱ)).
const GUIDANCE_REVISION='2026-06-19';
export default function GrantAssessment({scope}:{scope:string}){
 const [context,setContext]=useState<Context|null>(null),[accountId,setAccountId]=useState(''),[basis,setBasis]=useState('weekly'),[period,setPeriod]=useState('first_six_months');
 const [busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null);
 const retry=useRef<{canonical:string;body:string}|null>(null);
 const account=context?.accounts.find(a=>a.account_id===accountId);
 const cycle=account?.grant_cycle_id?context?.accounts.filter(a=>a.grant_cycle_id===account.grant_cycle_id&&a.person_id===account.person_id&&a.employer_id===account.employer_id)??[]:[];
 // Links, reload and tracked back/forward share the application's unsaved-change guard.
 useUnsavedNavigation(dirty);
 async function load(){setBusy(true);setError('');try{const response=await fetch(`${API}/planning/compliance/grant-assessments/context?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('照合対象を取得できません。権限と入力版を確認してください。');setContext(await response.json());setAccountId('');setResult(null);retry.current=null;}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 const input='block w-full min-w-0 max-w-full';
 return <details><summary>人事原本から通常・比例付与を照合</summary>
 <p>人事が確認した勤続・出勤率・所定勤務を入力し、法定付与の表と照合します。付与の自動登録や請求の自動拒否は行いません。前倒し・分割付与は、同一雇用主の付与系列全体と人事が確認した基準日を照合します。</p>
 <button type="button" className="ui-button ui-button-secondary" disabled={busy||dirty} onClick={()=>void load()}>最新の付与原本を読み込む</button>
 {context&&<form className="space-y-3 mt-3" onChange={()=>{setDirty(true);setResult(null);}} onSubmit={async e=>{e.preventDefault();if(!account)return;const fields=new FormData(e.currentTarget);
 const payload={account_id:account.account_id,person_id:account.person_id,employer_id:account.employer_id,basis_date:cycle.length?String(fields.get('cycleBasis')):account.granted_on,completed_service_months:Number(fields.get('months')),scheduled_week_seconds:Number(fields.get('weeklyHours'))*3600+Number(fields.get('weeklyMinutes'))*60+Number(fields.get('weeklySeconds')),schedule_basis:basis,scheduled_week_days:basis==='weekly'?Number(fields.get('days')):null,scheduled_year_days:basis==='annual'?Number(fields.get('days')):null,...(basis==='shift_actual'?{actual_work_days:Number(fields.get('actualDays')),actual_period:String(fields.get('actualPeriod')),guideline_year_days:fields.get('guidelineDays')?Number(fields.get('guidelineDays')):null,...(fields.get('guidanceReference')&&String(cycle.length?fields.get('cycleBasis'):account.granted_on)<GUIDANCE_REVISION?{guidance_confirmation:{reference:String(fields.get('guidanceReference')),verified_by:String(fields.get('verifier')),status:'verified'}}:{})}:{}),attendance_days:Number(fields.get('attended')),attendance_denominator:Number(fields.get('denominator')),evidence:{reference:String(fields.get('reference')),verified_by:String(fields.get('verifier')),status:'verified'}};
 const series=cycle.length?{...payload,cycle_account_ids:cycle.map(a=>a.account_id),cycle_evidence:{reference:String(fields.get('cycleReference')),verified_by:String(fields.get('verifier')),status:'verified'}}:payload;
 const canonical=JSON.stringify({payload:series,input_hash:context.input_hash,expected_revision:context.source_revision});if(retry.current?.canonical!==canonical)retry.current={canonical,body:JSON.stringify({payload:{...series,assessment_id:crypto.randomUUID()},input_hash:context.input_hash,expected_revision:context.source_revision,idempotency_key:crypto.randomUUID()})};
 setBusy(true);setError('');setResult(null);try{const response=await fetch(`${API}/planning/compliance/grant-assessments?scope_id=${encodeURIComponent(scope)}`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:retry.current.body});if(!response.ok)throw new Error(response.status===409?'原本または訂正履歴が変わりました。入力を破棄して最新の原本を読み直してください。':'照合を完了できませんでした。入力を確認し、応答断の場合は同じ内容で再送してください。');setResult(await response.json());setDirty(false);}catch(e){setError(errorText(e));}finally{setBusy(false);}}}>
 <fieldset disabled={busy||!!context.findings.length} className="workflow-fieldset space-y-3 min-w-0">
 <label className="block">照合する付与ロット<select value={accountId} onChange={e=>setAccountId(e.target.value)} required className={"ui-control "+(input)}><option value="">選択してください</option>{context.accounts.map(a=><option key={a.account_id} value={a.account_id}>{a.account_id}（{a.person_id}・{a.employer_id}）</option>)}</select></label>
 {account&&<p>基準日 {account.granted_on}／取込済み法定付与 {account.statutory_days}日</p>}
 {cycle.length>0&&<fieldset className="workflow-fieldset border space-y-2 min-w-0"><legend>前倒し・分割付与の系列照合</legend>
 <ul>{cycle.map(a=><li key={a.account_id}>{a.granted_on}：法定 {a.statutory_days} 日（{a.account_id}）</li>)}</ul>
 <label className="block">人事が確認した付与基準日<input name="cycleBasis" type="date" required className={"ui-control "+(input)}/></label>
 <label className="block">系列全体の人事原本参照<input name="cycleReference" required className={"ui-control "+(input)}/></label>
 <label className="flex items-start gap-2 min-h-6"><input type="checkbox" required className="ui-choice w-6 h-6 shrink-0"/><span>表示された系列に未取込・未確認の付与がないことを原本と照合しました</span></label>
 </fieldset>}
 <label className="block">確認済み勤続月数<input name="months" type="number" min="0" step="1" required className={"ui-control "+(input)}/></label>
 <label className="block">週の所定労働時間<input name="weeklyHours" type="number" min="0" step="1" required className={"ui-control "+(input)}/></label>
 <label className="block">週の所定労働時間の端数（分）<input name="weeklyMinutes" type="number" min="0" max="59" step="1" defaultValue="0" required className={"ui-control "+(input)}/></label>
 <label className="block">週の所定労働時間の端数（秒）<input name="weeklySeconds" type="number" min="0" max="59" step="1" defaultValue="0" required className={"ui-control "+(input)}/></label>
 <label className="block">所定日数の基準<select value={basis} onChange={e=>setBasis(e.target.value)} className={"ui-control "+(input)}><option value="weekly">週の所定日数</option><option value="annual">年の所定日数</option><option value="shift_actual">シフト制で所定日数を定めがたい（労働日数の実績）</option></select></label>
 {basis==='shift_actual'?<fieldset className="workflow-fieldset border space-y-2 min-w-0"><legend>シフト制の労働日数の実績（厚生労働省 留意事項 2026年6月改訂）</legend>
 <p>初回の付与（雇入れ6か月）は雇入れから6か月の実績を2倍、以降の付与は前年の実績を、年の所定労働日数とみなします。</p>
 <label className="block">実績の期間<select name="actualPeriod" required value={period} onChange={e=>setPeriod(e.target.value)} className={"ui-control "+(input)}><option value="first_six_months">雇入れから6か月（2倍して計算）</option><option value="previous_year">前年</option></select></label>
 <label className="block">労働日数の実績（人事確認済み）<input name="actualDays" type="number" min="0" max={period==='first_six_months'?184:366} step="1" required className={"ui-control "+(input)}/></label>
 <label className="block">目安となる労働日数（定めがある場合のみ・年間に換算した日数）<input name="guidelineDays" type="number" min="1" max="366" step="1" className={"ui-control "+(input)}/></label>
 <p>目安となる日数は、実績で計算した付与日数より多くなる場合に限り使います。</p>
 {(cycle.length>0||(account&&account.granted_on<GUIDANCE_REVISION))&&<label className="block">改正前（{GUIDANCE_REVISION}より前）の基準日にこの方法を使ったことの人事の確認記録（参照。基準日が改正後の場合は送りません）<input name="guidanceReference" className={"ui-control "+(input)}/></label>}</fieldset>
 :<label className="block">{basis==='weekly'?'週の所定労働日数':'年の所定労働日数'}<input name="days" type="number" min="1" max={basis==='weekly'?7:366} step="1" required className={"ui-control "+(input)}/></label>}
 <label className="block">出勤率の分子（人事確認済み日数）<input name="attended" type="number" min="0" step="1" required className={"ui-control "+(input)}/></label>
 <label className="block">出勤率の分母（人事確認済み日数）<input name="denominator" type="number" min="1" step="1" required className={"ui-control "+(input)}/></label>
 <label className="block">付与照合の原本参照<input name="reference" required className={"ui-control "+(input)}/></label>
 <label className="block">付与照合の確認者<input name="verifier" required className={"ui-control "+(input)}/></label>
 <button className="ui-button ui-button-secondary" disabled={!account}>通常・比例付与を照合して記録</button></fieldset>
 <button className="ui-button ui-button-secondary" type="button" disabled={busy} onClick={()=>{setContext(null);setDirty(false);setResult(null);retry.current=null;}}>未保存の付与照合を破棄</button>
 {!!context.findings.length&&<p role="alert">付与の訂正履歴に未解消の差異があります。先に人事原本を照合してください。</p>}</form>}
 {dirty&&<p role="status">未保存の付与照合があります。</p>}{busy&&<p role="status">付与照合を処理中…</p>}{error&&<p role="alert">{error}</p>}
 {result&&<div role="status"><p>{result.status==='pass'?'照合一致':result.status==='mismatch'?'付与原本との不一致：人事確認が必要です':'この条件では未確認：人事確認が必要です'}</p><p>表による法定付与：{result.expected_statutory_days??'未算定'}日／原本：{result.imported_statutory_days}日</p>{result.guidance?.basis_before_revision&&!result.guidance.confirmed&&<p>基準日が留意事項の改正（{result.guidance.version}）より前です。当時、実績による方法の公的な記載は訪問介護向けの通達（平16.8.27基発0827001号）だけでした。人事の確認記録が必要です。{result.computed_status&&`計算上の判定：${result.computed_status==='pass'?'一致':'不一致'}`}</p>}<a className="underline" href={result.source}>厚生労働省の付与表</a></div>}
 </details>;
}
