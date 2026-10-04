import {render,screen,waitFor} from '@testing-library/react';
import PlanningWorkspace from '../PlanningWorkspace';

jest.mock('../PlanningRequests',()=>({__esModule:true,default:()=>null}));
jest.mock('../ContractWorkflow',()=>({__esModule:true,default:()=>null}));
jest.mock('../FlexSettlementPanel',()=>({__esModule:true,default:()=>null}));
afterEach(()=>{jest.restoreAllMocks();window.history.replaceState({},'', '/');});

test('a link from another page reaches its section after loading, once', async () => {
 window.history.replaceState({},'', '/planning?scope=hospital%2Fpharmacy&period=2026-02#published-heading');
 const scrolled:string[]=[];
 Element.prototype.scrollIntoView=function(this:Element){scrolled.push(this.id);} as never;
 global.fetch=jest.fn(async(input:RequestInfo|URL)=>({ok:true,json:async()=>String(input).endsWith('/scopes')?[{scope_id:'hospital/pharmacy',person_id:'self',role:'PHARMACIST'}]:[]} as Response));
 const {rerender}=render(<PlanningWorkspace/>);
 await screen.findByRole('heading',{name:'公開済み勤務'});
 await waitFor(()=>expect(scrolled).toEqual(['published-heading']));
 rerender(<PlanningWorkspace/>);
 expect(scrolled).toEqual(['published-heading']);
});

test('without a hash the page does not move', async () => {
 window.history.replaceState({},'', '/planning?scope=hospital%2Fpharmacy&period=2026-02');
 const scrolled:string[]=[];
 Element.prototype.scrollIntoView=function(this:Element){scrolled.push(this.id);} as never;
 global.fetch=jest.fn(async(input:RequestInfo|URL)=>({ok:true,json:async()=>String(input).endsWith('/scopes')?[{scope_id:'hospital/pharmacy',person_id:'self',role:'PHARMACIST'}]:[]} as Response));
 render(<PlanningWorkspace/>);
 await screen.findByRole('heading',{name:'公開済み勤務'});
 expect(scrolled).toEqual([]);
});
