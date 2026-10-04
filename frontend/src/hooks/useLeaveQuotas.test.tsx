import {act,renderHook,waitFor} from '@testing-library/react';
import useLeaveQuotas from './useLeaveQuotas';

test('a late old-year response cannot overwrite the selected year or expose editable stale values',async()=>{
 const pending:{resolve:(value:Response)=>void;signal:AbortSignal}[]=[];
 global.fetch=jest.fn((_url,options)=>new Promise<Response>(resolve=>pending.push({resolve,signal:options?.signal as AbortSignal}))) as typeof fetch;
 const payload=(year:number,month:number)=>({ok:true,json:async()=>({year,month,items:[{person_id:'p',person_name:'合成職員',year,month,kind:'PAID_LEAVE_REQUEST',total_days:year,used_days:0,used_before_month:0,remaining_days:year}]})} as Response);
 const {result,rerender}=renderHook(({year,month})=>useLeaveQuotas(year,month),{initialProps:{year:2026,month:12}});
 rerender({year:2027,month:1});
 expect(pending[0].signal.aborted).toBe(true);expect(result.current.items).toEqual([]);
 await act(async()=>pending[1].resolve(payload(2027,1)));
 await waitFor(()=>expect(result.current.items[0].year).toBe(2027));
 await act(async()=>pending[0].resolve(payload(2026,12)));
 expect(result.current.items[0].year).toBe(2027);expect(result.current.loading).toBe(false);
});
