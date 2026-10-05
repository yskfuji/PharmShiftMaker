"use client";
import {obligationStatusLabel} from '@/lib/leaveDisplay';
import useUnsavedNavigation from '@/features/workspace/shared/useUnsavedNavigation';
import {useCallback,useEffect,useRef,useState} from 'react';
import CopyManagement from './CopyManagement';
import SubjectControlWorkflow from './SubjectControlWorkflow';
import ContractWorkflow from './ContractWorkflow';
import GovernanceForms from './GovernanceForms';
import OutsideDeclarationForm from './OutsideDeclarationForm';
import LedgerHistory from './LedgerHistory';
import LeaveCorrections from './LeaveCorrections';
import GrantAssessment from './GrantAssessment';
import {leaveOwner,leaveGrant,LeaveReference,type LeaveIdentityFields} from './LeaveIdentity';
import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
type RecordRow={kind:string;key:string;entity_id:string;revision:number;payload:Record<string,unknown>};

export default function ComplianceWorkspace({scope,personId,targetPersonId,role,onChanged,section='all'}:{scope:string;personId:string;targetPersonId?:string;role:string;onChanged:()=>void|Promise<void>;section?:'all'|'contracts'|'outside'|'leave'|'actuals'|'privacy'}){
 const [oldInputs,setOldInputs]=useState<{input_hash:string;period:{start:string;end:string}}[]>([]);
 const show=(name:string)=>section==='all'||section===name;
  const [loaded,setLoaded]=useState(false);
 const [rows,setRows]=useState<RecordRow[]>([]);const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [dirty,setDirty]=useState(false);const [balances,setBalances]=useState<(LeaveIdentityFields&{account_id:string;available_days:{numerator:number;denominator:number};expired:boolean})[]>([]);const [eraseHash,setEraseHash]=useState('');const [preview,setPreview]=useState<{plan_id:string;fingerprint:string;targets:unknown[];blockers:string[]}|null>(null);
 const [ledgerStatus,setLedgerStatus]=useState('読み込み中');const [ledgerError,setLedgerError]=useState('');const [privacyError,setPrivacyError]=useState('');const [obligations,setObligations]=useState<(LeaveIdentityFields&{start?:string;obligation_id:string;taken_half_days:number;required_half_days:number;status:string;end:string})[]>([]);
 const retry=useRef<{serialized:string;key:string}|null>(null);const admin=role==='ADMIN';
 const call=useCallback(async(path:string,body?:unknown)=>{const response=await fetch(`${API}/planning/compliance${path}?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store',method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error(`${response.status===409?'競合：再読込して内容を確認してください。':response.status===403?'操作権限がありません。':'保存されていません。'} ${await response.text()}`);return response.json();},[scope]);
 const reload=useCallback(async()=>{
  // Candidate records remain editable even when a derived ledger cannot be calculated.
  // Contract correction never depends on privacy or leave-report availability.
  const recordsResult=section==='privacy'?[]:await call('/records');
  setRows(recordsResult);setLedgerError('');setPrivacyError('');
  if(section==='privacy'||section==='all'){
   try{await call('/privacy');}catch(e){setPrivacyError('本人対応の記録を取得できませんでした。結果は未確認です。 '+errorText(e));}
  }
  if(section==='leave'||section==='all'){
   setBalances([]);setObligations([]);
   try{const report=await call('/leave-report');setBalances(report.balances);setObligations(report.obligations);setLedgerStatus(report.findings.length?'未確認または不整合があります。管理者による照合が必要です。':'固定入力に含まれるイベントの残高です。過去時点の確認は、下の時点指定照会を使用してください。');}
   catch(e){setLedgerStatus('年休残高と取得義務は未確認です。');setLedgerError(errorText(e).includes('版2')?'旧版入力のため、年休台帳は未確認です。版2の情報を照合して登録してください。':'年休台帳を計算できませんでした。残高ゼロや問題なしとは判断できません。契約・制度の不整合を修正して再照合してください。 '+errorText(e));}
  }
 },[call,section]);
 useEffect(()=>{if(!admin||section!=='all')return;void fetch(`${API}/planning/inputs?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('旧入力の候補を取得できません。');setOldInputs(await r.json());}).catch(e=>setPrivacyError(errorText(e)));},[scope,admin,section]);
 useUnsavedNavigation(dirty);
 useEffect(()=>{let active=true;setLoaded(false);setRows([]);setBalances([]);setObligations([]);setLedgerStatus("読み込み中");setLedgerError('');setPrivacyError('');setPreview(null);setDirty(false);setError('');void reload().then(()=>{if(active)setLoaded(true);}).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[reload]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 async function perform(action:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await action();setDirty(false);await reload();await onChanged();window.dispatchEvent(new Event("planning-records-changed"));}catch(e){setError(errorText(e));}finally{setBusy(false);}}
 async function mutate(path:string,payload:unknown,expected=0){const serialized=JSON.stringify({path,payload,expected});if(retry.current?.serialized!==serialized)retry.current={serialized,key:crypto.randomUUID()};return call(path,{payload,expected_revision:expected,idempotency_key:retry.current.key});}


 const heading=section==='contracts'?'契約・制度の記録':section==='outside'?'申告と原本照合':section==='leave'?'請求・残高・取得の管理':section==='privacy'?'本人対応と保存・消去':'契約・年休・記録の管理';
 const detailedLeaveClaim=section==='all';
 const inputExpiryAvailable=section==='all';
 if(!loaded)return <section className="workflow-panel space-y-3 border rounded p-4" aria-labelledby="compliance-title"><h2 id="compliance-title" className="text-xl font-semibold">{heading}</h2>{error?<><p role="alert">{error}</p><button className="ui-button ui-button-secondary" onClick={()=>{setError('');void reload().then(()=>setLoaded(true)).catch(e=>setError(errorText(e)));}}>記録の読み込みを再試行</button></>:<p role="status">対象部署の記録と権限を読み込み中…</p>}</section>;
 return <section className="workflow-stable-interactions space-y-6" aria-labelledby="compliance-title"><h2 id="compliance-title" className="text-xl font-semibold">{heading}</h2><p>{section==='privacy'?'請求の受付、管理者の判断、実行結果を分けて確認します。消去を実行しても、保全・バックアップ・外部コピーが残る場合があります。':section==='leave'?'請求・予約と実取得は別の記録です。年休残高と取得義務をそれぞれ確認し、勤務に影響する変更は勤務案へ反映して再検証してください。':section==='outside'?'本人の申告と原本の照合結果を分けて確認します。勤務に影響する変更は勤務案へ反映し、再検証してください。':'勤務に影響する変更は勤務案へ反映し、再検証してください。'}</p>{error&&<p role="alert" className="border border-danger p-3 break-words">{error}</p>}<p role="status">{message}{busy?'処理中…':''}{dirty?' 未保存の変更があります。':''}</p>
 {(show('leave')||show('privacy'))&&<nav aria-label="この画面の業務" className="workflow-section-nav">
 {show('leave')&&<><a href="#leave-ledger">残高・時点台帳</a>{detailedLeaveClaim&&<a href="#leave-request">本人の請求</a>}{admin&&<a href="#leave-administration">付与・取得・訂正</a>}</>}
 {show('privacy')&&<><a href="#privacy-request">本人の請求</a><a href="#privacy-governance">判断・保存規則</a>{admin&&<><a href="#privacy-copies">コピー・保全</a><a href="#privacy-control">人物の利用制限・消去</a>{inputExpiryAvailable&&<a href="#privacy-expiry">旧入力の期限消去</a>}</>}</>}
 </nav>}
 {admin&&show('contracts')&&<ContractWorkflow key={'contracts:'+scope+':'+(targetPersonId??'all')} scope={scope} initialPersonId={targetPersonId} onChanged={onChanged}/>}
 {show('outside')&&<OutsideDeclarationForm key={"outside:"+scope+":"+personId} scope={scope} personId={personId} admin={admin}/>}
 {show('leave')&&<div id="leave-ledger" className="workflow-section"><h3 className="text-lg font-semibold">残高と時点台帳</h3>{ledgerError&&<p role="alert" aria-label="年休台帳の取得結果" className="break-words">{ledgerError}</p>}<p role="status">{ledgerStatus}</p>{balances.length>0&&<ul aria-label="年休残高">{balances.map(b=><li className="break-words" key={b.account_id} data-account-id={b.account_id}><p>{leaveGrant(b)}</p><p>利用可能 {b.available_days.numerator}/{b.available_days.denominator} 日{b.expired?'（失効済み）':''}</p><LeaveReference kind="付与ロット" value={b.account_id}/></li>)}</ul>}{obligations.length>0&&<ul aria-label="年5日の取得管理">{obligations.map(o=><li className="break-words" key={o.obligation_id}><p>{leaveOwner(o)} ／ 管理期間 {o.start||'開始日未確認'} ～ {o.end}（終了日を含まない）</p><p>実取得 {o.taken_half_days/2}／必要 {o.required_half_days/2} 日、期限（この日の前日まで）{o.end} — {obligationStatusLabel(o.status)}</p><LeaveReference kind="取得義務" value={o.obligation_id}/></li>)}</ul>}<LedgerHistory key={"ledger:"+scope} scope={scope}/></div>}
 {admin&&show('leave')&&<div id="leave-administration" className="workflow-section"><h3 className="text-lg font-semibold">付与の照合と訂正</h3><GrantAssessment key={"assessment:"+scope} scope={scope}/></div>}
 {admin&&show('leave')&&<LeaveCorrections key={"corrections:"+scope} scope={scope} rows={rows} onChanged={()=>void reload().then(onChanged).catch(e=>setError(errorText(e)))}/>}
 {/* Independent grant actions precede the async contract candidate panel to prevent layout shifts during pointer interaction. */}
 {admin&&show('leave')&&<ContractWorkflow key={'leave-administration:'+scope} group="leave" scope={scope} onChanged={()=>reload().then(onChanged).catch(e=>setError(errorText(e)))}/>}
 {show('leave')&&detailedLeaveClaim&&<details id="leave-request" className="workflow-section"><summary>日・半日・時間単位の年休を請求</summary><p>付与と規則は外部人事との照合済みのものを選んでください。請求の受付は予約・取得の確定ではありません。</p><form className="space-y-2" onChange={()=>setDirty(true)} onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void perform(async()=>{await mutate('/leave-requests',{account_id:form.get('account'),policy_id:form.get('policy'),unit:form.get('unit'),quantity:Number(form.get('quantity')),interval:{start:String(form.get('start'))+':00+09:00',end:String(form.get('end'))+':00+09:00'},reference:form.get('reference')},0);setMessage('年休の請求を記録しました。判断後に計画へ反映してください。');});}}>
 <label className="block">本人の付与ロット<select name="account" required className="ui-control block max-w-full"><option value="">選択してください</option>{rows.filter(r=>r.kind==='leave_account'&&r.payload.person_id===personId).map(r=><option key={r.key} value={r.entity_id}>{leaveGrant(balances.find(b=>b.account_id===r.entity_id)||{granted_on:String(r.payload.granted_on||'')})}</option>)}</select></label>
 <label className="block">適用する年休規則<select name="policy" required className="ui-control block max-w-full"><option value="">選択してください</option>{rows.filter(r=>r.kind==='leave_policy'&&r.payload.person_id===personId).map(r=><option key={r.key} value={r.entity_id}>{`年休規則：${String(r.payload.start||'開始日未確認')}から ／ 1日相当 ${Number(r.payload.hours_per_day||0)||'未確認'}時間`}</option>)}</select></label>
 <label className="block">請求単位<select name="unit" className="ui-control block"><option value="day">1日</option><option value="half_day">半日</option><option value="hour">時間</option></select></label>
 <label className="block">数量（日・半日は1、時間は取得時間数）<input name="quantity" type="number" required min="1" max="24" defaultValue="1" className="ui-control block"/></label>
 <label className="block">休暇開始（日本時間）<input name="start" type="datetime-local" required className="ui-control block"/></label><label className="block">休暇終了（日本時間）<input name="end" type="datetime-local" required className="ui-control block"/></label>
 <label className="block">請求内容・根拠の参照<input name="reference" required maxLength={2000} className="ui-control block w-full"/></label><button disabled={busy} className="ui-button ui-button-secondary">単位を確認して年休請求</button></form></details>}
 {show('privacy')&&<details id="privacy-request" className="workflow-section"><summary>個人情報の開示・訂正・利用停止等を請求</summary><form className="space-y-2" onChange={()=>setDirty(true)} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void perform(async()=>{await mutate('/privacy/requests',{person_id:personId,kind:data.get('kind'),reason:data.get('reason')},0);setMessage('受付を記録しました。本人確認と管理者の判断後に実施します。');});}}><label className="block">請求の種類<select name="kind" className="ui-control block"><option value="access">開示</option><option value="rectify">訂正</option><option value="restrict">利用停止</option><option value="erase">消去</option></select></label><label className="block">対象と理由<textarea name="reason" required maxLength={2000} className="ui-control block w-full"/></label><button className="ui-button ui-button-secondary" disabled={busy}>請求を記録</button></form></details>}
 {show('privacy')&&privacyError&&<p role="alert" aria-label="本人対応の取得結果" className="break-words">{privacyError}</p>}
 {show('privacy')&&<div id="privacy-governance" className="workflow-section"><h3 className="text-lg font-semibold">本人対応の判断・保存規則</h3><GovernanceForms key={"governance:"+scope} scope={scope} admin={admin} onChanged={onChanged}/></div>}
 {admin&&show('privacy')&&<div id="privacy-control" className="workflow-section"><h3 className="text-lg font-semibold">人物の利用制限・消去</h3><SubjectControlWorkflow key={'subject-control:'+scope} scope={scope}/></div>} {admin&&show('privacy')&&<div id="privacy-copies" className="workflow-section"><h3 className="text-lg font-semibold">コピー・保全・残存の確認</h3><CopyManagement key={"copies:"+scope} scope={scope}/></div>}
 {admin&&show('privacy')&&inputExpiryAvailable&&<details id="privacy-expiry" className="workflow-section"><summary>保存期限を過ぎた旧勤務入力の消去</summary><p>現行の参照・休暇台帳・法的保全がある記録は消去できません。消去後は対象範囲の再現ができなくなります。</p><label className="block">対象の旧勤務期間<select value={eraseHash} onChange={e=>{setEraseHash(e.target.value);setPreview(null);}} className="ui-control block w-full"><option value="">選択してください</option>{oldInputs.map(i=><option key={i.input_hash} value={i.input_hash}>{i.period.start} ～ {i.period.end}</option>)}</select></label><button className="ui-button ui-button-secondary" disabled={busy||!eraseHash} onClick={()=>void perform(async()=>setPreview(await mutate('/erasure-preview',{input_hash:eraseHash},0)))}>消去対象と保全条件を確認</button>{preview&&<div className="space-y-2"><p>対象 {preview.targets.length} 件</p><ul>{preview.blockers.map(b=><li key={b}>{b}</li>)}</ul><button className="ui-button ui-button-danger border-danger" disabled={busy||preview.blockers.length>0} onClick={()=>void perform(async()=>{await mutate('/erasure-execute',{plan_id:preview.plan_id,fingerprint:preview.fingerprint},0);setPreview(null);setMessage('消去結果と消去証跡を記録しました。');})}>この確認版の対象を消去</button></div>}</details>}
 </section>;
}
