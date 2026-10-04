"use client";
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {browserNavigation} from '@/lib/browserNavigation';
import {installHistoryGuard} from './useUnsavedNavigation';

/** Mounted on every page, including login, so router history shares one index. */
export default function UnsavedNavigationBoundary(){
 useLayoutEffect(()=>{installHistoryGuard();},[]);
 const [untracked,setUntracked]=useState(false);
 const notice=useRef<HTMLDivElement>(null);
 // The notice asks for a decision, so focus moves to it when it appears.
 useEffect(()=>{if(untracked)notice.current?.focus();},[untracked]);
 useEffect(()=>{
  const show=()=>setUntracked(true);
  // Any later traversal that reaches the page (tracked history) ends the situation.
  const hide=()=>setUntracked(false);
  window.addEventListener('planning-history-untracked',show);
  window.addEventListener('popstate',hide);
  return()=>{window.removeEventListener('planning-history-untracked',show);window.removeEventListener('popstate',hide);};
 },[]);
 if(!untracked)return null;
 return <div ref={notice} tabIndex={-1} role="alert" className="fixed inset-x-0 top-0 z-50 border-b bg-surface p-3 space-y-2 break-words [overflow-wrap:anywhere]">
  <p>未保存の変更があるため、この履歴の移動を画面に反映していません。アドレス欄は移動先を示していますが、表示中の内容は保持しています。</p>
  <p>保存または破棄してから移動してください。移動先を開くときは、ブラウザーが破棄の確認を表示します。</p>
  <button type="button" className="ui-button ui-button-secondary" onClick={()=>setUntracked(false)}>この画面で続ける</button>
  <button type="button" className="ui-button ui-button-secondary ml-2" onClick={()=>browserNavigation.reload()}>移動先を開く（未保存の変更を破棄）</button>
 </div>;
}
