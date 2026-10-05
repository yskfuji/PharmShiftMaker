'use client';
import {useEffect} from 'react';
import {monthInterval} from '@/lib/calendar';

/** Persist display context only after the page resolves an authorized membership. */
export default function useNavigationContext(scope:string|undefined,period:string|undefined){
 useEffect(()=>{
  if(!scope)return;
  const url=new URL(window.location.href);
  url.searchParams.set('scope',scope);
  if(period&&monthInterval(period))url.searchParams.set('period',period);
  if(url.href!==window.location.href)window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
  window.dispatchEvent(new Event('planning-context-changed'));
 },[scope,period]);
}
