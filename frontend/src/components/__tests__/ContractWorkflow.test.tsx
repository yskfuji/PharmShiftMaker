import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import ContractWorkflow from '../ContractWorkflow';

const person={person_id:'p1',name:'職員一'};
function fixture(){return {role:'ADMIN',people:[person],contracts:[],employments:[],establishments:[],capabilities:[],duty_options:[{kind:'DAY',task:'調剤',location:'薬剤部'}],records:[] as any[]};}
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body,text:async()=>JSON.stringify(body)} as Response);
beforeEach(()=>{Object.defineProperty(global,'structuredClone',{configurable:true,value:(value:unknown)=>JSON.parse(JSON.stringify(value))});Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('test-random-key')});});
afterEach(()=>jest.restoreAllMocks());

test('deep-linked person is the initial contract target and other staff records are hidden',async()=>{
 const ctx:any=fixture();ctx.people.push({person_id:'p2',name:'職員二'});ctx.contracts=[
  {revision_id:'contract-p1',relationship_id:'r1',person_id:'p1',employer_id:'e1',start:'2026-01-01T00:00:00Z',end:'2027-01-01T00:00:00Z'},
  {revision_id:'contract-p2',relationship_id:'r2',person_id:'p2',employer_id:'e1',start:'2026-01-01T00:00:00Z',end:'2027-01-01T00:00:00Z'},
 ];
 global.fetch=jest.fn(async()=>response(ctx)) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" initialPersonId="p1" onChanged={()=>{}}/>);
 expect(await screen.findByLabelText('登録する業務')).toHaveValue('contract');
 const candidates=screen.getByLabelText('編集する対象');
 expect(candidates).toHaveTextContent('職員一');
 expect(candidates).not.toHaveTextContent('職員二');
 fireEvent.change(candidates,{target:{value:'new'}});
 expect(screen.getByLabelText('対象職員')).toHaveValue('p1');
});

test('person selection derives current revision; response-loss retries exact body and key',async()=>{
 const ctx=fixture(),requests:any[]=[];let lost=true;
 global.fetch=jest.fn(async(_url:any,options:any)=>{
  if(options?.method==='POST'){const body=JSON.parse(options.body);requests.push(body);ctx.records=[{kind:'person',entity_id:'p1',revision:1,payload:body.payload}];if(lost){lost=false;throw new TypeError('network lost');}return response({revision:1});}
  return response(ctx);
 }) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('編集する対象'),{target:{value:'p1'}});
 fireEvent.change(screen.getByLabelText('職員の氏名'),{target:{value:'訂正した氏名'}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await screen.findByText(/記録を保存して再取得しました/);
 expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(requests[0].expected_revision).toBe(0);expect(requests[0].payload.person_id).toBe('p1');
});

test('keeps the form disabled until dependent views finish reloading',async()=>{
 const ctx=fixture();let finishReload!:()=>void;const dependentReload=new Promise<void>(resolve=>{finishReload=resolve;});
 global.fetch=jest.fn(async(_url:any,options:any)=>{
  if(options?.method==='POST'){const body=JSON.parse(options.body);ctx.records=[{kind:'person',entity_id:'p1',revision:1,payload:body.payload}];return response({revision:1});}
  return response(ctx);
 }) as any;
 const onChanged=jest.fn(()=>dependentReload);
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={onChanged}/>);
 fireEvent.change(await screen.findByLabelText('編集する対象'),{target:{value:'p1'}});
 fireEvent.change(screen.getByLabelText('職員の氏名'),{target:{value:'再読込中も保持する氏名'}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 await waitFor(()=>expect(onChanged).toHaveBeenCalledTimes(1));
 expect(screen.getByRole('button',{name:'この内容を保存・再送'})).toBeDisabled();
 expect(screen.queryByText(/記録を保存して再取得しました/)).not.toBeInTheDocument();
 await act(async()=>{finishReload();await dependentReload;});
 await screen.findByText(/記録を保存して再取得しました/);
 expect(screen.getByRole('button',{name:'この内容を保存・再送'})).toBeEnabled();
 expect(screen.getByLabelText('職員の氏名')).toHaveValue('再読込中も保持する氏名');
});

test('409 retains all three values, blocks save until explicit review and uses new current revision',async()=>{
 const ctx=fixture();ctx.records=[{kind:'person',entity_id:'p1',revision:2,payload:{...person,name:'編集開始名'}}];
 const requests:any[]=[];
 global.fetch=jest.fn(async(_url:any,options:any)=>{
  if(options?.method==='POST'){const body=JSON.parse(options.body);requests.push(body);if(requests.length===1){ctx.records=[{kind:'person',entity_id:'p1',revision:3,payload:{...person,name:'他の管理者の訂正'}}];return response({detail:'conflict'},409);}ctx.records=[{kind:'person',entity_id:'p1',revision:4,payload:body.payload}];return response({revision:4});}
  return response(ctx);
 }) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('編集する対象'),{target:{value:'p1'}});
 fireEvent.change(screen.getByLabelText('職員の氏名'),{target:{value:'保持する編集中名'}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await screen.findByText('競合した内容の確認');
 expect(screen.getByText(/氏名：編集開始名/)).toBeInTheDocument();expect(screen.getByText(/氏名：他の管理者の訂正/)).toBeInTheDocument();expect(screen.getByText(/氏名：保持する編集中名/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'この内容を保存・再送'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'三つの内容を確認し、編集中の内容を保持'}));fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 await screen.findByText(/記録を保存して再取得しました/);expect(requests[1].expected_revision).toBe(3);expect(requests[1].payload.name).toBe('保持する編集中名');
});

test('new capability has candidate selectors and evidence remains unverified by default',async()=>{
 const ctx=fixture(),requests:any[]=[];
 global.fetch=jest.fn(async(_url:any,options:any)=>{if(options?.method==='POST'){requests.push(JSON.parse(options.body));return response({revision:1});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'capability'}});
 fireEvent.change(screen.getByLabelText('対象職員'),{target:{value:'p1'}});fireEvent.change(screen.getByLabelText('担当業務'),{target:{value:'調剤'}});fireEvent.change(screen.getByLabelText('勤務場所'),{target:{value:'薬剤部'}});
 fireEvent.change(screen.getByLabelText('適用開始（日本時間）'),{target:{value:'2026-09-01T00:00:00'}});fireEvent.change(screen.getByLabelText('適用終了（日本時間）'),{target:{value:'2026-10-01T00:00:00'}});
 fireEvent.change(screen.getByLabelText('原本確認の資料名・参照先'),{target:{value:'資格証原本'}});fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0].payload.evidence.status).toBe('unverified');expect(requests[0].payload.start).toBe('2026-08-31T15:00:00.000Z');expect(requests[0].payload.task).toBe('調剤');
});

