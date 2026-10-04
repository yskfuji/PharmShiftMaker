import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import PlanningWorkspace from '../PlanningWorkspace';
import MonthlySchedule from '../MonthlySchedule';
import {monthInterval,overlapsDisplay,publicationCalendar} from '@/lib/calendar';

jest.mock('../PlanningRequests',()=>({__esModule:true,default:()=>null}));
jest.mock('../ContractWorkflow',()=>({__esModule:true,default:()=>null}));
jest.mock('../FlexSettlementPanel',()=>({__esModule:true,default:()=>null}));
const duty=(id:string,start:string,end:string)=>({duty_id:id,person_id:'self',start,end,kind:'NIGHT',task:'調剤',location:'本館'});
afterEach(()=>{jest.restoreAllMocks();window.history.replaceState({},'', '/');});

test('calendar intervals keep leap days, year boundaries and exclusive ends',()=>{
 expect(monthInterval('2028-02')).toEqual({start:'2028-02-01T00:00:00+09:00',end:'2028-03-01T00:00:00+09:00'});
 expect(monthInterval('2026-12')?.end).toBe('2027-01-01T00:00:00+09:00');
 for(const invalid of ['0000-01','2026-13','9999-12','2026-1','not-a-month'])expect(monthInterval(invalid)).toBeUndefined();
 expect(overlapsDisplay(duty('x','2026-01-31T23:00:00+09:00','2026-02-01T00:00:00+09:00'),monthInterval('2026-02')!)).toBe(false);
});

test('a night crossing the month boundary is visible in February and has its original detail',()=>{
 const night=duty('night','2026-01-31T23:00:00+09:00','2026-02-01T08:00:00+09:00');
 render(<MonthlySchedule people={[{person_id:'self',name:'本人'}]} duties={[night]} previous={[]} period={monthInterval('2026-02')} draft={false} published/>);
 const list=screen.getByLabelText('日別・職員別の勤務一覧');
 expect(within(list).getByLabelText('表示日')).toHaveValue('2026-02-01');
 fireEvent.click(within(list).getByRole('button',{name:/詳細を表示/}));
 expect(screen.getByRole('status')).toHaveTextContent(night.start);
 expect(screen.getByRole('status')).toHaveTextContent(night.end);
});

test('pharmacist deep link uses selected month across two publications and preserves it in navigation',async()=>{
 window.history.replaceState({},'', '/planning?scope=hospital%2Fpharmacy&period=2026-02');
 const jan=duty('jan','2026-01-05T09:00:00+09:00','2026-01-05T13:00:00+09:00');
 const feb=duty('feb','2026-02-05T09:00:00+09:00','2026-02-05T13:00:00+09:00');
 const publications=[['2026-01',jan],['2026-02',feb]].map(([month,assignment])=>{
  const p=monthInterval(month as string)!;return {publication_id:month,version:1,period:p.start+'|'+p.end,assignments:[assignment],validation_status:'valid'};
 });
 global.fetch=jest.fn(async(input:RequestInfo|URL)=>({ok:true,json:async()=>String(input).endsWith('/scopes')?[{scope_id:'hospital/pharmacy',person_id:'self',role:'PHARMACIST'}]:String(input).includes('/publications?')?publications:[]} as Response));
 render(<PlanningWorkspace/>);
 expect(await screen.findByLabelText('表示する月（本人の公開勤務）')).toHaveValue('2026-02');
 await waitFor(()=>expect(screen.queryByText('公開勤務を取得中…')).not.toBeInTheDocument());
 const calendar=screen.getByRole('region',{name:'月間勤務表（横スクロール可能）'});
 expect(within(calendar).queryByRole('button',{name:/2026-01/})).not.toBeInTheDocument();
 expect(within(calendar).getByRole('button',{name:/2026-02-05/})).toBeInTheDocument();
 expect(screen.queryByRole('region',{name:'現在の計画状態'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'休暇'})).toHaveAttribute('href','/planning/workflows/leave?scope=hospital%2Fpharmacy&period=2026-02');
 fireEvent.change(screen.getByLabelText('表示する月（本人の公開勤務）'),{target:{value:'2026-01'}});
 const changed=screen.getByRole('region',{name:'月間勤務表（横スクロール可能）'});
 expect(within(changed).queryByRole('button',{name:/2026-02/})).not.toBeInTheDocument();
 expect(within(changed).getByRole('button',{name:/2026-01-05/})).toBeInTheDocument();
});

