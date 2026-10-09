'use client';
import {useId,useState} from 'react';
import ContextLink from '@/components/ContextLink';
import {Badge} from '@/components/ui/Badge';
import {newStaffProgress,type StaffRecords,type StaffStep,type StepStatus} from '@/lib/newStaffProgress';

/** The form kinds a step opens; the contract workflow owns the forms and their saving. */
export type StartKind='person'|'employer'|'establishment'|'employment'|'contract'|'capability';

const titles:Record<StaffStep,string>={
 person:'職員の氏名を登録する',
 site:'雇用主と事業場を用意する（施設で一度だけ）',
 employment:'雇用関係を登録する',
 contract:'契約を登録する',
 capability:'担当できる業務（資格）を登録する',
 reflect:'勤務表・計画に反映する',
};
const starts:Record<Exclude<StaffStep,'reflect'>,{kind:StartKind;text:string}[]>={
 person:[{kind:'person',text:'氏名の登録を始める'}],
 site:[{kind:'employer',text:'雇用主の登録を始める'},{kind:'establishment',text:'事業場の登録を始める'}],
 employment:[{kind:'employment',text:'雇用関係の登録を始める'}],
 contract:[{kind:'contract',text:'契約の登録を始める'}],
 capability:[{kind:'capability',text:'資格の登録を始める'}],
};
const statusText:Record<StepStatus,string>={done:'完了',todo:'未着手',blocked:'開始できない',elsewhere:'勤務表・計画の画面で行う'};
const statusVariant:Record<StepStatus,'default'|'secondary'|'outline'>={done:'outline',todo:'default',blocked:'secondary',elsewhere:'secondary'};

/**
 * A task list (not a forced wizard): the order new-staff records depend on, each step's state
 * for the chosen person, and a shortcut into the existing form. The free selectors stay below.
 */
export default function NewStaffTaskList({records,scope,busy,onStart,initialPersonId=''}:{records:StaffRecords;scope:string;busy:boolean;onStart:(kind:StartKind,personId:string)=>void;initialPersonId?:string}){
 const headingId=useId(),personField=useId();
 const [personId,setPersonId]=useState(initialPersonId);
 const known=records.people.some(p=>p.person_id===personId)?personId:'';
 const steps=newStaffProgress(records,known);
 return <section aria-labelledby={headingId} className="workflow-panel space-y-4 min-w-0">
  <h4 id={headingId} className="font-semibold">新しい職員を追加する手順</h4>
  <p>上から順に登録します。記録は1件ずつ保存され、途中でやめても保存済みの分は残ります。既存の記録の訂正は、下の「1. 対象を選ぶ」から行えます。</p>
  <label className="block">手順を確認する職員<select className="ui-control block w-full min-w-0 max-w-full" value={known} onChange={e=>setPersonId(e.target.value)} aria-describedby={personField}><option value="">まだ登録していない（新しい職員）</option>{records.people.map(p=><option key={p.person_id} value={p.person_id}>{p.name}</option>)}</select></label>
  <p id={personField} className="text-sm text-fg-muted">氏名を登録した後にこの欄で選ぶと、その職員の進み具合を表示します。</p>
  <ol className="space-y-3">
   {steps.map((state,index)=><li key={state.step} className="rounded-lg border border-line p-3 space-y-2 min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{index+1}. {titles[state.step]}</span><Badge variant={statusVariant[state.status]}>{statusText[state.status]}</Badge></div>
    {state.reason&&<p className="text-sm">{state.reason}</p>}
    {state.step==='reflect'
     ?<><p className="text-sm">登録しただけでは勤務入力に入りません。勤務表・計画の「契約と適用期間」にある「申請・実績を計画に反映」で反映します。反映では、新しい職員の勤務候補は作られません。勤務候補は、同じ画面の登録ファイルの取込で追加してください。</p>
       <ContextLink className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={`/planning?scope=${encodeURIComponent(scope)}#contract-heading`}>勤務表・計画を開く</ContextLink></>
     :state.status!=='blocked'&&<div className="flex flex-wrap gap-2">{starts[state.step].map(start=><button key={start.kind} type="button" className="ui-button ui-button-secondary" disabled={busy} onClick={()=>onStart(start.kind,known)}>{start.text}</button>)}</div>}
   </li>)}
  </ol>
 </section>;
}