test('dirty target selection asks before discarding and keeps the edit after cancellation',async()=>{
 const ctx=fixture();global.fetch=jest.fn(async()=>response(ctx)) as any;const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('編集する対象'),{target:{value:'p1'}});fireEvent.change(screen.getByLabelText('職員の氏名'),{target:{value:'未保存名'}});fireEvent.change(screen.getByLabelText('登録する業務'),{target:{value:'contract'}});
 expect(confirm).toHaveBeenCalled();expect(screen.getByLabelText('職員の氏名')).toHaveValue('未保存名');expect(screen.getByLabelText('登録する業務')).toHaveValue('person');
});

test('agreement selects establishment and employer together and keeps distinct period anchors',async()=>{
 const ctx:any=fixture();ctx.establishments=[{establishment_id:'site1',employer_id:'employer1',start:'2026-01-01T00:00:00+09:00',end:'2027-01-01T00:00:00+09:00'}];const requests:any[]=[];
 global.fetch=jest.fn(async(_url:any,options:any)=>{if(options?.method==='POST'){requests.push(JSON.parse(options.body));return response({revision:1});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'agreement'}});fireEvent.change(screen.getByLabelText('協定を適用する事業場'),{target:{value:'site1'}});
 for(const [label,value] of [['適用開始（日本時間）','2026-09-01T00:00:00'],['適用終了（日本時間）','2026-10-01T00:00:00'],['協定年の起算日','2026-04-01'],['協定月の起算日','2026-09-16'],['原本確認の資料名・参照先','協定原本']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0].payload.establishment_id).toBe('site1');expect(requests[0].payload.employer_id).toBe('employer1');expect(requests[0].payload.month_anchor).toBe('2026-09-16');expect(requests[0].payload.evidence.status).toBe('unverified');
});

test('accounting transition only offers adjacent revisions of same person relationship employer and site',async()=>{
 const ctx:any=fixture();const first={revision_id:'first',person_id:'p1',relationship_id:'rel1',employer_id:'emp1',establishment_id:'site1',start:'2026-09-01T00:00:00+09:00',end:'2026-09-15T00:00:00+09:00'};
 ctx.employments=[first,{...first,revision_id:'adjacent',start:first.end,end:'2026-10-01T00:00:00+09:00'},{...first,revision_id:'wrong-site',establishment_id:'site2',start:first.end,end:'2026-10-01T00:00:00+09:00'}];global.fetch=jest.fn(async()=>response(ctx)) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'accounting_transition'}});fireEvent.change(screen.getByLabelText('切替前の雇用条件'),{target:{value:'first'}});
 const options=Array.from((screen.getByLabelText('連続する切替後の雇用条件') as HTMLSelectElement).options).map(o=>o.value);expect(options).toEqual(['','adjacent']);
});

test('invalid staging is explained while person corrections remain available',async()=>{
 const ctx:any=fixture();ctx.staging_valid=false;ctx.validation_issues=[{message:'Missing or mismatched effective establishment',location:['agreements']}];global.fetch=jest.fn(async()=>response(ctx)) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);await screen.findByRole('alert',{name:'編集中の契約・制度の不整合'});fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'p1'}});expect(screen.getByLabelText('職員の氏名')).toHaveValue('職員一');expect(screen.getByRole('button',{name:'この内容を保存・再送'})).toBeEnabled();
});

test('full selected label and second-precision Japan timestamps stay in wrapping helper text',async()=>{
 const ctx:any=fixture();const employer='非常に長い雇用主名称'.repeat(12);ctx.establishments=[{establishment_id:'site-long',employer_id:employer,start:'2026-08-31T15:00:01Z',end:'2026-09-30T15:00:59Z',evidence:{reference:'原本',status:'unverified',verified_by:null,valid_until:null}}];ctx.records=[{kind:'establishment',entity_id:'site-long',revision:12,payload:ctx.establishments[0]}];global.fetch=jest.fn(async()=>response(ctx)) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'establishment'}});
 expect(screen.getAllByText('現在値：未入力').length).toBeGreaterThanOrEqual(2);
 fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'site-long'}});
 const selected=screen.getByText(`選択中の記録：${employer} 2026-09-01T00:00:01 ～ 2026-10-01T00:00:59（登録第12版）`);
 expect(selected).toHaveClass('[overflow-wrap:anywhere]');expect(screen.getByText('現在値：2026-09-01 00:00:01（日本時間）')).toHaveClass('whitespace-normal');
 expect(screen.getByText('現在値：2026-10-01 00:00:59（日本時間）')).toBeInTheDocument();
 const end=screen.getByLabelText('適用終了（日本時間）');expect(end).toHaveAccessibleDescription('現在値：2026-10-01 00:00:59（日本時間）');
 fireEvent.change(end,{target:{value:'2026-10-02T23:59:07'}});expect(screen.getByText('現在値：2026-10-02 23:59:07（日本時間）')).toBeInTheDocument();
 fireEvent.change(end,{target:{value:''}});expect(end).toHaveAccessibleDescription('現在値：未入力');
});

