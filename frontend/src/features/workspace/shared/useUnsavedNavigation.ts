"use client";
import {useEffect} from 'react';

const pendingForms=new Set<symbol>();
export const hasUnsavedChanges=()=>pendingForms.size>0;
export const confirmDiscardChanges=(message='未保存の変更があります。破棄して移動しますか？')=>!hasUnsavedChanges()||window.confirm(message);
const POSITION='__pharmshift_history_position_v1';
const DOCUMENT='__pharmshift_history_document_v1';
let installed=false,current=0,documentKey='',restoring:number|null=null;
const objectState=(value:unknown):value is Record<string,unknown>=>value===null||(typeof value==='object'&&!Array.isArray(value));
const index=(state:unknown):number|null=>{
 if(!state||typeof state!=='object')return null;
 const s=state as Record<string,unknown>;
 return s[DOCUMENT]===documentKey&&Number.isSafeInteger(s[POSITION])?s[POSITION] as number:null;
};

/** Install once per document, before workflow navigation. Never replace Next's state. */
export function installHistoryGuard(){
 if(installed||typeof window==='undefined')return;
 installed=true;documentKey=crypto.randomUUID();
 const push=window.history.pushState.bind(window.history),replace=window.history.replaceState.bind(window.history);
 const stamped=(data:unknown,position:number)=>objectState(data)?{...(data??{}),[POSITION]:position,[DOCUMENT]:documentKey}:data;
 replace(stamped(window.history.state,current),'');
 window.history.pushState=(data,unused,url)=>{push(stamped(data,current+1),unused,url);current++;};
 window.history.replaceState=(data,unused,url)=>replace(stamped(data,current),unused,url);
 window.addEventListener('popstate',event=>{
  const destination=index(event.state);
  if(restoring!==null){
   // The compensating traversal returns to the page that is already rendered.
   // Do not let the router render the rejected destination or lose the form.
   event.stopImmediatePropagation();
   if(destination===restoring){current=restoring;restoring=null;}
   else if(destination!==null)window.history.go(restoring-destination);
   else {restoring=null;window.dispatchEvent(new CustomEvent('planning-history-untracked'));}
   return;
  }
  if(destination===null){
   // Never guess a direction for entries created before this document's guard.
   // With unsaved work, keep the rendered page (the address bar already shows the
   // destination) and let the boundary explain it; nothing is discarded silently.
   // Cross-document traversal remains protected by beforeunload.
   if(hasUnsavedChanges()){event.stopImmediatePropagation();window.dispatchEvent(new CustomEvent('planning-history-untracked'));}
   return;
  }
  if(hasUnsavedChanges()&&destination!==current&&!window.confirm('未保存の変更があります。破棄して履歴を移動しますか？')){
   event.stopImmediatePropagation();restoring=current;window.history.go(current-destination);return;
  }
  current=destination;
 },true);
}

const unload=(event:BeforeUnloadEvent)=>{if(hasUnsavedChanges()){event.preventDefault();event.returnValue='';}};
const navigate=(event:MouseEvent)=>{
 if(!hasUnsavedChanges()||event.defaultPrevented||event.button!==0)return;
 const target=event.target instanceof Element?event.target.closest('a[href]'):null;
 if(target){
  const destination=new URL(target.getAttribute('href')??'',window.location.href);
  // Section navigation keeps the same mounted forms and values.
  if(destination.hash && destination.origin===window.location.origin && destination.pathname===window.location.pathname && destination.search===window.location.search)return;
 }
 if(target&&!window.confirm('未保存の変更があります。破棄して移動しますか？')){event.preventDefault();event.stopPropagation();}
};

/** Protect native links, unload and tracked same-document history traversals. */
export default function useUnsavedNavigation(dirty:boolean){
 useEffect(()=>{installHistoryGuard();},[]);
 useEffect(()=>{
  if(!dirty)return;
  const identity=Symbol();pendingForms.add(identity);
  if(pendingForms.size===1){window.addEventListener('beforeunload',unload);document.addEventListener('click',navigate,true);}
  return()=>{pendingForms.delete(identity);if(!pendingForms.size){window.removeEventListener('beforeunload',unload);document.removeEventListener('click',navigate,true);}};
 },[dirty]);
}
