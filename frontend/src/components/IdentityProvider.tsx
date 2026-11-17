"use client";

import {createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {usePathname} from 'next/navigation';
import {API_BASE_URL} from '@/lib/apiTarget';
import {browserNavigation} from '@/lib/browserNavigation';

import {parseIdentity, type VerifiedIdentity} from '@/lib/identity';
type IdentityState = {identity: VerifiedIdentity | null; status: 'checking' | 'verified' | 'unavailable' | 'ended'; httpStatus?: number};
const IdentityContext = createContext<IdentityState>({identity:null,status:'checking'});
export const useIdentity = () => useContext(IdentityContext);

/** Memory-only identity. Display cookies never supply identity or authority. */
export default function IdentityProvider({children}: {children:ReactNode}) {
  const path = usePathname();
  const [state,setState] = useState<IdentityState>({identity:null,status:'checking'});
  const previous = useRef<string | null>(null), verified = useRef<VerifiedIdentity | null>(null), generation = useRef(0), ended = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    if (ended.current) return;
    const request = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const current = () => request === generation.current && !ended.current;
    // A session renewal revalidates in the background. Keeping an already verified
    // principal usable avoids making every client-side route temporarily inert.
    // Initial verification and an explicit retry remain fail closed.
    if (!verified.current) setState({identity:null,status:'checking'});
    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {credentials:'include',cache:'no-store',signal:controller.signal});
      if (!current()) return;
      if (!response.ok) {
        if (response.status === 401) {
          ended.current=true;
          verified.current=null;
          setState({identity:null,status:'ended',httpStatus:response.status});
          window.dispatchEvent(new Event('session-invalidated'));
        } else if (!verified.current) {
          setState({identity:null,status:'unavailable',httpStatus:response.status});
        }
        return;
      }
      const identity = parseIdentity(await response.json());
      if (!current()) return;
      const key = JSON.stringify([identity.identifier_kind,identity.user_id,identity.global_role]);
      if (previous.current !== null && previous.current !== key) {
        ended.current=true;
        verified.current=null;
        setState({identity:null,status:'ended'});
        browserNavigation.reload(); // remount all business state under the new principal
        return;
      }
      previous.current=key;
      verified.current=identity;
      setState({identity,status:'verified'});
    } catch {
      if (current() && !verified.current) setState({identity:null,status:'unavailable'});
    } finally {window.clearTimeout(timeout);}
  },[]);
  useEffect(() => {
    const clear = () => {ended.current=true;verified.current=null;generation.current++;pending.current?.abort();setState({identity:null,status:'ended'});};
    window.addEventListener('session-ending',clear);
    window.addEventListener('session-renewed',read);
    if (path !== '/login') void read();
    const invalidate=()=>{generation.current++;pending.current?.abort();};
    return () => {invalidate();window.removeEventListener('session-ending',clear);window.removeEventListener('session-renewed',read);};
  },[path,read]);
  return <IdentityContext.Provider value={state}>
    {state.status==='unavailable' && <p role="alert" className="p-3">本人情報を確認できません{state.httpStatus ? `（HTTP ${state.httpStatus}）` : ''}。<button className="ui-button ui-button-secondary" onClick={()=>void read()}>本人情報を再確認</button></p>}
    {children}
  </IdentityContext.Provider>;
}

/** The bypass link is offered only when its target can actually receive focus. */
export function IdentitySkipLink() {
  const {status} = useIdentity();
  const path = usePathname();
  if (path !== '/login' && status !== 'verified') return null;
  return <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[200] focus:rounded-control focus:bg-surface focus:px-4 focus:py-3 focus:text-fg focus:shadow-overlay">本文へ移動</a>;
}

export function IdentityBoundary({children}: {children:ReactNode}) {
  const {status} = useIdentity();
  const path=usePathname();
  if(path==='/login')return <>{children}</>;
  if (status==='ended') return <p role="status" className="p-6">本人情報を再確認しています。前のアカウントの操作は終了しました。</p>;
  return <div hidden={status!=='verified'} inert={status!=='verified' ? true : undefined}>{children}</div>;
}

export function IdentityDisplay() {
  const {identity,status,httpStatus} = useIdentity();
  if (!identity) return <span role="status">{status==='checking'?'本人情報を確認中':status==='ended'?'認証を再確認してください':`本人情報は確認不能${httpStatus ? `（HTTP ${httpStatus}）` : ''}`}</span>;
  return <div className="min-w-0 break-words [overflow-wrap:anywhere]" data-verified-identity="">
    <p className="font-semibold">{identity.display_name?.trim() || '表示名未登録'}</p>
    <p className="text-sm">{identity.identifier_kind==='login_id'?'ログインID':'アカウントID'}：{identity.user_id}</p>
  </div>;
}