test('employment derives employer from site, keeps unknown contract order null and records seconds',async()=>{
 const ctx:any=fixture(),requests:any[]=[];ctx.employers=[{employer_id:'e1',name:'勤務先法人'}];ctx.establishments=[{establishment_id:'s1',employer_id:'e1',start:'2026-01-01T00:00:00Z',end:'2027-01-01T00:00:00Z'}];
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){requests.push(JSON.parse(o.body));return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'employment'}});
 for(const [label,value] of [['対象職員','p1'],['雇用先の事業場','s1'],['適用開始（日本時間）','2026-09-01T00:00:01'],['適用終了（日本時間）','2026-10-01T00:00:59'],['兼業申告の確認の資料名・参照先','契約原本']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0].payload).toMatchObject({person_id:'p1',employer_id:'e1',establishment_id:'s1',contract_order:null,method:'standard',start:'2026-08-31T15:00:01.000Z',end:'2026-09-30T15:00:59.000Z'});
});

test('qualification cancellation takes target hash from context and preserves exact effective instant',async()=>{
 const ctx:any=fixture(),requests:any[]=[];ctx.capability_targets=[{target_hash:'original-hash',payload:{person_id:'p1',task:'調剤',location:'薬剤部',start:'2026-01-01T00:00:00Z',end:'2027-01-01T00:00:00Z'}}];
 global.fetch=jest.fn(async(u:any,o:any)=>{if(o?.method==='POST'){requests.push({url:u,...JSON.parse(o.body)});return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'capability_amendment'}});
 for(const [label,value] of [['取消・失効の対象資格','original-hash'],['資格を使用できなくなる日時（日本時間）','2026-09-01T00:00:07'],['資格の取消・失効理由','期限訂正'],['原本確認の資料名・参照先','資格原本訂正']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0].url).toContain('/records/capability_amendment?');expect(requests[0].payload).toMatchObject({person_id:'p1',target_hash:'original-hash',effective_at:'2026-08-31T15:00:07.000Z',reason:'期限訂正'});
});

function leaveFixture(){const ctx:any=fixture();ctx.employments=[{person_id:'p1',employer_id:'e1'}];ctx.leave_accounts=[{account_id:'a1',person_id:'p1',employer_id:'e1',granted_on:'2026-04-01',expires_on:'2028-04-01',granted_days:10,statutory_days:10},{account_id:'a2',person_id:'p2',employer_id:'e2',granted_on:'2026-04-01',expires_on:'2028-04-01',granted_days:10,statutory_days:10}];ctx.leave_policies=[{policy_id:'policy1',person_id:'p1',employer_id:'e1',start:'2026-01-01T00:00:00Z',end:'2027-01-01T00:00:00Z',hours_per_day:8}];ctx.records=ctx.leave_accounts.map((a:any)=>({kind:'leave_account',entity_id:a.account_id,revision:a.account_id==='a1'?7:3,payload:a}));ctx.leave_records=[{event_id:'reserve1',account_id:'a1',kind:'reserve',effective_on:'2026-09-02',quantity:1,unit:'day'}];return ctx;}

