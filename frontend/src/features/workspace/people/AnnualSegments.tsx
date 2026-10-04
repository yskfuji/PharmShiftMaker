"use client";

type Consent = {reference:string;status:'unverified'|'verified'|'rejected';verified_by:string|null;valid_until:string|null};
export type AnnualSegment = {start:string;end:string;working_days:number;total_seconds:number;fixed_on:string|null;consent:Consent|null};
const field='block w-full min-w-0 max-w-full';
const date=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function segmentErrors(segments:AnnualSegment[]):string[]{
 return segments.flatMap((s,i)=>{
  const errors:string[]=[];
  if(!date(s.start)||!date(s.end)||s.start>=s.end)errors.push('開始日・終了日を確認してください');
  if(!Number.isSafeInteger(s.working_days)||s.working_days<0||!Number.isSafeInteger(s.total_seconds)||s.total_seconds<0)errors.push('日数・総労働時間は0以上の整数で入力してください');
  if(s.fixed_on!==null&&!date(s.fixed_on))errors.push('確定日を確認してください');
  if(Boolean(s.fixed_on)!==Boolean(s.consent))errors.push('確定日と同意の資料を確認してください');
  if(s.consent){const c=s.consent;
   if(!['unverified','verified','rejected'].includes(c.status)||!c.reference.trim()||(c.status==='verified'&&!c.verified_by?.trim()))errors.push('同意の状態・資料・確認責任者を確認してください');
   if(c.valid_until!==null&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(c.valid_until)||!date(c.valid_until.slice(0,10))||!Number.isFinite(Date.parse(c.valid_until))))errors.push('有効期限は時差付きの日時で入力してください');
  }
  return errors.map(e=>`区分期間${i+1}：${e}`);
 });
}

/** Field-level updates preserve untouched source values; no delimiter-based evidence parsing. */
export default function AnnualSegments({value,onChange}:{value:AnnualSegment[];onChange:(update:(previous:AnnualSegment[])=>AnnualSegment[])=>void}){
 const update=(index:number,patch:Partial<AnnualSegment>)=>onChange(old=>old.map((s,i)=>i===index?{...s,...patch}:s));
 const evidence=(index:number,patch:Partial<Consent>)=>onChange(old=>old.map((s,i)=>i===index&&s.consent?{...s,consent:{...s.consent,...patch}}:s));
 const errors=segmentErrors(value);
 return <section aria-label="区分期間" className="min-w-0 space-y-3">
  <h3>区分期間</h3><p>同意の資料・確認状態・有効期限を別々に入力します。総労働時間は整数秒で保持し、期限がない場合は空欄にします。法的な適用条件は保存後の検証で確認します。</p>
  {value.map((s,i)=><fieldset key={i} className="workflow-fieldset border p-3 min-w-0 space-y-2"><legend>区分期間{i+1}</legend>
   {(['start','end','fixed_on'] as const).map((key,j)=><label key={key} className="block">{`区分期間${i+1}の${['開始日','終了日（含まない）','確定日（任意）'][j]}`}<input className={"ui-control "+(field)} type="date" value={s[key]??''} onChange={e=>update(i,{[key]:e.target.value||(key==='fixed_on'?null:'')})}/></label>)}
   {(['working_days','total_seconds'] as const).map((key,j)=><label key={key} className="block">{`区分期間${i+1}の${['労働日数','総労働時間（秒）'][j]}`}<input className={"ui-control "+(field)} type="number" min="0" step="1" required value={Number.isFinite(s[key])?s[key]:''} onChange={e=>update(i,{[key]:e.target.value===''?NaN:Number(e.target.value)})}/></label>)}
   <label className="block"><input className="ui-choice" type="checkbox" checked={s.consent!==null} onChange={e=>update(i,{consent:e.target.checked?{reference:'',status:'unverified',verified_by:null,valid_until:null}:null})}/>{`区分期間${i+1}の同意資料を記録する`}</label>
   {s.consent&&<>
    <label className="block">{`区分期間${i+1}の同意状態`}<select className={"ui-control "+(field)} value={s.consent.status} onChange={e=>evidence(i,{status:e.target.value as Consent['status']})}><option value="unverified">未確認</option><option value="verified">確認済み</option><option value="rejected">不採用</option></select></label>
    <label className="block">{`区分期間${i+1}の資料名・参照先`}<input className={"ui-control "+(field)} value={s.consent.reference} onChange={e=>evidence(i,{reference:e.target.value})}/></label>
    <label className="block">{`区分期間${i+1}の確認責任者`}<input className={"ui-control "+(field)} value={s.consent.verified_by??''} onChange={e=>evidence(i,{verified_by:e.target.value||null})}/></label>
    <label className="block">{`区分期間${i+1}の有効期限（時差付き・任意）`}<input className={"ui-control "+(field)} placeholder="2026-06-01T00:00:00+09:00" value={s.consent.valid_until??''} onChange={e=>evidence(i,{valid_until:e.target.value||null})}/></label>
   </>}
   <button type="button" className="ui-button ui-button-danger" onClick={()=>onChange(old=>old.filter((_,n)=>n!==i))}>{`区分期間${i+1}を削除`}</button>
  </fieldset>)}
  <button type="button" className="ui-button ui-button-secondary" onClick={()=>onChange(old=>[...old,{start:'',end:'',working_days:0,total_seconds:0,fixed_on:null,consent:null}])}>区分期間を追加</button>
  {errors.length>0&&<p role="alert">{errors.join('、')}</p>}
 </section>;
}
