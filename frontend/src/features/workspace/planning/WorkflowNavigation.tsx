'use client';
import {useEffect,useState} from 'react';
import useNavigationContext from '@/features/workspace/shared/useNavigationContext';
import {monthInterval} from '@/lib/calendar';
/* Cross-workflow transitions load a fresh authorized page. Unsaved-navigation
   guards intercept these native links before the browser follows them. */

import {canOpenWorkflow,workflowPages,type WorkflowPage} from '@/lib/workflowAccess';

export default function WorkflowNavigation({current,scope,period,role}:{current?:WorkflowPage;scope?:string;period?:string;role?:string}) {
  const [incomingMonth,setIncomingMonth]=useState('');
  useEffect(()=>{setIncomingMonth(new URLSearchParams(window.location.search).get('period')??'');},[]);
  const month=period??incomingMonth;
  const params=new URLSearchParams();if(scope)params.set('scope',scope);if(monthInterval(month))params.set('period',month);
  useNavigationContext(scope,month);
  const query=params.size?'?'+params.toString():'';
  return <nav aria-label="勤務管理の業務" className="ui-workflow-nav flex flex-wrap gap-2 border-b border-line pb-3">
    <a className="rounded-lg px-3 py-2 text-primary underline underline-offset-4 hover:bg-primary-soft" href={`/planning${query}`}>月間勤務表</a>
    {Object.entries(workflowPages).filter(([key])=>role?canOpenWorkflow(key as WorkflowPage,role):true).map(([key,label])=><a key={key}
      aria-current={key===current?'page':undefined} className={key===current?"rounded-lg bg-primary-soft px-3 py-2 font-semibold text-primary underline underline-offset-4":"rounded-lg px-3 py-2 text-primary underline underline-offset-4 hover:bg-primary-soft"}
      href={`/planning/workflows/${key}${query}`}>{label}</a>)}
  </nav>;
}