test('leave event uses dedicated endpoint, distinguishes reservation and acquisition, and resets dependent selectors',async()=>{
 const ctx=leaveFixture(),requests:any[]=[];global.fetch=jest.fn(async(u:any,o:any)=>{if(o?.method==='POST'){requests.push({url:u,...JSON.parse(o.body)});return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" group="leave" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'leave_record'}});
 fireEvent.change(screen.getByLabelText('対象の付与原本'),{target:{value:'a1'}});fireEvent.change(screen.getByLabelText('対象者・雇用主の取得規則'),{target:{value:'policy1'}});fireEvent.change(screen.getByLabelText('対象の付与原本'),{target:{value:'a2'}});expect(screen.getByLabelText('対象者・雇用主の取得規則')).toHaveValue('');
 for(const [label,value] of [['対象の付与原本','a1'],['対象者・雇用主の取得規則','policy1'],['年休イベント','release'],['解除・取消の元イベント','reserve1'],['イベントの効力日','2026-09-02'],['対象区間の開始（日本時間）','2026-09-02T09:00:00'],['対象区間の終了（日本時間）','2026-09-02T17:00:00'],['原本確認の資料名・参照先','本人の取消申請']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0].url).toContain('/leave-events?');expect(requests[0].expected_revision).toBe(7);expect(requests[0].payload).toMatchObject({account_id:'a1',policy_id:'policy1',kind:'release',related_event_id:'reserve1',unit:'day',quantity:1});
});

test('ledger recording resets selected original when switching between grant and acquisition',async()=>{
 global.fetch=jest.fn(async()=>response(leaveFixture())) as any;render(<ContractWorkflow scope="hospital/pharmacy" group="leave" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'ledger_recording'}});fireEvent.change(screen.getByLabelText('記録日時を付す原本'),{target:{value:'a1'}});fireEvent.change(screen.getByLabelText('記録日時を照合する原本の種類'),{target:{value:'leave_record'}});expect(screen.getByLabelText('記録日時を付す原本')).toHaveValue('');
});

test('leader demand form uses duty selectors and distinct required and target counts',async()=>{
 const ctx:any=fixture();ctx.role='LEADER';ctx.input_hash='period-input';const posts:any[]=[];global.fetch=jest.fn(async(u:any,o:any)=>{if(o?.method==='POST'){posts.push({url:u,...JSON.parse(o.body)});return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" group="demand" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('編集する対象'),{target:{value:'new'}});
 for(const [label,value] of [['配置する業務','調剤'],['配置する場所','薬剤部'],['適用開始（日本時間）','2026-09-01T09:00:00'],['適用終了（日本時間）','2026-09-01T17:00:00'],['必須の配置人数','2'],['希望する配置人数','3'],['原本確認の資料名・参照先','承認済み配置計画']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(posts).toHaveLength(1));expect(posts[0].url).toContain('/records/demand?');expect(posts[0].input_hash).toBe('period-input');expect(posts[0].payload).toMatchObject({minimum:2,target:3,task:'調剤',location:'薬剤部'});
});

test.each(['leave_policy','leave_account'])('%s never inherits obligation-only grant IDs on person selection',async kind=>{
 const ctx=leaveFixture();const posts:any[]=[];global.fetch=jest.fn(async(u:any,o:any)=>{if(o?.method==='POST'){posts.push(JSON.parse(o.body));return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" group="leave" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:kind}});if(kind==='leave_account')fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'new'}});
 for(const [label,value] of [['対象職員','p1'],['年休を管理する雇用主','e1'],['原本確認の資料名・参照先','原本']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 const dates=kind==='leave_policy'?[['適用開始（日本時間）','2026-01-01T00:00:00'],['適用終了（日本時間）','2027-01-01T00:00:00'],['時間年休上限の年起算日','2026-01-01']]:[['原本の付与日','2026-01-01'],['失効日（この日を含まない）','2028-01-01']];for(const [label,value] of dates)fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(posts).toHaveLength(1));expect(posts[0].payload).not.toHaveProperty('qualifying_grant_ids');
 const allowed=kind==='leave_policy'?['policy_id','person_id','employer_id','start','end','hourly_enabled','half_day_enabled','hours_per_day','hourly_quantum','hourly_year_start','hourly_cap_days','evidence']:['account_id','person_id','employer_id','granted_on','expires_on','statutory_days','granted_days','evidence','grant_cycle_id'];expect(Object.keys(posts[0].payload).sort()).toEqual(allowed.sort());
});

test('selected demand period is included in context lookup and mismatched response cannot be submitted',async()=>{
 const ctx:any=fixture();ctx.role='LEADER';ctx.input_hash='wrong-month';const calls:string[]=[];const posts:any[]=[];global.fetch=jest.fn(async(u:any,o:any)=>{calls.push(u);if(o?.method==='POST')posts.push(JSON.parse(o.body));return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" group="demand" inputHash="selected-month" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('編集する対象'),{target:{value:'new'}});expect(calls[0]).toContain('input_hash=selected-month');
 for(const [label,value] of [['配置する業務','調剤'],['配置する場所','薬剤部'],['適用開始（日本時間）','2026-09-01T09:00:00'],['適用終了（日本時間）','2026-09-01T17:00:00'],['原本確認の資料名・参照先','承認済み配置計画']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await screen.findByRole('alert');expect(posts).toHaveLength(0);expect(screen.getByRole('alert')).toHaveTextContent('対象期間の入力版が確認できません');
});

test('leave balance conflict rechecks account revision, preserves event identity and waits for explicit review',async()=>{
 const ctx=leaveFixture(),posts:any[]=[];let n=0;Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn(()=>`id-${++n}`)});
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){const b=JSON.parse(o.body);posts.push(b);if(posts.length===1){ctx.records=ctx.records.map((r:any)=>r.entity_id==='a1'?{...r,revision:8}:r);return response({},409);}ctx.records.push({kind:'leave_record',entity_id:b.payload.event_id,revision:1,payload:b.payload});return response({account_revision:9});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" group="leave" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'leave_record'}});
 for(const [label,value] of [['対象の付与原本','a1'],['対象者・雇用主の取得規則','policy1'],['イベントの効力日','2026-09-02'],['対象区間の開始（日本時間）','2026-09-02T09:00:00'],['対象区間の終了（日本時間）','2026-09-02T17:00:00'],['原本確認の資料名・参照先','新しい予約']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await screen.findByText(/共有残高の版：選択時 7 → 現在 8/);expect(screen.getByRole('button',{name:'この内容を保存・再送'})).toBeDisabled();expect(posts[0].expected_revision).toBe(7);
 fireEvent.click(screen.getByRole('button',{name:'三つの内容を確認し、編集中の内容を保持'}));fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await screen.findByText(/記録を保存して再取得しました/);expect(posts[1].expected_revision).toBe(8);expect(posts[1].payload).toEqual(posts[0].payload);expect(posts[1].idempotency_key).not.toBe(posts[0].idempotency_key);
});

test('lost leave response retries original account version and key despite server-side account increment',async()=>{
 const ctx=leaveFixture(),posts:any[]=[];
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){const b=JSON.parse(o.body);posts.push(b);if(posts.length===1){ctx.records=ctx.records.map((r:any)=>r.entity_id==='a1'?{...r,revision:8}:r);ctx.records.push({kind:'leave_record',entity_id:b.payload.event_id,revision:1,payload:b.payload});throw new TypeError('response lost after commit');}return response({duplicate:true,account_revision:8});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" group="leave" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'leave_record'}});
 for(const [label,value] of [['対象の付与原本','a1'],['対象者・雇用主の取得規則','policy1'],['イベントの効力日','2026-09-02'],['対象区間の開始（日本時間）','2026-09-02T09:00:00'],['対象区間の終了（日本時間）','2026-09-02T17:00:00'],['原本確認の資料名・参照先','予約原本']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await screen.findByText(/記録を保存して再取得しました/);expect(posts).toHaveLength(2);expect(posts[1]).toEqual(posts[0]);expect(posts[1].expected_revision).toBe(7);
});

test('leave account and policy selectors expose their full selected labels without changing labels or IDs',async()=>{
 const ctx=leaveFixture();global.fetch=jest.fn(async()=>response(ctx)) as any;
 const {container}=render(<ContractWorkflow scope="hospital/pharmacy" group="leave" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'leave_record'}});
 fireEvent.change(screen.getByLabelText('対象の付与原本'),{target:{value:'a1'}});
 const account=screen.getByLabelText('対象の付与原本') as HTMLSelectElement;
 expect(account.selectedOptions[0]).toHaveAttribute('value','a1');
 expect(container.querySelector('[data-selected-for="account_id"]')).toHaveTextContent('1. 職員一 2026-04-01付与 10日');
 fireEvent.change(screen.getByLabelText('対象者・雇用主の取得規則'),{target:{value:'policy1'}});
 const policy=screen.getByLabelText('対象者・雇用主の取得規則') as HTMLSelectElement;
 expect(policy.selectedOptions[0]).toHaveAttribute('value','policy1');
 expect(container.querySelector('[data-selected-for="policy_id"]')).toHaveTextContent('1. 2026-01-01T09:00:00 ～ 2027-01-01T09:00:00 1日8時間');
 fireEvent.change(account,{target:{value:'a2'}});
 expect(container.querySelector('[data-selected-for="policy_id"]')).toHaveTextContent('未選択');
});

test('agreement limits match the server: special clause under 100h, otherwise 45h/360h',async()=>{
 const ctx:any=fixture();ctx.establishments=[{establishment_id:'site1',employer_id:'employer1',start:'2026-01-01T00:00:00+09:00',end:'2027-01-01T00:00:00+09:00'}];const requests:any[]=[];
 global.fetch=jest.fn(async(_url:any,options:any)=>{if(options?.method==='POST'){requests.push(JSON.parse(options.body));return response({revision:1});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'agreement'}});fireEvent.change(screen.getByLabelText('協定を適用する事業場'),{target:{value:'site1'}});
 for(const [label,value] of [['適用開始（日本時間）','2026-09-01T00:00:00'],['適用終了（日本時間）','2026-10-01T00:00:00'],['協定年の起算日','2026-04-01'],['協定月の起算日','2026-09-16'],['原本確認の資料名・参照先','協定原本']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 // Submit directly: the explicit check must hold even where the browser's max validation is bypassed.
 const save=()=>fireEvent.submit(screen.getByRole('button',{name:'この内容を保存・再送'}).closest('form')!);
 fireEvent.change(screen.getByLabelText(/協定の月時間外上限/),{target:{value:'162001'}});
 expect(screen.getByLabelText(/協定の月時間外上限/)).toHaveAttribute('max','162000');save();
 expect(await screen.findByText(/月45時間（162000秒）/)).toBeInTheDocument();expect(requests).toHaveLength(0);
 fireEvent.click(screen.getByLabelText(/特別条項の定めがある/));
 fireEvent.change(screen.getByLabelText(/協定の月時間外上限/),{target:{value:'360000'}});
 expect(screen.getByLabelText(/協定の月時間外上限/)).toHaveAttribute('max','359999');save();
 expect(await screen.findByText(/100時間（360000秒）未満/)).toBeInTheDocument();expect(requests).toHaveLength(0);
 fireEvent.change(screen.getByLabelText(/協定の月時間外上限/),{target:{value:'359999'}});save();
 await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0].payload.monthly_limit_seconds).toBe(359999);
});

test('a stored 100h agreement can be re-saved unchanged; annual limits follow the special clause',async()=>{
 const ctx:any=fixture();ctx.establishments=[{establishment_id:'site1',employer_id:'employer1',start:'2026-01-01T00:00:00+09:00',end:'2027-01-01T00:00:00+09:00'}];
 const stored={agreement_id:'a1',employer_id:'employer1',establishment_id:'site1',start:'2026-09-01T00:00:00+09:00',end:'2026-10-01T00:00:00+09:00',year_start:'2026-04-01',month_anchor:'2026-09-16',daily_limit_seconds:0,monthly_limit_seconds:360000,annual_limit_seconds:2592000,special_clause:true,holiday_work_permitted:false,evidence:{reference:'協定原本',status:'unverified',verified_by:'',valid_until:null},invocation_evidence:{reference:'発動記録',status:'unverified',verified_by:'',valid_until:null}};
 ctx.records=[{kind:'agreement',entity_id:'a1',revision:1,payload:stored}];const requests:any[]=[];
 global.fetch=jest.fn(async(_url:any,options:any)=>{if(options?.method==='POST'){requests.push(JSON.parse(options.body));return response({revision:2});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'agreement'}});
 fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'a1'}});
 const save=()=>fireEvent.submit(screen.getByRole('button',{name:'この内容を保存・再送'}).closest('form')!);
 expect(screen.getByLabelText(/協定の月時間外上限/)).toHaveAttribute('max','360000');
 fireEvent.change(screen.getByLabelText(/協定の年時間外上限/),{target:{value:'2592001'}});save();
 expect(await screen.findByText(/720時間（2592000秒）以内/)).toBeInTheDocument();expect(requests).toHaveLength(0);
 fireEvent.change(screen.getByLabelText(/協定の年時間外上限/),{target:{value:'2592000'}});save();
 await waitFor(()=>expect(requests).toHaveLength(1));expect(requests[0].payload.monthly_limit_seconds).toBe(360000);
});

test('employment form offers flexible holidays and one-month variable hours with their evidence',async()=>{
 const ctx:any=fixture();global.fetch=jest.fn(async()=>response(ctx)) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'employment'}});
 expect(screen.queryByLabelText('変形休日制の起算日（就業規則の定め）')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('法定休日の与え方'),{target:{value:'four_week'}});
 expect(screen.getByLabelText('変形休日制の起算日（就業規則の定め）')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('労働時間制度'),{target:{value:'monthly_variable'}});
 expect(screen.getByLabelText('変形期間の起算日')).toBeInTheDocument();
 const length=screen.getByLabelText(/変形期間の日数/);expect(length).toHaveAttribute('max','28');
 fireEvent.change(length,{target:{value:'28'}});expect(length).toHaveValue(28);
 expect(screen.getAllByText(/変形労働時間制の根拠/).length).toBeGreaterThan(0);
 fireEvent.change(screen.getByLabelText('労働時間制度'),{target:{value:'standard'}});
 expect(screen.queryByLabelText('変形期間の起算日')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('労働時間制度'),{target:{value:'annual_variable'}});
 expect(screen.getByLabelText('適用するカレンダー（同じ事業場・週の起算曜日）')).toBeInTheDocument();
 expect(screen.queryByLabelText('変形期間の起算日')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('労働時間制度'),{target:{value:'flex'}});
 expect(screen.getByLabelText('清算期間の起算日')).toBeInTheDocument();
 expect(screen.getByRole('note')).toHaveTextContent('時刻付きの勤務は割り当てません');
 fireEvent.click(screen.getByLabelText(/完全週休2日制の特例/));
 expect(screen.getByText('毎週の所定休日（2日以上）')).toBeInTheDocument();
});

test('flextime employment sends its settlement terms and evidence',async()=>{
 const ctx:any=fixture(),requests:any[]=[];ctx.employers=[{employer_id:'e1',name:'勤務先法人'}];ctx.establishments=[{establishment_id:'s1',employer_id:'e1',start:'2026-01-01T00:00:00Z',end:'2027-01-01T00:00:00Z'}];
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){requests.push(JSON.parse(o.body));return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'employment'}});
 for(const [label,value] of [['対象職員','p1'],['雇用先の事業場','s1'],['適用開始（日本時間）','2026-04-01T00:00:00'],['適用終了（日本時間）','2027-04-01T00:00:00'],['兼業申告の確認の資料名・参照先','契約原本']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.change(screen.getByLabelText('労働時間制度'),{target:{value:'flex'}});
 fireEvent.change(screen.getByLabelText('清算期間の起算日'),{target:{value:'2026-04-01'}});
 fireEvent.change(screen.getByLabelText('清算期間の長さ'),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText('変形労働時間制の根拠（就業規則・労使協定）の資料名・参照先'),{target:{value:'フレックス協定'}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(requests).toHaveLength(1));
 expect(requests[0].payload).toMatchObject({working_time_system:'flex',flex_anchor:'2026-04-01',flex_months:3,annual_calendar_id:null,variable_anchor:null});
 expect(requests[0].payload.variable_evidence.reference).toBe('フレックス協定');
});

const fillSegment=(n:number,values:Record<string,string>)=>{for(const [key,value] of Object.entries(values))fireEvent.change(screen.getByLabelText(`区分期間${n}の${key}`),{target:{value}});};
test('a fixed segment requires evidence and does not infer verified status',async()=>{
 const ctx:any=fixture();ctx.establishments=[{establishment_id:'s1',employer_id:'e1'}];global.fetch=jest.fn(async()=>response(ctx)) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'annual_calendar'}});
 fireEvent.click(screen.getByRole('button',{name:'区分期間を追加'}));
 fillSegment(1,{'開始日':'2026-05-01','終了日（含まない）':'2026-06-01','確定日（任意）':'2026-04-01'});
 expect(screen.getByRole('alert')).toHaveTextContent('確定日と同意の資料');
 fireEvent.click(screen.getByLabelText('区分期間1の同意資料を記録する'));
 fillSegment(1,{'資料名・参照先':'同意書（回収待ち）'});
 expect(screen.getByLabelText('区分期間1の同意状態')).toHaveValue('unverified');
 expect(screen.queryByRole('alert')).toBeNull();
});

test('annual calendar lines are parsed into days and segments; unreadable lines block saving',async()=>{
 const ctx:any=fixture(),requests:any[]=[];ctx.employers=[{employer_id:'e1',name:'病院法人'}];ctx.establishments=[{establishment_id:'s1',employer_id:'e1'}];
 global.fetch=jest.fn(async(u:any,o:any)=>{if(o?.method==='POST'){requests.push({url:String(u),body:JSON.parse(o.body)});return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'annual_calendar'}});
 fireEvent.change(screen.getByLabelText('カレンダーを適用する事業場'),{target:{value:'s1'}});
 for(const [label,value] of [['対象期間の初日','2026-04-01'],['対象期間の終了日（この日を含まない。1か月超1年以内）','2027-04-01'],['最初の期間の終了日（この日を含まない。ここまでを日ごとに確定）','2026-05-01'],['週の起算曜日','2'],['原本確認の資料名・参照先','1年単位変形の労使協定']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 const days=screen.getByLabelText(/確定した労働日と所定時間/);
 fireEvent.change(days,{target:{value:'2026-04-01 8:00\n2026-04-02 9:30\n4月3日 8時間'}});
 expect(screen.getByRole('alert')).toHaveTextContent('3行目：4月3日 8時間');
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 expect(await screen.findByText(/カレンダーの行に読み取れない内容があります/)).toBeInTheDocument();
 fireEvent.change(days,{target:{value:'2026-04-01 8:00\n2026-04-02 9:30'}});
 fireEvent.click(screen.getByRole('button',{name:'区分期間を追加'}));
 fillSegment(1,{'開始日':'2026-05-01','終了日（含まない）':'2026-06-01','労働日数':'20','総労働時間（秒）':'576000','確定日（任意）':'2026-04-01'});
 fireEvent.click(screen.getByLabelText('区分期間1の同意資料を記録する'));
 fillSegment(1,{'同意状態':'verified','確認責任者':'労務 太郎','資料名・参照先':'過半数代表の同意書'});
 fireEvent.click(screen.getByRole('button',{name:'区分期間を追加'}));
 fillSegment(2,{'開始日':'2026-06-01','終了日（含まない）':'2027-04-01','労働日数':'200','総労働時間（秒）':'5760000'});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(requests).toHaveLength(1));
 expect(requests[0].url).toContain('/records/annual_calendar');
 expect(requests[0].body.payload).toMatchObject({employer_id:'e1',establishment_id:'s1',start:'2026-04-01',end:'2027-04-01',first_period_end:'2026-05-01',week_start:2,
  days:[{day:'2026-04-01',seconds:28800},{day:'2026-04-02',seconds:34200}],
  segments:[{start:'2026-05-01',end:'2026-06-01',working_days:20,total_seconds:576000,fixed_on:'2026-04-01',consent:{reference:'過半数代表の同意書',verified_by:'労務 太郎',status:'verified'}},
            {start:'2026-06-01',end:'2027-04-01',working_days:200,total_seconds:5760000,fixed_on:null,consent:null}]});
});

test('rule decision binds the displayed impact; a review needs the source digest fields',async()=>{
 const ctx:any=fixture(),requests:any[]=[],urls:string[]=[];
 ctx.rule_revision='rule-v2';ctx.rule_reviews=[{review_id:'r1',rule_id:'rule-v2',provision:'シフト制留意事項',source_sha256:'a'.repeat(64),document_version:'2026-06-19',reviewed_on:'2026-09-26'},{review_id:'r0',rule_id:'rule-v1',provision:'旧版'}];
 const impact={review_id:'r1',rule_id:'rule-v2',source_sha256:'a'.repeat(64),impact_hash:'c'.repeat(64),impact_count:2,publications:[{publication_id:'pub1',period_key:'2026-01',version:1,rule_revision:'rule-v1'}],grant_assessments:[],grant_records:[{account_id:'g0',granted_on:'2026-01-01'}]};
 global.fetch=jest.fn(async(url:any,options:any)=>{urls.push(String(url));if(options?.method==='POST'){requests.push(JSON.parse(options.body));return response({revision:1});}if(String(url).includes('/rule-impact/'))return response(impact);return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'rule_review'}});
 expect(screen.getByLabelText('取得した資料のSHA-256（16進64桁）')).toBeRequired();expect(screen.getByLabelText('資料の版（改正日など）')).toBeRequired();
 fireEvent.change(screen.getByLabelText('登録する業務'),{target:{value:'rule_decision'}});
 const reviews=screen.getByLabelText('判断する制度確認（資料のハッシュ付き）');
 expect(Array.from((reviews as HTMLSelectElement).options).map(o=>o.value)).toEqual(['','r1']);
 fireEvent.change(reviews,{target:{value:'r1'}});
 fireEvent.click(screen.getByRole('button',{name:'影響を表示する'}));
 await screen.findByText(/公開 1件・付与照合 0件・付与原本 1件（合計 2件）/);
 expect(urls.some(u=>u.includes('/planning/compliance/rule-impact/r1?scope_id=hospital%2Fpharmacy'))).toBe(true);
 fireEvent.change(screen.getByLabelText('判断'),{target:{value:'publish'}});fireEvent.change(screen.getByLabelText('判断日'),{target:{value:'2026-09-27'}});
 fireEvent.change(screen.getByLabelText('原本確認の資料名・参照先'),{target:{value:'人事・法務の確認記録'}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 await waitFor(()=>expect(requests).toHaveLength(1));
 expect(requests[0].payload).toMatchObject({review_id:'r1',rule_id:'rule-v2',source_sha256:'a'.repeat(64),impact_hash:'c'.repeat(64),impact_count:2,decision:'publish',decided_on:'2026-09-27'});
 expect(urls.some(u=>u.includes('/records/rule_decision'))).toBe(true);
});

test('site attribution decision records employer, reading, reason, period and evidence',async()=>{
 const ctx:any=fixture(),requests:any[]=[];ctx.employers=[{employer_id:'e1',name:'病院法人'}];ctx.establishments=[{establishment_id:'s1',employer_id:'e1'},{establishment_id:'s2',employer_id:'e1'}];
 global.fetch=jest.fn(async(u:any,o:any)=>{if(o?.method==='POST'){requests.push({url:String(u),body:JSON.parse(o.body)});return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'site_attribution_decision'}});
 for(const [label,value] of [['判断の対象とする雇用主（複数の事業場を持つ）','e1'],['時間外を帰属させる順序','time_order'],['判断の理由と根拠（人事・法務）','法務確認済み'],['適用開始（日本時間）','2026-04-01T00:00:00'],['適用終了（日本時間）','2027-04-01T00:00:00'],['原本確認の資料名・参照先','法務意見書']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));await waitFor(()=>expect(requests).toHaveLength(1));
 expect(requests[0].url).toContain('/records/site_attribution_decision');
 expect(requests[0].body.payload).toMatchObject({employer_id:'e1',reading:'time_order',reason:'法務確認済み',start:'2026-03-31T15:00:00.000Z',end:'2027-03-31T15:00:00.000Z'});
});

test('two evidence edits within one frame both survive',async()=>{
 // Seen in WebKit (e2e-all-r4): the reference was typed and the status chosen before
 // a re-render; building the status change from the rendered copy lost the reference.
 // jsdom re-renders after every event, so this guards the result; the race itself is
 // checked in browsers (the fix merges each change into the latest state).
 const ctx:any=fixture(),requests:any[]=[];
 global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){requests.push(JSON.parse(o.body));return response({});}return response(ctx);}) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'employment'}});
 act(()=>{
  fireEvent.change(screen.getByLabelText('兼業申告の確認の資料名・参照先'),{target:{value:'人事原本'}});
  fireEvent.change(screen.getByLabelText('兼業申告の確認の状態'),{target:{value:'verified'}});
 });
 expect(screen.getByLabelText('兼業申告の確認の資料名・参照先')).toHaveValue('人事原本');
 expect(screen.getByLabelText('兼業申告の確認の状態')).toHaveValue('verified');
});

