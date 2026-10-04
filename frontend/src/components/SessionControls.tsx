"use client";
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import useModalDialog from './useModalDialog';
import {IdentityDisplay} from './IdentityProvider';
import {browserNavigation} from '@/lib/browserNavigation';
import {loginPath} from '@/lib/loginPath';
import ThemeToggle from './ThemeToggle';
import {usePathname} from 'next/navigation';

import {API_BASE_URL as API} from '@/lib/apiTarget';
const ACTIVITY=['pointerdown','keydown','wheel','touchstart'] as const;
const REQUEST_TIMEOUT=15_000;
// Server default (AUTH_IDLE_TIMEOUT_MINUTES); used until the server has answered.
const DEFAULT_LIMIT=15*60*1000;
// Shared by the tabs of this browser: work in one tab keeps the others open. It
// holds a time only, and is cleared with the site's storage after sign-out.
const SHARED_KEY='pharmshift-session-renewed-at';
const readShared=()=>{try{return Number(window.localStorage.getItem(SHARED_KEY))||0;}catch{return 0;}};
const writeShared=(value:number)=>{try{window.localStorage.setItem(SHARED_KEY,String(value));}catch{/* storage may be disabled */}};
const signInDestination=(reason:string)=>reason==='signed_out'?'/login?reason=signed_out':loginPath(browserNavigation.pathAndSearch(),reason==='idle'?'idle':'expired');

/**
 * Shared terminals (OWASP ASVS 5.0 V7.3/V7.4/V14.3): sign-out on every page; the
 * server's idle limit, renewed only while the person works (in any tab); a
 * warning before it ends; the absolute limit; no page restored from the
 * back/forward cache without a fresh check. The session deadline is counted from
 * the last successful renewal, as the server counts it. When the session ends
 * the page is covered and made inert before navigating, so nothing stays usable
 * even if the browser asks about unsaved input.
 */
