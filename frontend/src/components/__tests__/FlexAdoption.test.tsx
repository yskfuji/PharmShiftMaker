import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import FlexAdoptionSettings,{settlementStarts,validate} from '../FlexAdoptionSettings';
import FlexSettlementPanel,{hm} from '../FlexSettlementPanel';
import GlobalNavigation from '../GlobalNavigation';
import MonthlySchedule from '../MonthlySchedule';
import {currentNavigation} from '@/lib/navigation';
import {diagnosticText,findingStatus,findingText} from '@/lib/findingText';
import {regimeLabel} from '@/lib/regimeLabels';

// Facility flextime adoption (user decisions 2026-09-28): two administrators,
// check answers before registering, errors linked to their fields, and the
// shared navigation. Synthetic data only.
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body,text:async()=>JSON.stringify(body)} as Response);
const evidence={reference:'就業規則第20条（合成）',status:'verified',verified_by:'人事A',valid_until:null};
const future=(()=>{const d=new Date(Date.now()+9*3600000);d.setUTCMonth(d.getUTCMonth()+2,1);return d.toISOString().slice(0,10);})();
const adoption=(status:string,created_by:string)=>({adoption_id:'flex-1',employer_id:'hospital',establishment_id:'site-hospital',start:`${future}T00:00:00+09:00`,end:'2029-01-01T00:00:00+09:00',
 target_scope:'薬剤部の薬剤師',settlement_months:1,settlement_anchor:future,total_hours_rule:'statutory_frame',agreed_total_description:'暦日数÷7×40時間',standard_day_seconds:28800,
 work_rules_evidence:evidence,agreement_evidence:evidence,status,created_by,created_at:'2026-09-28T00:00:00Z'});
const listing=(over:Record<string,unknown>={})=>({viewer:'admin',can_manage:true,manage_refusal:null,adoptions:[],enrollments:[],
 establishments:[{establishment_id:'site-hospital',employer_id:'hospital',start:'2024-12-01T00:00:00+09:00',end:'2029-01-01T00:00:00+09:00'}],
 people:[{person_id:'p0',name:'薬剤師一'},{person_id:'p1',name:'薬剤師二'}],...over});
beforeEach(()=>{let n=0;Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn(()=>`00000000-0000-4000-8000-00000000000${n++}`)});});
afterEach(()=>jest.restoreAllMocks());

function serve(state:{listing:any;impact?:any},posts:{url:string;body:any}[]=[]){
 global.fetch=jest.fn(async(url:any,options:any)=>{
  const path=String(url);
  if(path.includes('/planning/scopes'))return response([{scope_id:'hospital/pharmacy',role:'ADMIN',person_id:'p0'}]);
  if(options?.method==='POST'){const body=JSON.parse(options.body);posts.push({url:path,body});return response({entity_id:'x',revision:1,status:'registered',enrollments_needing_another_admin:[]});}
  if(path.includes('/impact'))return response(state.impact);
  return response(state.listing);
 }) as any;
 return posts;
}

test('the form checks the agreement terms the law requires before registering',()=>{
 const base={establishment_id:'site-hospital',target_scope:'薬剤師',settlement_months:'1',settlement_anchor:future,last_day:'2028-12-31',total_hours_rule:'statutory_frame' as const,
  rest_weekdays:[],agreed_total_description:'x',standard_day:'8:00',flexible_start:'07:00',flexible_end:'20:00',core_start:'10:00',core_end:'15:00',
  work_rules:{...evidence,status:'verified' as const,valid_until:null},agreement:{...evidence,status:'verified' as const,valid_until:null},
  filed_on:'',office:'',filing:{reference:'',status:'unverified' as const,verified_by:null,valid_until:null},valid_until:'',participants:[]};
 expect(validate(base)).toEqual({});
 expect(validate({...base,core_start:'06:00'}).core_start).toMatch(/内側/);
 expect(validate({...base,core_start:'09:00',core_end:'18:00'}).core_end).toMatch(/短く/);
 expect(validate({...base,flexible_start:'',flexible_end:''}).core_start).toMatch(/フレキシブルタイムも/);
 expect(validate({...base,settlement_anchor:'2020-01-01'}).settlement_anchor).toMatch(/明日以降/);
 expect(validate({...base,total_hours_rule:'full_two_day_weekend',rest_weekdays:[6]}).rest_weekdays).toMatch(/2日以上/);
 const three=validate({...base,settlement_months:'3'});
 expect(Object.keys(three).sort()).toEqual(['filed_on','filing_reference','office','valid_until']);
 expect(validate({...base,work_rules:{...base.work_rules,verified_by:''}}).work_rules_verified_by).toMatch(/確認した人/);
});