test.each(['verified','rejected'])('editing another annual segment preserves %s consent expiry and exact seconds',async(status)=>{
 const ctx:any=fixture(),requests:any[]=[];
 const original={start:'2026-05-01',end:'2026-06-01',working_days:20,total_seconds:576001,fixed_on:'2026-04-01',consent:{reference:'同意  の原本 / 参照先',verified_by:'労務 太郎',status,valid_until:'2026-05-31T12:34:56+09:00'}};
 ctx.employers=[{employer_id:'e1',name:'病院'}];ctx.establishments=[{establishment_id:'s1',employer_id:'e1'}];
 ctx.annual_calendars=[{calendar_id:'calendar-1',employer_id:'e1',establishment_id:'s1',start:'2026-04-01',end:'2027-04-01',first_period_end:'2026-05-01',week_start:0,days:[],special_periods:[],segments:[original,{start:'2026-06-01',end:'2027-04-01',working_days:200,total_seconds:5760000,fixed_on:null,consent:null}],evidence:{reference:'協定',status:'unverified',verified_by:null,valid_until:null}}];
 global.fetch=jest.fn(async(_url,options)=>{if(options?.method==='POST'){requests.push(JSON.parse(String(options.body)));return response({revision:1});}return response(ctx);});
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'annual_calendar'}});
 fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'calendar-1'}});
 expect(screen.getByLabelText('区分期間1の有効期限（時差付き・任意）')).toHaveValue('2026-05-31T12:34:56+09:00');
 expect(screen.getByLabelText('区分期間1の同意状態')).toHaveValue(status);
 fillSegment(2,{'労働日数':'199'});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 await waitFor(()=>expect(requests).toHaveLength(1));
 expect(requests[0].payload.segments[0]).toEqual(original);
 expect(requests[0].payload.segments[1].working_days).toBe(199);
});

