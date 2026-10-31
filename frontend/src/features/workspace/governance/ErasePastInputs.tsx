"use client";

import {useRef, useState} from 'react';
import {API_BASE_URL} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
import useUnsavedNavigation from '../shared/useUnsavedNavigation';

type Candidate = {input_hash:string; input_revision:number; period:{start:string;end:string}; erasable:boolean; blockers:string[]; target_count:number};
type Listing = {observed_at:string; inputs:Candidate[]};
type Plan = {plan_id:string; fingerprint:string; input_hash:string; erasable:boolean; targets:{table:string;key:string;hash:string}[]; blockers:string[]; limitations:string[]};

/** Display server decisions; never infer expiry or erasure permission in the browser. */
export default function ErasePastInputs({scope}:{scope:string}) {
  const [listing,setListing]=useState<Listing|null>(null);
  const [chosen,setChosen]=useState('');
  const [plan,setPlan]=useState<Plan|null>(null);
  const [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [uncertain,setUncertain]=useState(false);
  const pending=useRef<{action:string;body:string}|null>(null);
  useUnsavedNavigation(Boolean(plan)||uncertain);
  const url=(action:string)=>`${API_BASE_URL}/planning/compliance/erasure-${action}?scope_id=${encodeURIComponent(scope)}`;

  async function load() {
    setBusy(true);setError('');
    try {
      const response=await fetch(url('candidates'),{credentials:'include',cache:'no-store'});
      if(!response.ok)throw new Error('対象を取得できません。権限・利用制限・接続を確認してください。');
      const result:Listing=await response.json();
      if(!Array.isArray(result.inputs)||!result.observed_at)throw new Error('対象一覧の応答を確認できません。');
      setListing(result);setPlan(null);setChosen('');setConsent(false);
    } catch(e) {setError(errorText(e));} finally {setBusy(false);}
  }

  async function send(action:'preview'|'execute') {
    if(action==='preview'&&!chosen)return;
    if(action==='execute'&&(!plan||plan.erasable!==true||!consent))return;
    if(pending.current&&pending.current.action!==action)return;
    const payload=action==='preview'?{input_hash:chosen}:{plan_id:plan!.plan_id,fingerprint:plan!.fingerprint};
    if(!pending.current)pending.current={action,body:JSON.stringify({expected_revision:0,payload,idempotency_key:crypto.randomUUID()})};
    setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch(url(action),{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:pending.current.body});
      if(response.status===409) {
        pending.current=null;setUncertain(false);setPlan(null);setConsent(false);
        throw new Error('対象・保存規則・保全が変わりました。一覧を再取得して、消去計画を作り直してください。');
      }
      if(!response.ok)throw new Error(`処理結果を確認できません（${response.status}）。内容を変えず同じ操作を再送してください。`);
      const result=await response.json();
      if(action==='preview') {
        if(result.input_hash!==chosen||typeof result.erasable!=='boolean'||!result.plan_id||!result.fingerprint||!Array.isArray(result.targets)||!Array.isArray(result.blockers)||!Array.isArray(result.limitations))throw new Error('消去計画の応答を確認できません。');
        setPlan(result);setConsent(false);
      } else {
        if(result.plan_id!==plan!.plan_id||result.status!=='EXECUTED'||typeof result.duplicate!=='boolean'||(!result.duplicate&&(!Number.isInteger(result.deleted)||result.deleted<0)))throw new Error('実行結果の照合に失敗しました。');
        setMessage(result.duplicate?'同じ計画は既に実行済みです。新たな消去は行われていません。':`消去を実行しました。対象記録 ${result.deleted}件。バックアップ等の全コピー消去を意味しません。`);
        setPlan(null);setListing(null);setChosen('');setConsent(false);
      }
      pending.current=null;setUncertain(false);
    } catch(e) {setUncertain(Boolean(pending.current));setError(errorText(e));} finally {setBusy(false);}
  }

  return <section aria-label="過去勤務入力の消去" className="workflow-panel space-y-3">
    <h3>過去勤務入力の消去</h3>
    <ol><li>対象と保存条件を確認</li><li>消去計画を作成</li><li>消去対象を確認して実行</li></ol>
    <p>一覧取得と計画作成では消去しません。実行すると勤務入力と参照する計画案・公開版等を取り消せない形で消去します。</p>
    <button className="ui-button ui-button-secondary" disabled={busy||uncertain||Boolean(plan)} onClick={()=>void load()}>過去勤務入力の一覧を取得</button>
    {listing&&<>
      <p>観測時点：<time>{listing.observed_at}</time></p>
      {listing.inputs.length===0?<p>対象の勤務入力はありません。</p>:<>
        <label className="block">確認する勤務入力<select className="ui-control block w-full" value={chosen} disabled={busy||uncertain||Boolean(plan)} onChange={e=>setChosen(e.target.value)}>
          <option value="">選択してください</option>
          {listing.inputs.map(item=><option key={item.input_hash} value={item.input_hash}>{item.period.start}〜{item.period.end}・第{item.input_revision}版</option>)}
        </select></label>
        {listing.inputs.filter(item=>item.input_hash===chosen).map(item=><p key={item.input_hash}>{item.erasable===true?'サーバー判定：消去可能':item.erasable===false?`サーバー判定：消去不可（${item.blockers.join('、')}）`:'消去可否は未確認'}／計画候補 {item.target_count}件</p>)}
        {!plan&&<button className="ui-button ui-button-secondary" disabled={busy||!chosen} onClick={()=>void send('preview')}>消去計画を作成・同一再送</button>}
      </>}
    </>}
    {plan&&<>
      <h4>消去計画の確認</h4>
      <p>対象入力：<span className="break-all">{plan.input_hash}</span></p>
      <p>消去対象 {plan.targets.length}件。消去済みの照合記録・計画・監査記録は残ります。</p>
      <ul>{plan.targets.map(target=><li className="break-all" key={`${target.table}:${target.key}`}>{target.table}：{target.key}</li>)}</ul>
      <ul>{plan.limitations.map(text=><li key={text}>{text}</li>)}</ul>
      {plan.erasable===true?<>
        <label><input type="checkbox" className="ui-choice" checked={consent} disabled={busy||uncertain} onChange={e=>setConsent(e.target.checked)}/>消去する記録と残る記録を確認し、取り消せない消去に同意した</label>
        <button className="ui-button ui-button-secondary" disabled={busy||!consent} onClick={()=>void send('execute')}>この旧勤務入力を消去・同一再送</button>
      </>:<p role="alert">消去できません：{plan.blockers.join('、')}</p>}
      <button className="ui-button ui-button-secondary" disabled={busy||uncertain} onClick={()=>{setPlan(null);setConsent(false);}}>実行せず選択へ戻る</button>
    </>}
    {uncertain&&<p role="alert">応答不明です。消去されなかったとは判断できません。同じ操作の再送で結果を確認してください。</p>}
    {error&&<p role="alert">{error}</p>}
    <p role="status">{busy?'処理中…':message}</p>
  </section>;
}