export default function SessionControls(){
 const pathname=usePathname();
 const [active,setActive]=useState(false),[warning,setWarning]=useState(false);
 const [ended,setEnded]=useState(''),[failed,setFailed]=useState(false);
 const renewedAt=useRef(0),renewing=useRef(false),warningShown=useRef(false),limit=useRef(DEFAULT_LIMIT),absolute=useRef(Infinity);
 const dialog=useRef<HTMLDivElement>(null),firstButton=useRef<HTMLButtonElement>(null),overlay=useRef<HTMLDivElement>(null),titleId=useId();
 const ending=useRef(false),generation=useRef(0);
 const end=useCallback(async(reason:string)=>{
  // Once: the timer keeps running after the deadline and must not repeat the sign-out.
  if(ending.current)return;ending.current=true;
  setEnded(reason);setWarning(false);window.dispatchEvent(new Event("session-ending"));
  // Sign-out must reach the server (it revokes the session); retry before leaving.
  for(let attempt=0;attempt<3;attempt++){
   const response=await fetch(`${API}/auth/logout`,{method:'POST',credentials:'include',signal:AbortSignal.timeout(REQUEST_TIMEOUT)}).catch(()=>null);
   if(response?.ok){writeShared(0);browserNavigation.replace(signInDestination(reason));return;}
  }
  setFailed(true);
 },[]);
 const renew=useCallback(async()=>{
  if(renewing.current||ending.current)return;
  renewing.current=true;
  const started=Date.now(),requestGeneration=generation.current;
  const stale=()=>ending.current||generation.current!==requestGeneration;
  try{
   // A bounded wait: a request that never answers would otherwise hold off the warning.
   const response=await fetch(`${API}/auth/refresh`,{method:'POST',credentials:'include',signal:AbortSignal.timeout(REQUEST_TIMEOUT)}).catch(()=>null);
   if(stale())return;
   if(response?.status===401){ending.current=true;setEnded('expired');window.dispatchEvent(new Event('session-ending'));browserNavigation.replace(signInDestination('expired'));return;}
   if(response?.ok){
    const body=await response.json();
    if(stale())return;
    limit.current=Number(body.idle_timeout_seconds||0)*1000;
    absolute.current=body.absolute_expires_at?new Date(body.absolute_expires_at).getTime():Infinity;
    renewedAt.current=started;writeShared(Math.max(readShared(),started));
    window.dispatchEvent(new Event("session-renewed"));
   }
  }catch{
   // Headers can arrive before navigation/timeout aborts the response body.
   // An unconfirmed renewal must not extend either deadline or shared time.
  }finally{if(generation.current===requestGeneration)renewing.current=false;}
 },[]);
 useEffect(()=>{
  // A page restored from the back/forward cache is loaded again, so the session
  // and data are checked anew (web.dev bfcache guidance).
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)browserNavigation.reload();};
  window.addEventListener('pageshow',restored);
  return()=>window.removeEventListener('pageshow',restored);
 },[]);
 useEffect(()=>{
  const signOut=()=>void end('signed_out');
  window.addEventListener('workspace-signout',signOut);
  return()=>window.removeEventListener('workspace-signout',signOut);
 },[end]);
 useEffect(()=>{
  if(browserNavigation.pathname()==='/login')return;
  generation.current+=1;
  setActive(true);
  renewedAt.current=Date.now();void renew();
  // Activity renews the session (at most once a minute, or at once during the
  // warning); inside the warning its own buttons decide, so a pointerdown there
  // does not remove the dialog before the click lands.
  const activity=(event:Event)=>{
   if(ending.current||dialog.current?.contains(event.target as Node))return;
   if(warningShown.current||Date.now()-renewedAt.current>60_000){setWarning(false);void renew();}
  };
  for(const type of ACTIVITY)window.addEventListener(type,activity,{capture:true,passive:true});
  const timer=window.setInterval(()=>{
   if(!limit.current)return;
   const now=Date.now(),deadline=Math.min(Math.max(renewedAt.current,readShared())+limit.current,absolute.current);
   const lead=Math.min(120_000,limit.current/2);
   if(now>=deadline)void end(now>=absolute.current?'expired':'idle');
   // While a renewal is in flight the old deadline is stale: do not bring the warning back
   // just after 「操作を続ける」 (ending at the deadline above still applies).
   else if(!renewing.current){warningShown.current=now>=deadline-lead;setWarning(warningShown.current);}
  },1000);
  return()=>{generation.current+=1;renewing.current=false;for(const type of ACTIVITY)window.removeEventListener(type,activity,{capture:true});window.clearInterval(timer);};
 },[end,renew]);
 useEffect(()=>{
  const invalid=()=>{ending.current=true;setEnded('expired');browserNavigation.replace(signInDestination('expired'));};
  window.addEventListener('session-invalidated',invalid);
  return()=>window.removeEventListener('session-invalidated',invalid);
 },[]);
 // The warning is a modal alert dialog: the page behind is inert, focus starts on
 // 「操作を続ける」 and stays inside, Escape also continues working.
 const continueWorking=useCallback(()=>{warningShown.current=false;setWarning(false);void renew();},[renew]);
 useModalDialog(warning,dialog,continueWorking);
 useEffect(()=>{
  if(!ended)return;
  // Everything but the notice leaves the accessibility tree and stops taking input.
  const others=Array.from(document.body.children).filter(el=>el!==overlay.current);
  for(const el of others)el.setAttribute('inert','');
  return()=>{for(const el of others)el.removeAttribute('inert');};
 },[ended]);
 if(ended)return <div ref={overlay} role="status" className="fixed inset-0 z-[100] bg-surface text-fg p-6 text-lg space-y-3">
  <p>{ended==='idle'?'操作がなかったため、サインアウトします。':ended==='expired'?'サインインの有効期限が切れました。':'サインアウトします。'}</p>
  {failed&&<p role="alert">サーバーでのサインアウトを確認できませんでした。ブラウザーをすべて閉じてから席を離れてください。</p>}
 </div>;
 if(!active)return null;
 const warningDialog=warning&&createPortal(<div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-x-0 top-0 z-[90] border-b bg-surface text-fg p-3 space-y-2">
   <p id={titleId}>操作がないため、まもなく自動的にサインアウトします。保存していない入力は失われます。</p>
   <button ref={firstButton} data-autofocus type="button" className="ui-button ui-button-secondary" onClick={continueWorking}>操作を続ける</button>
   <button type="button" className="ui-button ui-button-secondary ml-2" onClick={()=>void end('signed_out')}>今すぐサインアウト</button>
  </div>,document.body);
 if(pathname?.startsWith('/workspace'))return warningDialog;
 return <nav aria-label="サインイン中のアカウント" className="flex flex-wrap items-center justify-end gap-2 border-b p-2 text-sm min-w-0">
  <ThemeToggle/>
  <IdentityDisplay />
  <button type="button" className="ui-button ui-button-secondary" onClick={()=>void end('signed_out')}>サインアウト</button>
  {warningDialog}
 </nav>;
}