test.each(['2026-05-31T12:34:56+09:00',null])('editing a rejected segment preserves delimiters, seconds and expiry %s in POST',async(expiry)=>{
 const status='rejected';
 const ctx:any=fixture(),requests:any[]=[];
 const original={start:'2026-05-01',end:'2026-06-01',working_days:20,total_seconds:576001,fixed_on:'2026-04-01',consent:{reference:'同意  の原本 / 参照先',verified_by:'労務 太郎',status,valid_until:expiry}};
 ctx.employers=[{employer_id:'e1',name:'病院'}];ctx.establishments=[{establishment_id:'s1',employer_id:'e1'}];
 ctx.annual_calendars=[{calendar_id:'calendar-1',employer_id:'e1',establishment_id:'s1',start:'2026-04-01',end:'2027-04-01',first_period_end:'2026-05-01',week_start:0,days:[],special_periods:[],segments:[original,{start:'2026-06-01',end:'2027-04-01',working_days:200,total_seconds:5760000,fixed_on:null,consent:null}],evidence:{reference:'協定',status:'unverified',verified_by:null,valid_until:null}}];
 global.fetch=jest.fn(async(_url,options)=>{if(options?.method==='POST'){requests.push(JSON.parse(String(options.body)));return response({revision:1});}return response(ctx);});
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'annual_calendar'}});
 fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'calendar-1'}});
 expect(screen.getByLabelText('区分期間1の有効期限（時差付き・任意）')).toHaveValue(expiry??'');
 expect(screen.getByLabelText('区分期間1の同意状態')).toHaveValue(status);
 fillSegment(1,{'労働日数':'19','資料名・参照先':'変更  原本 / 別資料 / 有効期限=文字列'});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 await waitFor(()=>expect(requests).toHaveLength(1));
 expect(requests[0].payload.segments[0]).toEqual({...original,working_days:19,consent:{...original.consent,reference:'変更  原本 / 別資料 / 有効期限=文字列'}});
 expect(requests[0].payload.segments[1].working_days).toBe(200);
});