test('failed publication read never claims that no duties or publications exist',async()=>{
 window.history.replaceState({},'', '/planning?period=2026-02');
 global.fetch=jest.fn(async(input:RequestInfo|URL)=>String(input).includes('/publications?')
  ? {ok:false,status:503,text:async()=>'Service unavailable'} as Response
  : {ok:true,json:async()=>String(input).endsWith('/scopes')?[{scope_id:'hospital/pharmacy',person_id:'self',role:'PHARMACIST'}]:[]} as Response);
 render(<PlanningWorkspace/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('503');
 expect(screen.queryByText('この期間の勤務割当はありません。')).not.toBeInTheDocument();
 expect(screen.queryByText('公開済みの勤務表はありません。')).not.toBeInTheDocument();
 expect(screen.queryByRole('region',{name:'月間勤務表（横スクロール可能）'})).not.toBeInTheDocument();
});


test('editable calendar waits for its input period before offering interactive duties',async()=>{
 window.history.replaceState({},'', '/planning?period=2026-02');
 const period=monthInterval('2026-02')!;
 const night=duty('night','2026-02-01T01:00:00+09:00','2026-02-01T08:00:00+09:00');
 let finishInput!:(response:Response)=>void;
 const delayed=new Promise<Response>(resolve=>{finishInput=resolve;});
 global.fetch=jest.fn(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.includes('/inputs/latest'))return delayed;
   const data=url.endsWith('/scopes')?[{scope_id:'hospital/pharmacy',person_id:'self',role:'ADMIN'}]
     :url.includes('/publications?')?[{publication_id:'pub',version:1,period:period.start+'|'+period.end,assignments:[night]}]
     :url.includes('/inputs?')?[{input_hash:'hash',period}]:[];
   return {ok:true,json:async()=>data} as Response;
 });
 render(<PlanningWorkspace/>);
 await screen.findByText('表示する計画期間を取得中…');
 await screen.findByText('公開版 1：1 件');
 expect(screen.queryByRole('region',{name:'月間勤務表（横スクロール可能）'})).not.toBeInTheDocument();
 await act(async()=>finishInput({ok:true,json:async()=>({input_hash:'hash',snapshot:{period,people:[{person_id:'self',name:'本人'}],contracts:[],candidates:[night]}})} as Response));
 const calendar=await screen.findByRole('region',{name:'月間勤務表（横スクロール可能）'});
 expect(within(calendar).getByRole('button',{name:/2026-02-01/})).toBeInTheDocument();
});

test('publication display keys and draft baseline are independent across planning periods',()=>{
 const jan=monthInterval('2026-01')!,feb=monthInterval('2026-02')!;
 const earlier=duty('reused','2026-01-31T22:00:00+09:00','2026-02-01T02:00:00+09:00');
 const later=duty('reused','2026-02-01T20:00:00+09:00','2026-02-02T04:00:00+09:00');
 const publications=[{publication_id:'jan',period:jan.start+'|'+jan.end,assignments:[earlier]},
  {publication_id:'feb',period:feb.start+'|'+feb.end,assignments:[later]}];
 const view=publicationCalendar(publications,feb);
 expect(view.all.map(d=>d.display_key)).toEqual(['["publication","jan","reused"]','["publication","feb","reused"]']);
 expect(view.comparison.map(d=>d.start)).toEqual([later.start]);
 expect(view.fixed.map(d=>d.start)).toEqual([earlier.start]);
 const errors=jest.spyOn(console,'error');
 render(<MonthlySchedule people={[]} duties={view.all} previous={view.comparison} period={feb} draft={false} published/>);
 const list=screen.getByLabelText('日別・職員別の勤務一覧');
 expect(within(list).getAllByRole('button',{name:/詳細を表示/})).toHaveLength(2);
 expect(errors.mock.calls.some(args=>args.some(value=>String(value).includes('same key')))).toBe(false);
});

test('draft keeps another period fixed and marks a reused candidate ID as added',async()=>{
 window.history.replaceState({},'', '/planning?period=2026-02');
 const jan=monthInterval('2026-01')!,feb=monthInterval('2026-02')!;
 const earlier=duty('reused','2026-01-31T22:00:00+09:00','2026-02-01T02:00:00+09:00');
 const later=duty('reused','2026-02-01T20:00:00+09:00','2026-02-02T04:00:00+09:00');
 global.fetch=jest.fn(async(input:RequestInfo|URL)=>{
  const url=String(input);
  const value=url.endsWith('/scopes')?[{scope_id:'hospital/pharmacy',person_id:'self',role:'ADMIN'}]
   :url.includes('/publications?')?[{publication_id:'jan',version:1,period:jan.start+'|'+jan.end,assignments:[earlier],validation_status:'valid'}]
   :url.includes('/inputs/latest')?{input_hash:'hash',snapshot:{period:feb,people:[{person_id:'self',name:'本人'}],contracts:[],candidates:[later],leaves:[]}}
   :url.includes('/inputs?')?[{input_hash:'hash',period:feb}]
   :url.includes('/jobs/by-key')?{job:{job_id:'job',status:'FEASIBLE',result:{draft_id:'draft'}}}
   :url.includes('/drafts/')?{draft_id:'draft',version:1,status:'DRAFT',input_hash:'hash',proposal:{duty_ids:['reused'],leave_ids:[]},review_hash:null}:[];
  return {ok:true,json:async()=>value} as Response;
 });
 render(<PlanningWorkspace/>);
 fireEvent.click(await screen.findByRole('button',{name:'勤務案を生成'}));
 await screen.findByRole('heading',{name:'月間勤務表 — 下書き（未公開）'});
 const list=screen.getByLabelText('日別・職員別の勤務一覧');
 expect(within(list).getAllByRole('button',{name:/詳細を表示/})).toHaveLength(2);
 expect(within(list).getByRole('button',{name:/別期間の公開勤務（固定）/})).not.toHaveTextContent('追加');
 expect(within(list).getByRole('button',{name:/（追加）/})).toHaveTextContent('20:00');
 expect(within(list).queryByText(/削除：/)).not.toBeInTheDocument();
});