test('settlement start days follow the server (month ends are clamped)',()=>{
 expect(settlementStarts('2024-10-01',1,'2027-01-01','2026-09-28',3)).toEqual(['2026-10-01','2026-11-01','2026-12-01']);
 expect(settlementStarts('2027-01-31',1,'2027-05-01')).toEqual(['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
 expect(settlementStarts('2027-04-01',3,'2028-01-01')).toEqual(['2027-04-01','2027-07-01','2027-10-01']);
});

test('errors are summarized, linked to their fields, and not announced as alerts',async()=>{
 serve({listing:listing()});
 render(<FlexAdoptionSettings/>);
 fireEvent.click(await screen.findByRole('button',{name:'フレックスタイム制の採用を登録する'}));
 fireEvent.click(screen.getByRole('button',{name:'入力内容を確認する'}));
 const summary=await screen.findByRole('heading',{name:/入力内容に誤りがあります/});
 expect(summary.parentElement).toHaveFocus();
 const target=screen.getByLabelText(/^対象労働者の範囲/);
 expect(target).toHaveAttribute('aria-invalid','true');
 const described=target.getAttribute('aria-describedby')!.split(' ').map(id=>document.getElementById(id)?.textContent).join(' ');
 expect(described).toMatch(/エラー：協定で定めた対象労働者の範囲/);
 expect(screen.queryAllByRole('alert')).toHaveLength(0);
});

test('check answers lists each answer with a change link, then registers the adoption and its participants',async()=>{
 const posts=serve({listing:listing()});
 render(<FlexAdoptionSettings/>);
 fireEvent.click(await screen.findByRole('button',{name:'フレックスタイム制の採用を登録する'}));
 fireEvent.change(screen.getByLabelText(/^事業場/),{target:{value:'site-hospital'}});
 fireEvent.change(screen.getByLabelText(/^対象労働者の範囲/),{target:{value:'薬剤部の常勤の薬剤師'}});
 fireEvent.change(screen.getByLabelText(/^清算期間の起算日（採用の開始日）/),{target:{value:future}});
 fireEvent.change(screen.getByLabelText(/^採用の最終日（この日を含む）/),{target:{value:'2028-12-31'}});
 for(const group of ['就業規則の規定（始業・終業の時刻を労働者に委ねる定め）','労使協定']){
  const box=screen.getByRole('group',{name:group});
  fireEvent.change(within(box).getByLabelText(/^資料名・保管場所/),{target:{value:'原本（合成）'}});
 }
 fireEvent.click(screen.getByLabelText('薬剤師二'));
 fireEvent.click(screen.getByRole('button',{name:'入力内容を確認する'}));
 expect(await screen.findByRole('heading',{name:/内容の確認/})).toHaveFocus();
 expect(screen.getByText(/根拠に未確認のものがあります/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:/^変更\s*（対象労働者の範囲）$/}));
 await waitFor(()=>expect(screen.getByLabelText(/^対象労働者の範囲/)).toHaveFocus());
 fireEvent.click(screen.getByRole('button',{name:'入力内容を確認する'}));
 fireEvent.click(await screen.findByRole('button',{name:'この内容で登録する（確認待ち）'}));
 await screen.findByText(/別の管理者が影響を確認して確認するまで/,{selector:'[role="status"]'});
 expect(posts.map(p=>p.url.split('/compliance/')[1].split('?')[0])).toEqual(['flex-adoptions','flex-enrollments']);
 const payload=posts[0].body.payload;
 expect(payload).toMatchObject({employer_id:'hospital',start:`${future}T00:00:00+09:00`,end:'2029-01-01T00:00:00+09:00',settlement_months:1,standard_day_seconds:28800});
 expect(payload).not.toHaveProperty('status');expect(payload).not.toHaveProperty('created_by');
 expect(posts[1].body.payload).toMatchObject({person_id:'p1',adoption_id:payload.adoption_id,start:`${future}T00:00:00+09:00`});
});

test('the registering administrator cannot confirm; another reviews the impact first',async()=>{
 serve({listing:listing({adoptions:[{entity_id:'flex-1',revision:1,payload:adoption('registered','admin')}]})});
 const {unmount}=render(<FlexAdoptionSettings/>);
 expect(await screen.findByText(/あなたが登録したため、確認は別の管理者が行います/)).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/確認して採用する/})).toBeNull();
 unmount();
 const impact={adoption_id:'flex-1',status:'registered',people:[],timed_duties:[{scope_id:'hospital/pharmacy',duty_id:'d1',person_id:'p1',start:`${future}T09:00:00+09:00`}],
  blocking:['労使協定の根拠が確認済みではありません。'],next_steps:['雇用条件を登録する'],impact_hash:'a'.repeat(64)};
 const posts=serve({listing:listing({viewer:'leader',adoptions:[{entity_id:'flex-1',revision:1,payload:adoption('registered','admin')}]}),impact});
 render(<FlexAdoptionSettings/>);
 fireEvent.click(await screen.findByRole('button',{name:'確認の前に影響を表示する'}));
 expect(await screen.findByText('開始日以降の時刻付きの勤務（割当から外す必要があります）：1件')).toBeInTheDocument();
 const confirm=screen.getByRole('button',{name:'内容と影響を確認して採用する'});
 expect(confirm).toBeDisabled();expect(confirm).toHaveAccessibleDescription('上の理由を解消するまで確認できません。');
 impact.blocking=[];
 fireEvent.click(screen.getByRole('button',{name:'確認の前に影響を表示する'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'内容と影響を確認して採用する'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'内容と影響を確認して採用する'}));
 await waitFor(()=>expect(posts).toHaveLength(1));
 expect(posts[0].body).toMatchObject({expected_revision:1,impact_hash:'a'.repeat(64)});
});

