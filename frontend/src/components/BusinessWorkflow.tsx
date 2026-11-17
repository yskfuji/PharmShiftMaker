"use client";
import {departmentRoleLabel} from '@/lib/departmentRole';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import CompliancePanel from './CompliancePanel';
import AppLayout from './layout/AppLayout';
import PageHeader from './layout/PageHeader';
import ActualWorkflow from './ActualWorkflow';
import PlanningRequests from './PlanningRequests';
import WorkflowNavigation from './WorkflowNavigation';
import {hasUnsavedChanges} from './useUnsavedNavigation';
import {canOpenWorkflow,workflowPages,workflowPurpose,type WorkflowPage} from '@/lib/workflowAccess';
import {currentLocation,loginPath} from '@/lib/loginPath';

import {API_BASE_URL as API} from '@/lib/apiTarget';
import {errorText} from '@/lib/errorText';
import MembershipHelp from '@/components/MembershipHelp';
type Membership={scope_id:string;person_id:string;role:string};
type Recovery={state:string;manifest_hash:string|null;note:string};

export default function BusinessWorkflow({page}:{page:WorkflowPage}){
  const [members,setMembers]=useState<Membership[]>([]),[scope,setScope]=useState(''),[loaded,setLoaded]=useState(false);
  const [actualDirty,setActualDirty]=useState(false);
  const [error,setError]=useState(''),[epoch,setEpoch]=useState(0),[recovery,setRecovery]=useState<Recovery|null>(null);
  useEffect(()=>{let active=true;fetch(`${API}/planning/scopes`,{credentials:'include',cache:'no-store'}).then(async r=>{
    if(!r.ok)throw new Error(r.status===401?'ログインし直してください。':'所属を取得できませんでした。');
    const rows:Membership[]=await r.json();if(active){setMembers(rows);setLoaded(true);const desired=new URLSearchParams(window.location.search).get('scope');setScope(rows.find(m=>m.scope_id===desired)?.scope_id??rows[0]?.scope_id??'');}
  }).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[epoch]);
  const member=members.find(m=>m.scope_id===scope);
  const allowed=member&&canOpenWorkflow(page,member.role);
  useEffect(()=>{let active=true;setRecovery(null);if(page==='recovery'&&allowed)fetch(`${API}/planning/compliance/recovery-status?scope_id=${encodeURIComponent(scope)}`,{credentials:'include',cache:'no-store'}).then(async r=>{
    if(!r.ok)throw new Error('復旧状況を確認できません。接続遮断中は運用CLIの独立した記録を確認してください。');
    const value=await r.json();if(active)setRecovery(value);
  }).catch(e=>{if(active)setError(errorText(e));});return()=>{active=false;};},[page,scope,allowed]);
  return <AppLayout currentPath={`/planning/workflows/${page}`}><div className="planning planning-page mx-auto max-w-6xl space-y-4">{member&&<WorkflowNavigation current={page} scope={scope} role={member.role}/>}
    <PageHeader title={workflowPages[page]} description={workflowPurpose[page]} context={member?`${scope} / ${departmentRoleLabel(member.role)}`:undefined} />
    <label className="block">施設・部署<select className="ui-control block max-w-full" value={scope} onChange={e=>{if((!actualDirty&&!hasUnsavedChanges())||window.confirm('未保存の変更を破棄して部署を切り替えますか？'))setScope(e.target.value);}}>{members.map(m=><option key={m.scope_id}>{m.scope_id}</option>)}</select></label>
    {error&&<div><p role="alert">{error}</p><button className="ui-button ui-button-secondary" onClick={()=>{setError('');setEpoch(n=>n+1);}}>再読込</button><a href={loginPath(currentLocation())} className="underline p-2">ログインへ</a></div>}
    {!error&&!loaded&&<p role="status">所属と操作権限を読み込み中…</p>}
    {!error&&loaded&&!members.length&&<><p role="status">この施設・部署の所属がありません。管理者に、本人と所属の登録を依頼してください。</p><MembershipHelp/></>}
    {member&&!allowed&&<><p role="alert">この業務を操作する権限がありません。</p><Link href="/planning/workflows" prefetch={false} className="underline p-2">操作できる業務の一覧へ</Link></>}
    {member&&allowed&&page!=='recovery'&&page!=='actuals'&&<CompliancePanel key={scope+':'+page} section={page} scope={scope} personId={member.person_id} role={member.role} onChanged={()=>{}}/>}
    {member&&allowed&&page==='actuals'&&<ActualWorkflow key={scope} scope={scope} onDirty={setActualDirty}/>}
    {member&&allowed&&page==='leave'&&<PlanningRequests scope={scope} personId={member.person_id} canReview={['ADMIN','LEADER'].includes(member.role)} onChanged={()=>{}}/>}
    {member&&allowed&&page==='recovery'&&(recovery?<section className="workflow-panel border p-4 space-y-3"><h2 className="font-semibold">復元先の状態</h2><p role="status">{recovery.state==='NO_RESTORE_RECORDED'?'復元実行の記録なし':recovery.state==='REPLAYED'?'消去制御の再適用済み':recovery.state==='QUARANTINED'?'通常接続を遮断中':recovery.state}</p><p className="break-all">照合した制御ハッシュ：{recovery.manifest_hash??'未記録'}</p><p>{recovery.note}</p></section>:<p role="status">{error?'復旧状態は未確認です。取得に失敗したため再試行待ちです。':'復旧状態を確認中…'}</p>)}
  </div></AppLayout>;
}
