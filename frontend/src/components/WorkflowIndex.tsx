"use client";
import {departmentRoleLabel} from '@/lib/departmentRole';
import {useEffect,useState} from 'react';
import AppLayout from './layout/AppLayout';
import PageHeader from './layout/PageHeader';
import ContextLink from './ContextLink';
import {workflowPurpose} from '@/lib/workflowAccess';
import {workflowPages,type WorkflowPage} from '@/lib/workflowAccess';
import {canOpenWorkflow} from '@/lib/workflowAccess';
import {currentLocation,loginPath} from '@/lib/loginPath';

import {API_BASE_URL as API} from '@/lib/apiTarget';
import MembershipHelp from '@/components/MembershipHelp';
type Membership={scope_id:string;person_id:string;role:string};

/** The business workflows, per department, limited to those this account may open. */
export default function WorkflowIndex({canReadLegacyQuotas=false}:{canReadLegacyQuotas?:boolean}){
  const [members,setMembers]=useState<Membership[]|null>(null),[error,setError]=useState('');
  useEffect(()=>{let live=true;fetch(`${API}/planning/scopes`,{credentials:'include',cache:'no-store'}).then(async r=>{
    if(r.status===401){window.location.assign(loginPath(currentLocation()));return;}
    if(!r.ok)throw new Error('所属を取得できませんでした。');
    const rows:Membership[]=await r.json();if(live)setMembers(rows);
  }).catch(e=>{if(live)setError(String(e instanceof Error?e.message:e));});return()=>{live=false;};},[]);
  return <AppLayout currentPath="/planning/workflows"><div className="planning planning-page mx-auto max-w-6xl space-y-4">
    <PageHeader title="業務管理" description="部署と目的から業務を選びます。所属ごとに許可された操作を表示します。" />
    {error&&<p role="alert">{error}</p>}
    {!error&&!members&&<p role="status">所属と操作権限を読み込み中…</p>}
    {members&&!members.length&&<><p role="status">この施設・部署の所属がありません。管理者に、本人と所属の登録を依頼してください。</p><MembershipHelp/></>}
    {members?.map(m=>{const pages=(Object.keys(workflowPages) as WorkflowPage[]).filter(p=>canOpenWorkflow(p,m.role));
      return <section key={m.scope_id} aria-labelledby={`scope-${m.scope_id}`} className="workflow-section space-y-4">
        <h2 id={`scope-${m.scope_id}`} className="text-xl font-semibold">{m.scope_id}（{departmentRoleLabel(m.role)}）</h2>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{pages.map(p=><li key={p} className="rounded-xl border border-line bg-surface p-4">
          <ContextLink className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4" href={`/planning/workflows/${p}?scope=${encodeURIComponent(m.scope_id)}`}>{workflowPages[p]}</ContextLink>
          <p className="mt-2 text-fg-muted">{workflowPurpose[p]}</p></li>)}</ul>
      </section>;})}
    <section className="workflow-section" aria-labelledby="compatibility-heading">
      <h2 id="compatibility-heading" className="text-xl font-semibold">互換管理</h2>
      <p className="mt-2 text-fg-muted">過去の記録を扱います。現在の公開勤務・年休正本とは別の管理経路です。</p>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        <li><ContextLink className="inline-flex min-h-11 items-center text-primary underline" href="/schedule">旧保存シフト</ContextLink><p>保存済みの旧形式の勤務表を参照します。</p></li>
        {canReadLegacyQuotas&&<li><a className="inline-flex min-h-11 items-center text-primary underline" href="/requests">旧休暇枠</a><p>責任者は参照のみ。管理者・開発者はAPIが許可する枠の更新を行えます。</p></li>}
      </ul>
    </section>
  </div></AppLayout>;
}
