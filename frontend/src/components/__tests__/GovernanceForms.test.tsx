import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import GovernanceForms from '../GovernanceForms';
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body} as Response);
beforeEach(()=>Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('key-governance')}));
test('retention conflict retains proposed value and requires three-way review before revision retry',async()=>{
 const policy={category:'planning_history',purpose:'編集開始目的',anchor:'period_end',retention_days:30,legal_minimum_days:0,effective_from:'2026-01-01',effective_until:'2027-01-01',owner:'管理者',next_review:'2026-12-01',evidence:{reference:'原本',status:'unverified'}};
 let state={rules:[{revision:1,payload:policy}],cases:[]};const posts:any[]=[];
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){const b=JSON.parse(o.body);posts.push(b);if(posts.length===1){state={rules:[{revision:2,payload:{...policy,purpose:'現在の目的'}}],cases:[]};return response({},409);}state={rules:[{revision:3,payload:b.payload}],cases:[]};return response({});}return response(state);}) as any;
 render(<GovernanceForms scope="hospital/pharmacy" admin onChanged={()=>{}}/>);await screen.findByText('保存規則の確認・改定');fireEvent.click(screen.getByText('保存規則の確認・改定'));fireEvent.change(screen.getByLabelText('利用目的'),{target:{value:'編集中の目的'}});fireEvent.click(screen.getByRole('button',{name:'保存規則の改定を記録'}));await screen.findByText('保存規則・本人対応の競合確認');expect(screen.getByRole('button',{name:'保存規則の改定を記録'})).toBeDisabled();expect(screen.getByLabelText('利用目的')).toHaveValue('編集中の目的');fireEvent.click(screen.getByRole('button',{name:'三つの内容を確認して再送を許可'}));fireEvent.click(screen.getByRole('button',{name:'保存規則の改定を記録'}));await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[1].expected_revision).toBe(2);expect(posts[1].payload.purpose).toBe('編集中の目的');await screen.findByText('判断と履歴を記録しました。');
});
test('rule chains are selected and revised per retention anchor within one category',async()=>{
 const base={category:'planning_history',purpose:'最終更新から',anchor:'last_activity',retention_days:365,legal_minimum_days:0,effective_from:'2026-01-01',effective_until:'2036-01-01',owner:'管理者',next_review:'2029-01-01',evidence:{reference:'原本',status:'verified',verified_by:'担当'}};
 const state={rules:[{revision:2,payload:base},{revision:1,payload:{...base,anchor:'period_end',purpose:'期間終了から'}}],cases:[]};const posts:any[]=[];
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){posts.push(JSON.parse(o.body));return response({});}return response(state);}) as any;
 render(<GovernanceForms scope="hospital/pharmacy" admin onChanged={()=>{}}/>);await screen.findByText('保存規則の確認・改定');fireEvent.click(screen.getByText('保存規則の確認・改定'));
 expect(screen.getByLabelText('利用目的')).toHaveValue('最終更新から');expect(screen.getByText('取得した現在版：2')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('保存期間の起算'),{target:{value:'period_end'}});
 expect(await screen.findByDisplayValue('期間終了から')).toBeInTheDocument();expect(screen.getByText('取得した現在版：1')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('利用目的'),{target:{value:'期間終了からの改定'}});fireEvent.click(screen.getByRole('button',{name:'保存規則の改定を記録'}));
 await waitFor(()=>expect(posts).toHaveLength(1));expect(posts[0].expected_revision).toBe(1);expect(posts[0].payload.anchor).toBe('period_end');
});