test('a withdrawal needs a reason',async()=>{
 const posts=serve({listing:listing({viewer:'leader',adoptions:[{entity_id:'flex-1',revision:2,payload:{...adoption('confirmed','admin'),reviewed_by:'leader'}}]})});
 render(<FlexAdoptionSettings/>);
 fireEvent.click(await screen.findByText('採用を取り下げる'));
 const button=screen.getByRole('button',{name:'理由を記録して取り下げる'});
 expect(button).toBeDisabled();
 fireEvent.change(screen.getByLabelText('取り下げる理由（必須）'),{target:{value:'協定の失効'}});
 fireEvent.click(button);
 await waitFor(()=>expect(posts[0]?.body).toMatchObject({expected_revision:2,reason:'協定の失効'}));
});

test('navigation marks the current section; the same destinations everywhere',()=>{
 expect(currentNavigation('/planning/workflows/leave')?.label).toBe('業務管理');
 expect(currentNavigation('/planning')?.label).toBe('勤務表・計画');
 render(<GlobalNavigation current="/settings"/>);
 const nav=screen.getByRole('navigation',{name:'主な画面'});
 expect(within(nav).getByRole('link',{name:'施設設定'})).toHaveAttribute('aria-current','page');
 expect(within(nav).getAllByRole('link').map(a=>a.getAttribute('href'))).toEqual(['/dashboard','/planning','/planning/workflows','/settings']);
});

test('flextime rows say why they have no duties, and findings read in Japanese',()=>{
 render(<MonthlySchedule people={[{person_id:'p0',name:'薬剤師一'}]} duties={[]} previous={[]} period={{start:'2026-01-05T00:00:00+09:00',end:'2026-01-07T00:00:00+09:00'}} draft={false} published={false} flexPeople={['p0']}/>);
 expect(screen.getByRole('rowheader',{name:/フレックスタイム制（時刻付き勤務の割当なし）/})).toBeInTheDocument();
 expect(screen.getAllByLabelText('フレックスタイム制のため割当なし')).toHaveLength(2);
 expect(findingText('Flextime is not adopted for this person: no confirmed facility adoption and enrolment cover emp-1')).toMatch(/^フレックスタイム制が採用されていません。.*emp-1/);
 expect(findingText('Something else')).toBe('Something else');
 expect(findingStatus('unverified')).toBe('未確認');
 expect(diagnosticText('Demand d0 at x: at most 1 eligible people, requires 2; 1 on flextime cannot take timed duties')).toMatch(/うち 1 人はフレックスタイム制/);
 expect(regimeLabel('flex')).toBe('フレックスタイム制');
 expect(hm(771428)).toBe('214:17');
});

test('the settlement panel shows each period with hours and minutes',async()=>{
 global.fetch=jest.fn(async()=>response({input_hash:'h',people:[{person_id:'p0',name:'薬剤師一',settlements:[{kind:'flextime',start:'2026-04-01',end:'2026-07-01',frame_seconds:1872000,worked_seconds:1944000,
  monthly_overtime_seconds:{'2026-04-01':20572},final_month_overtime_seconds:51428,unattributed_seconds:0}]}],findings:[]})) as any;
 render(<FlexSettlementPanel scope="hospital/pharmacy" inputHash="h"/>);
 const row=await screen.findByRole('row',{name:/薬剤師一/});
 expect(row).toHaveTextContent('2026-04-01 〜 2026-06-30');expect(row).toHaveTextContent('520:00');expect(row).toHaveTextContent('540:00');
 expect(row).toHaveTextContent('5:42');expect(row).toHaveTextContent('14:17');
 expect(screen.getByRole('table',{name:/職員別・清算期間別/})).toBeInTheDocument();
});

