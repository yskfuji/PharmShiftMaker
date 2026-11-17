import {planningRead,PlanningReadError} from '@/lib/planningRead';

afterEach(()=>jest.restoreAllMocks());
test.each([401,403,409,422,503])('read preserves HTTP %i as a separate failure',async status=>{
 global.fetch=jest.fn(async()=>({ok:false,status} as Response));
 await expect(planningRead('/dashboard')).rejects.toMatchObject({status});
});
test('network loss and malformed JSON never become zero or success',async()=>{
 global.fetch=jest.fn().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({ok:true,json:async()=>{throw new SyntaxError('json');}});
 await expect(planningRead('/dashboard')).rejects.toMatchObject({status:0});
 await expect(planningRead('/dashboard')).rejects.toBeInstanceOf(PlanningReadError);
});