test.each(['bad-date','2026-02-30T12:00:00+09:00','2026-05-31T12:00:00'])('invalid consent expiry %s blocks POST and discard restores source',async(invalid)=>{
 const ctx:any=fixture(),requests:any[]=[];
 const original={start:'2026-05-01',end:'2026-06-01',working_days:20,total_seconds:576001,fixed_on:'2026-04-01',consent:{reference:'同意  の原本 / 参照先',verified_by:'労務 太郎',status:'rejected',valid_until:'2026-05-31T12:34:56+09:00'}};
 ctx.employers=[{employer_id:'e1',name:'病院'}];ctx.establishments=[{establishment_id:'s1',employer_id:'e1'}];
 ctx.annual_calendars=[{calendar_id:'calendar-1',employer_id:'e1',establishment_id:'s1',start:'2026-04-01',end:'2027-04-01',first_period_end:'2026-05-01',week_start:0,days:[],special_periods:[],segments:[original,{start:'2026-06-01',end:'2027-04-01',working_days:200,total_seconds:5760000,fixed_on:null,consent:null}],evidence:{reference:'協定',status:'unverified',verified_by:null,valid_until:null}}];
 global.fetch=jest.fn(async(_url,options)=>{if(options?.method==='POST'){requests.push(JSON.parse(String(options.body)));return response({revision:1});}return response(ctx);});
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'annual_calendar'}});
 fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'calendar-1'}});

 fillSegment(1,{'有効期限（時差付き・任意）':invalid});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 await waitFor(()=>expect((screen.queryAllByRole('alert').find(a=>/区分期間1：有効期限/.test(a.textContent??''))?.textContent)).toMatch(/^区分期間1：有効期限/));
 expect(requests).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'未保存の内容を破棄'}));
 expect(screen.getByLabelText('区分期間1の有効期限（時差付き・任意）')).toHaveValue(original.consent.valid_until);
 expect(screen.getByLabelText('区分期間1の資料名・参照先')).toHaveValue(original.consent.reference);
});

