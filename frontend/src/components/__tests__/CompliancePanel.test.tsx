import {render,screen,fireEvent} from '@testing-library/react';
import CompliancePanel from '../CompliancePanel';

jest.mock('../LedgerHistory',()=>({__esModule:true,default:()=>null}));
jest.mock('../LeaveCorrections',()=>({__esModule:true,default:()=>null}));
jest.mock('../GrantAssessment',()=>({__esModule:true,default:()=>null}));
jest.mock('../GovernanceForms',()=>({__esModule:true,default:()=>null}));
jest.mock('../CopyManagement',()=>({__esModule:true,default:()=>null}));
jest.mock('../OutsideDeclarationForm',()=>({__esModule:true,default:()=>null}));
const result=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body,text:async()=>JSON.stringify(body)} as Response);
beforeEach(()=>{Object.defineProperty(global,'structuredClone',{configurable:true,value:(value:unknown)=>JSON.parse(JSON.stringify(value))});Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('test-random-key')});});
afterEach(()=>jest.restoreAllMocks());

test('contract parent stays editable with invalid staging and never requires leave or privacy calculation',async()=>{
 const urls:string[]=[];
 global.fetch=jest.fn(async(url:string)=>{urls.push(url);if(url.includes('/workflow-context'))return result({role:'ADMIN',staging_valid:false,validation_issues:[{message:'effective establishment mismatch',location:['agreements']}],people:[{person_id:'p1',name:'修正する職員'}],contracts:[],employments:[],establishments:[],capabilities:[],duty_options:[],records:[]});if(url.includes('/records'))return result([]);if(url.includes('/schemas'))return result({});return result({detail:'Unrelated calculation unavailable'},422);}) as any;
 render(<CompliancePanel scope="hospital/pharmacy" personId="p1" role="ADMIN" section="contracts" onChanged={()=>{}}/>);
 await screen.findByRole('alert',{name:'編集中の契約・制度の不整合'});fireEvent.change(screen.getByLabelText('編集する対象'),{target:{value:'p1'}});expect(screen.getByLabelText('職員の氏名')).toHaveValue('修正する職員');
 expect(urls.some(u=>u.includes('/leave-report'))).toBe(false);expect(urls.some(u=>u.includes('/privacy'))).toBe(false);expect(screen.queryByRole('button',{name:'記録の読み込みを再試行'})).not.toBeInTheDocument();
});

test('leave calculation failure remains a visible unknown while raw correction records are accessible',async()=>{
 global.fetch=jest.fn(async(url:string)=>{if(url.includes('/records'))return result([]);if(url.includes('/workflow-context'))return result({role:'ADMIN',people:[],contracts:[],employments:[],establishments:[],capabilities:[],records:[]});if(url.includes('/leave-report'))return result({detail:'Invalid staged references'},422);return result({detail:'unexpected'},500);}) as any;
 render(<CompliancePanel scope="hospital/pharmacy" personId="p1" role="ADMIN" section="leave" onChanged={()=>{}}/>);
 await screen.findByRole('alert',{name:'年休台帳の取得結果'});expect(screen.getByText('年休残高と取得義務は未確認です。')).toBeInTheDocument();expect(await screen.findByLabelText('登録する業務')).toBeInTheDocument();expect(screen.getByRole('heading',{name:'請求・残高・取得の管理'}).closest('section')).toHaveClass('workflow-stable-interactions');expect(screen.queryByLabelText('年休残高')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'記録の読み込みを再試行'})).not.toBeInTheDocument();
});

test('failure of permission-bearing records still blocks the parent instead of presenting empty success',async()=>{
 global.fetch=jest.fn(async(url:string)=>url.includes('/schemas')?result({}):result({detail:'Access denied'},403)) as any;
 render(<CompliancePanel scope="hospital/pharmacy" personId="p1" role="ADMIN" section="contracts" onChanged={()=>{}}/>);
 await screen.findByRole('button',{name:'記録の読み込みを再試行'});expect(screen.queryByRole('region',{name:'職員と契約の専用操作'})).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('操作権限がありません');
});

test('leave balances and obligation identify the person, employer and period instead of internal IDs',async()=>{
 global.fetch=jest.fn(async(url:string)=>url.includes('/records')?result([]):result({balances:[{account_id:'private-account-uuid',person_name:'山田 花子',employer_name:'病院法人',granted_on:'2026-04-01',available_days:{numerator:9,denominator:2},expired:false}],obligations:[{obligation_id:'private-obligation-uuid',person_name:'山田 花子',employer_name:'病院法人',start:'2026-04-01',end:'2027-04-01',taken_half_days:3,required_half_days:10,status:'forecast'}],findings:[]})) as any;
 render(<CompliancePanel scope="hospital/pharmacy" personId="p1" role="STAFF" section="leave" onChanged={()=>{}}/>);
 expect(await screen.findByText('山田 花子 ／ 病院法人 ／ 付与日 2026-04-01')).toBeVisible();
 expect(screen.getByText('利用可能 9/2 日')).toBeVisible();
 expect(screen.getByLabelText('年休残高').closest('#leave-ledger')).not.toBeNull();
 expect(screen.getByLabelText('年5日の取得管理').closest('#leave-ledger')).not.toBeNull();
 expect(screen.getByText('山田 花子 ／ 病院法人 ／ 管理期間 2026-04-01 ～ 2027-04-01（終了日を含まない）')).toBeVisible();
 expect(screen.getByText('付与ロット：private-account-uuid').closest('details')).not.toHaveAttribute('open');
});

test('privacy explains judgment and residual copies without implying schedule publication',async()=>{
 global.fetch=jest.fn(async(url:string)=>url.includes('/records')?result([]):result({cases:[]})) as any;
 render(<CompliancePanel scope="hospital/pharmacy" personId="p1" role="STAFF" section="privacy" onChanged={()=>{}}/>);
 expect(await screen.findByText(/消去を実行しても、保全・バックアップ・外部コピーが残る/)).toBeVisible();
 expect(screen.queryByText(/勤務案へ反映/)).not.toBeInTheDocument();
});