test('after the start an adoption is ended at a settlement period start, not withdrawn',async()=>{
 const past=(()=>{const d=new Date(Date.now()+9*3600000);d.setUTCMonth(d.getUTCMonth()-1,1);return d.toISOString().slice(0,10);})();
 const running={...adoption('confirmed','admin'),reviewed_by:'leader',start:`${past}T00:00:00+09:00`,settlement_anchor:past};
 const posts=serve({listing:listing({viewer:'leader',adoptions:[{entity_id:'flex-1',revision:2,payload:running}]})});
 render(<FlexAdoptionSettings/>);
 fireEvent.click(await screen.findByText('採用を終了する'));
 expect(screen.queryByText('採用を取り下げる')).toBeNull();
 const options=within(screen.getByLabelText('終了日（この日から採用しない）')).getAllByRole('option').map(o=>o.textContent).slice(1);
 expect(options.every(d=>d!>past&&d!.endsWith('-01'))).toBe(true);
 fireEvent.change(screen.getByLabelText('終了日（この日から採用しない）'),{target:{value:options[0]}});
 fireEvent.change(screen.getByLabelText('終了する理由（必須）'),{target:{value:'協定の終了'}});
 fireEvent.click(screen.getByRole('button',{name:'理由を記録して終了する'}));
 await waitFor(()=>expect(posts[0]?.url).toContain('/flex-adoptions/flex-1/end'));
 expect(posts[0].body).toMatchObject({expected_revision:2,end_on:options[0],reason:'協定の終了'});
});

test('a resend after a lost reply carries the same adoption and key',async()=>{
 const bodies:any[]=[];let lost=true;
 global.fetch=jest.fn(async(url:any,options:any)=>{
  const path=String(url);
  if(path.includes('/planning/scopes'))return response([{scope_id:'hospital/pharmacy',role:'ADMIN',person_id:'p0'}]);
  if(options?.method==='POST'){bodies.push(JSON.parse(options.body));if(lost){lost=false;throw new TypeError('network lost');}return response({entity_id:'x',revision:1});}
  return response(listing());
 }) as any;
 render(<FlexAdoptionSettings/>);
 fireEvent.click(await screen.findByRole('button',{name:'フレックスタイム制の採用を登録する'}));
 fireEvent.change(screen.getByLabelText(/^事業場/),{target:{value:'site-hospital'}});
 fireEvent.change(screen.getByLabelText(/^対象労働者の範囲/),{target:{value:'薬剤師'}});
 fireEvent.change(screen.getByLabelText(/^清算期間の起算日/),{target:{value:future}});
 fireEvent.change(screen.getByLabelText(/^採用の最終日/),{target:{value:'2028-12-31'}});
 for(const group of ['就業規則の規定（始業・終業の時刻を労働者に委ねる定め）','労使協定'])fireEvent.change(within(screen.getByRole('group',{name:group})).getByLabelText(/^資料名・保管場所/),{target:{value:'原本'}});
 fireEvent.click(screen.getByRole('button',{name:'入力内容を確認する'}));
 fireEvent.click(await screen.findByRole('button',{name:'この内容で登録する（確認待ち）'}));
 await screen.findByText(/network lost/);
 fireEvent.click(screen.getByRole('button',{name:'この内容で登録する（確認待ち）'}));
 await waitFor(()=>expect(bodies).toHaveLength(2));
 expect(bodies[1]).toEqual(bodies[0]);
});

test('an account without an administrator membership is told so',async()=>{
 global.fetch=jest.fn(async()=>response([{scope_id:'hospital/pharmacy',role:'PHARMACIST',person_id:'p1'}])) as any;
 render(<FlexAdoptionSettings/>);
 expect(await screen.findByText(/管理者の所属がありません/)).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'勤務表・計画'})).toHaveAttribute('href','/planning');
});

test('the ideal workspace scope is honored instead of silently choosing the first administrator membership',async()=>{
 const urls:string[]=[];
 global.fetch=jest.fn(async(url:any)=>{
  const value=String(url);urls.push(value);
  if(value.includes('/planning/scopes'))return response([
   {scope_id:'hospital/first',role:'ADMIN',person_id:'p0'},
   {scope_id:'hospital/selected',role:'ADMIN',person_id:'p0'},
  ]);
  return response(listing());
 }) as any;
 render(<FlexAdoptionSettings scopeId="hospital/selected"/>);
 expect(await screen.findByRole('heading',{name:'この施設のフレックスタイム制'})).toBeInTheDocument();
 expect(screen.queryByLabelText('施設・部署')).toBeNull();
 expect(urls.some(url=>url.includes('scope_id=hospital%2Fselected'))).toBe(true);
 expect(urls.some(url=>url.includes('scope_id=hospital%2Ffirst'))).toBe(false);
});
