import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import GrantAssessment from '../GrantAssessment';
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body} as Response);
const context={input_hash:'h',source_revision:3,findings:[],accounts:[{account_id:'g',person_id:'p',employer_id:'e',granted_on:'2026-04-01',statutory_days:3}]};
beforeEach(()=>Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('key-grant')}));
const passed={status:'pass',expected_statutory_days:3,imported_statutory_days:3,findings:[],source:'https://example.invalid'};
async function fill(basis:string,result:unknown=passed){
 const posts:any[]=[];
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){posts.push(JSON.parse(o.body));return response(result);}return response(context);}) as any;
 render(<GrantAssessment scope="hospital/pharmacy"/>);
 fireEvent.click(screen.getByText('最新の付与原本を読み込む'));
 fireEvent.change(await screen.findByLabelText('照合する付与ロット'),{target:{value:'g'}});
 fireEvent.change(screen.getByLabelText('確認済み勤続月数'),{target:{value:'6'}});
 fireEvent.change(screen.getByLabelText('週の所定労働時間'),{target:{value:'20'}});
 fireEvent.change(screen.getByLabelText('所定日数の基準'),{target:{value:basis}});
 fireEvent.change(screen.getByLabelText('出勤率の分子（人事確認済み日数）'),{target:{value:'90'}});
 fireEvent.change(screen.getByLabelText('出勤率の分母（人事確認済み日数）'),{target:{value:'100'}});
 fireEvent.change(screen.getByLabelText('付与照合の原本参照'),{target:{value:'人事原本'}});
 fireEvent.change(screen.getByLabelText('付与照合の確認者'),{target:{value:'人事担当'}});
 return posts;
}
test('shift-based basis sends the actual working days and their period',async()=>{
 const posts=await fill('shift_actual');
 expect(screen.queryByLabelText('年の所定労働日数')).toBeNull();
 fireEvent.change(screen.getByLabelText('実績の期間'),{target:{value:'first_six_months'}});
 fireEvent.change(screen.getByLabelText('労働日数の実績（人事確認済み）'),{target:{value:'37'}});
 fireEvent.click(screen.getByRole('button',{name:'通常・比例付与を照合して記録'}));
 await waitFor(()=>expect(posts).toHaveLength(1));
 const payload=posts[0].payload;
 expect(payload).toMatchObject({schedule_basis:'shift_actual',actual_work_days:37,actual_period:'first_six_months',guideline_year_days:null,scheduled_year_days:null});
});
test('weekly basis keeps the previous request shape without shift fields',async()=>{
 const posts=await fill('weekly');
 fireEvent.change(screen.getByLabelText('週の所定労働日数'),{target:{value:'4'}});
 fireEvent.click(screen.getByRole('button',{name:'通常・比例付与を照合して記録'}));
 await waitFor(()=>expect(posts).toHaveLength(1));
 const payload=posts[0].payload;
 expect(payload.scheduled_week_days).toBe(4);
 expect(Object.keys(payload)).not.toEqual(expect.arrayContaining(['actual_work_days']));
});
test('a basis date before the guidance revision shows the HR hold and sends a confirmation only when entered',async()=>{
 const held={...passed,status:'unverified',computed_status:'pass',guidance:{version:'2026-06-19',basis_before_revision:true,confirmed:false}};
 const posts=await fill('shift_actual',held);
 fireEvent.change(screen.getByLabelText('労働日数の実績（人事確認済み）'),{target:{value:'37'}});
 fireEvent.click(screen.getByRole('button',{name:'通常・比例付与を照合して記録'}));
 await waitFor(()=>expect(posts).toHaveLength(1));
 expect(Object.keys(posts[0].payload)).not.toContain('guidance_confirmation');
 expect(await screen.findByText(/平16\.8\.27基発0827001号/)).toHaveTextContent('計算上の判定：一致');
 fireEvent.change(screen.getByLabelText(/人事の確認記録/),{target:{value:'人事の適用記録'}});
 fireEvent.click(screen.getByRole('button',{name:'通常・比例付与を照合して記録'}));
 await waitFor(()=>expect(posts).toHaveLength(2));
 expect(posts[1].payload.guidance_confirmation).toEqual({reference:'人事の適用記録',verified_by:'人事担当',status:'verified'});
});
test('a confirmation is not sent for a series whose basis date is on or after the revision',async()=>{
 const series={...context,accounts:[{account_id:'g',person_id:'p',employer_id:'e',granted_on:'2026-04-01',statutory_days:3,grant_cycle_id:'c'},
  {account_id:'g2',person_id:'p',employer_id:'e',granted_on:'2026-07-01',statutory_days:2,grant_cycle_id:'c'}]};
 const posts:any[]=[];
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){posts.push(JSON.parse(o.body));return response(passed);}return response(series);}) as any;
 render(<GrantAssessment scope="hospital/pharmacy"/>);
 fireEvent.click(screen.getByText('最新の付与原本を読み込む'));
 fireEvent.change(await screen.findByLabelText('照合する付与ロット'),{target:{value:'g'}});
 for(const [label,value] of [['確認済み勤続月数','6'],['週の所定労働時間','20'],['出勤率の分子（人事確認済み日数）','90'],['出勤率の分母（人事確認済み日数）','100'],['付与照合の原本参照','人事原本'],['付与照合の確認者','人事担当'],['人事が確認した付与基準日','2026-07-01'],['系列全体の人事原本参照','系列原本']])
  fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.change(screen.getByLabelText('所定日数の基準'),{target:{value:'shift_actual'}});
 fireEvent.change(screen.getByLabelText('労働日数の実績（人事確認済み）'),{target:{value:'37'}});
 fireEvent.change(screen.getByLabelText(/人事の確認記録/),{target:{value:'人事の適用記録'}});
 fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'通常・比例付与を照合して記録'}));
 await waitFor(()=>expect(posts).toHaveLength(1));
 expect(posts[0].payload.basis_date).toBe('2026-07-01');
 expect(Object.keys(posts[0].payload)).not.toContain('guidance_confirmation');
});
