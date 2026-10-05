"use client";
import {useRef, useState} from 'react';
import {leaveGrant,LeaveReference,type LeaveIdentityFields} from './LeaveIdentity';
import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
type Balance=LeaveIdentityFields&{account_id:string;remaining_days:{numerator:number;denominator:number};reserved_days:{numerator:number;denominator:number}};
type Result={balances:Balance[];requires_hr_reconciliation?:boolean;findings:{message:string}[];amendment_trace?:{amendment_id:string;previous_days?:number;corrected_days?:number;event_id?:string;previous_event?:{unit:string;quantity:number}|null;corrected_event?:{unit:string;quantity:number}|null;reason:string}[]};
export default function LedgerHistory({scope}:{scope:string}) {
 const [result,setResult]=useState<Result|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const sequence=useRef(0);
 return <details><summary>過去時点の年休台帳と訂正履歴を確認</summary><p>対象日と、その時点で把握していた記録の締切を分けます。元記録の日時が不明な場合は未確認になります。</p>
 <form className="space-y-3" onSubmit={async e=>{e.preventDefault();const fields=new FormData(e.currentTarget);const current=++sequence.current;setBusy(true);setError('');setResult(null);try{const query=new URLSearchParams({scope_id:scope,effective_at:String(fields.get('effective')),known_at:String(fields.get('known'))+':00+09:00'});const response=await fetch(`${API}/planning/compliance/leave-report?${query}`,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error('台帳を照会できません。版3の入力と記録日時を確認してください。');const data=await response.json();if(current===sequence.current)setResult(data);}catch(e){setError(errorText(e));}finally{setBusy(false);}}}>
 <label className="block">対象日<input name="effective" required type="date" className="ui-control block max-w-full"/></label>
 <label className="block">記録の締切（日本時間）<input name="known" required type="datetime-local" className="ui-control block max-w-full"/></label>
 <button className="ui-button ui-button-secondary" disabled={busy}>指定時点の台帳を照会</button></form>
 {busy&&<p role="status">照会中…</p>}{error&&<p role="alert">{error}</p>}
 {result&&<div aria-live="polite">{result.requires_hr_reconciliation&&<p role="alert">残高または記録の整合性を確認する必要があります。元の履歴を保持したまま人事担当者へ照合してください。</p>}
 <p>氏名・雇用主名は現在の登録名です。残高と訂正履歴は指定した対象日・記録締切で計算しています。</p><ul aria-label="過去時点の年休残高">{result.balances.map(b=><li className="break-words" key={b.account_id} data-account-id={b.account_id}><p>{leaveGrant(b)}</p><p>残高 {b.remaining_days.numerator}/{b.remaining_days.denominator} 日、予約 {b.reserved_days.numerator}/{b.reserved_days.denominator} 日</p><LeaveReference kind="付与ロット" value={b.account_id}/></li>)}</ul>
 <ul aria-label="年休訂正の履歴">{result.amendment_trace?.map(a=><li key={a.amendment_id}>{a.event_id ? `取得記録 ${a.event_id}：${a.previous_event?.quantity ?? 0} ${a.previous_event?.unit ?? '取消済み'} → ${a.corrected_event ? `${a.corrected_event.quantity} ${a.corrected_event.unit}` : '取消'}` : `${a.previous_days}日 → ${a.corrected_days}日`}：{a.reason}</li>)}</ul>
 {result.findings.length>0&&<p role="alert">根拠未確認または不整合が {result.findings.length} 件あります。この照会を確定残高と扱わないでください。</p>}</div>}
 </details>;
}
