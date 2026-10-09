'use client';
import {useEffect,useState,type ComponentProps} from 'react';
import {monthInterval} from '@/lib/calendar';

/** Carries only display context, never authority, across native page navigations. */
export default function ContextLink({href,children,...props}:ComponentProps<'a'> & {href:string}) {
 const [query,setQuery]=useState('');
 const destination=new URL(href,'https://display.invalid');
 useEffect(()=>{
  const update=()=>{
   const source=new URLSearchParams(window.location.search), out=new URLSearchParams();
   const scope=source.get('scope'),period=source.get('period');
   if(scope&&scope.length<=256)out.set('scope',scope);
   if(period&&monthInterval(period))out.set('period',period);
   const privacyPurpose=destination.pathname==='/workspace/governance/privacy';
   for(const key of ['publication','case','person'] as const){if(privacyPurpose&&(key==='publication'||key==='case'))continue;const value=source.get(key);if(value&&/^[A-Za-z0-9._:-]{1,256}$/.test(value))out.set(key,value);}
   setQuery(out.toString());
  };
 update();window.addEventListener('planning-context-changed',update);
 return()=>window.removeEventListener('planning-context-changed',update);
 },[destination.pathname]);
 if(destination.origin==='https://display.invalid'&&query&&['/dashboard','/planning','/settings','/workspace'].some(p=>destination.pathname===p||destination.pathname.startsWith(p+'/'))){
  new URLSearchParams(query).forEach((value,key)=>{if(!destination.searchParams.has(key))destination.searchParams.set(key,value);});
  return <a {...props} href={destination.pathname+destination.search+destination.hash}>{children}</a>;
 }
 return <a {...props} href={href}>{children}</a>;
}
