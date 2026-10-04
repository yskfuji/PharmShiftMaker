import {act,renderHook,waitFor} from '@testing-library/react';
import useHolidayRequests from './useHolidayRequests';
jest.mock('@/components/IdentityProvider',()=>({useIdentity:()=>({status:'verified',identity:{user_id:'oidc-account-id'}})}));
const response=(requests:unknown[])=>({ok:true,json:async()=>({requests})} as Response);
const row=(day:string)=>({person_id:'staff-person-id',date:day,kind:'off',order:1,is_approved:false});
test('legacy person projection differs from account ID and old-month responses cannot overwrite the current month',async()=>{
 let finish!:(r:Response)=>void;
 global.fetch=jest.fn(async(url)=>{
  if(String(url).includes('legacy-context'))return {ok:true,json:async()=>({person_id:'staff-person-id'})} as Response;
  if(String(url).endsWith('/2026/9'))return new Promise<Response>(r=>{finish=r;});
  return response([row('2026-10-01')]);
 });
 const h=renderHook(({month})=>useHolidayRequests(2026,month),{initialProps:{month:9}});
 await waitFor(()=>expect(finish).toBeDefined());h.rerender({month:10});
 await waitFor(()=>expect(h.result.current.requests[0]?.date).toBe('2026-10-01'));
 await act(async()=>finish(response([row('2026-09-01')])));
 expect(h.result.current.requests[0]?.date).toBe('2026-10-01');
 expect(h.result.current.requests[0]?.personId).toBe('staff-person-id');
});