test('annual consent conflict preserves edit until explicit three-way confirmation',async()=>{
 const ctx:any=fixture(),requests:any[]=[];
 const original={start:'2026-05-01',end:'2026-06-01',working_days:20,total_seconds:576001,fixed_on:'2026-04-01',consent:{reference:'同意  の原本 / 参照先',verified_by:'労務 太郎',status:'rejected',valid_until:'2026-05-31T12:34:56+09:00'}};
 ctx.employers=[{employer_id:'e1',name:'病院'}];ctx.establishments=[{establishment_id:'s1',employer_id:'e1'}];
 ctx.annual_calendars=[{calendar_id:'calendar-1',employer_id:'e1',establishment_id:'s1',start:'2026-04-01',end:'2027-04-01',first_period_end:'2026-05-01',week_start:0,days:[],special_periods:[],segments:[original,{start:'2026-06-01',end:'2027-04-01',working_days:200,total_seconds:5760000,fixed_on:null,consent:null}],evidence:{reference:'協定',status:'unverified',verified_by:null,valid_until:null}}];
 global.fetch=jest.fn(async(_url,options)=>{if(options?.method==='POST'){requests.push(JSON.parse(String(options.body)));return response({revision:1});}return response(ctx);});
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('登録する業務'),{target:{value:'annual_calendar'}});
 fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'calendar-1'}});

 global.fetch=jest.fn(async(_url,options)=>{if(options?.method==='POST'){requests.push(JSON.parse(String(options.body)));return response({},409);}return response({...ctx,records:[{kind:'annual_calendar',entity_id:'calendar-1',revision:2,payload:{...ctx.annual_calendars[0],segments:[{...original,consent:{...original.consent,reference:'他者の更新'}}]}}]});});
 fillSegment(1,{'資料名・参照先':'編集中 / 資料'});
 fireEvent.click(screen.getByRole('button',{name:'この内容を保存・再送'}));
 await screen.findByText('競合した内容の確認');
 expect(screen.getByRole('button',{name:'この内容を保存・再送'})).toBeDisabled();
 expect(screen.getByLabelText('区分期間1の資料名・参照先')).toHaveValue('編集中 / 資料');
 expect(screen.getByText('編集開始時').parentElement?.textContent).toContain('同意  の原本 / 参照先');
 expect(screen.getByText(/他者の更新/)).toBeInTheDocument();
 expect(requests).toHaveLength(1);
});
