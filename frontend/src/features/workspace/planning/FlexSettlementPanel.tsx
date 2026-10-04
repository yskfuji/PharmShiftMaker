"use client";
import {useEffect,useId,useState} from 'react';
import {findingStatus,findingText} from '@/lib/findingText';

import {API_BASE_URL as API} from '@/lib/apiTarget';
type Settlement={kind:'flextime'|'flextime_part';start:string;end:string;frame_seconds:number;worked_seconds:number;
  monthly_overtime_seconds?:Record<string,number>;final_month_overtime_seconds?:number;unattributed_seconds?:number;
  overtime_counted_seconds?:number;settlement_seconds?:number;employment_revision?:string};
type Result={input_hash:string;people:{person_id:string;name:string;settlements:Settlement[]}[];findings:{status:string;message:string;rule_id:string}[]};

/** Seconds as h:mm (no rounding up of hours worked). */
export const hm=(seconds:number)=>`${Math.floor(seconds/3600)}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}`;
// The end date is exclusive on the server; people read the last day.
const lastDay=(end:string)=>new Date(new Date(end+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
const monthly=(s:Settlement)=>Object.values(s.monthly_overtime_seconds??{}).reduce((a,b)=>a+b,0);

/**
 * Flextime settlement per person and settlement period, from the registered input
 * (read only; Art. 32-3: hours beyond the frame, and for periods over one month each
 * month's hours beyond a 50h weekly average plus the final month's addition).
 */
export default function FlexSettlementPanel({scope,inputHash}:{scope:string;inputHash:string}){
  const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(''),heading=useId();
  useEffect(()=>{let live=true;setResult(null);setError('');
    fetch(`${API}/planning/compliance/flex-settlements?scope_id=${encodeURIComponent(scope)}&input_hash=${encodeURIComponent(inputHash)}`,{credentials:'include',cache:'no-store'})
      .then(async r=>{if(!r.ok)throw new Error(`フレックスタイム制の清算を取得できませんでした（${r.status}）。`);const body:Result=await r.json();if(live)setResult(body);})
      .catch(e=>{if(live)setError(String(e instanceof Error?e.message:e));});
    return()=>{live=false;};},[scope,inputHash]);
  return <section aria-labelledby={heading} className="space-y-3 min-w-0">
    <h3 id={heading} className="text-lg font-semibold">フレックスタイム制の清算</h3>
    <p>実績の労働時間から、清算期間ごとに計算します。時刻付きの勤務は割り当てません。</p>
    {error&&<p role="alert">{error}</p>}
    {!result&&!error&&<p role="status">清算を計算しています…</p>}
    {result&&result.people.every(p=>!p.settlements.length)&&<p>清算の対象となる実績はまだありません。</p>}
    {result&&result.people.some(p=>p.settlements.length>0)&&<div className="overflow-auto" role="region" aria-label="清算の一覧（横スクロール可能）" tabIndex={0}>
      <table className="ui-data-table w-full min-w-[40rem] border text-left text-base">
        <caption className="text-left p-2">職員別・清算期間別の総枠と実労働（時間:分）</caption>
        <thead><tr>{['職員','清算期間','総枠','実労働','各月の時間外（週平均50時間超）','最終月に加える時間外','割り当てられない時間外'].map(h=><th key={h} scope="col" className="p-2 align-bottom">{h}</th>)}</tr></thead>
        <tbody>{result.people.flatMap(p=>p.settlements.map(s=><tr key={p.person_id+s.kind+s.start} className="border-t">
          <th scope="row" className="p-2 font-normal">{p.name}</th>
          <td className="p-2">{s.start} 〜 {lastDay(s.end)}{s.kind==='flextime_part'&&'（途中入社・退職の部分）'}</td>
          <td className="p-2">{hm(s.frame_seconds)}</td><td className="p-2">{hm(s.worked_seconds)}</td>
          <td className="p-2">{s.kind==='flextime'?hm(monthly(s)):'—'}</td>
          <td className="p-2">{s.kind==='flextime'?hm(s.final_month_overtime_seconds??0):hm(s.settlement_seconds??0)}</td>
          <td className="p-2">{s.kind==='flextime'&&s.unattributed_seconds?hm(s.unattributed_seconds):'—'}</td>
        </tr>))}</tbody>
      </table></div>}
    {result&&result.findings.length>0&&<><h4 className="font-semibold">確認が必要な点</h4><ul className="space-y-1">{result.findings.map((f,i)=><li key={i} className="border rounded-control p-3">{findingStatus(f.status)}：{findingText(f.message)}</li>)}</ul></>}
  </section>;
}
