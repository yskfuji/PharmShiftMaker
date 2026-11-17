import {render,screen,fireEvent,within} from '@testing-library/react';
import ContractWorkflow from '../ContractWorkflow';

const person={person_id:'p1',name:'職員一'};
function fixture(role='ADMIN'){return {role,people:[person],contracts:[],employments:[],establishments:[{establishment_id:'site1',employer_id:'e1',start:'2026-01-01T00:00:00Z',end:'2027-01-01T00:00:00Z'}],employers:[{employer_id:'e1',name:'合成法人'}],capabilities:[],duty_options:[{kind:'DAY',task:'調剤',location:'薬剤部'}],records:[] as any[]};}
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body,text:async()=>JSON.stringify(body)} as Response);
beforeEach(()=>{Object.defineProperty(global,'structuredClone',{configurable:true,value:(value:unknown)=>JSON.parse(JSON.stringify(value))});Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('test-random-key')});});
afterEach(()=>jest.restoreAllMocks());

test('the task list opens the right form and pre-selects the chosen person', async () => {
 global.fetch=jest.fn(async()=>response(fixture())) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 const list=await screen.findByRole('region',{name:'新しい職員を追加する手順'});
 fireEvent.click(within(list).getByRole('button',{name:'氏名の登録を始める'}));
 expect(screen.getByLabelText('登録する業務')).toHaveValue('person');
 expect(screen.getByLabelText('編集する対象')).toHaveValue('new');
 expect(screen.getByLabelText('職員の氏名')).toHaveValue('');
 fireEvent.change(within(list).getByLabelText('手順を確認する職員'),{target:{value:'p1'}});
 expect(within(list).queryByRole('button',{name:'契約の登録を始める'})).toBeNull();
 fireEvent.click(within(list).getByRole('button',{name:'雇用関係の登録を始める'}));
 expect(screen.getByLabelText('登録する業務')).toHaveValue('employment');
 expect(screen.getByLabelText('対象職員')).toHaveValue('p1');
});

test('the reflect step links to the planning section of the same scope', async () => {
 global.fetch=jest.fn(async()=>response(fixture())) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 const list=await screen.findByRole('region',{name:'新しい職員を追加する手順'});
 expect(within(list).getByRole('link',{name:'勤務表・計画を開く'})).toHaveAttribute('href','/planning?scope=hospital%2Fpharmacy#contract-heading');
 expect(within(list).getByText(/新しい職員の勤務候補は作られません/)).toBeInTheDocument();
});

test('contract kinds are grouped in the order new staff records depend on each other', async () => {
 global.fetch=jest.fn(async()=>response(fixture())) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 const select=await screen.findByLabelText('登録する業務');
 const values=Array.from(select.querySelectorAll('option')).map(o=>o.getAttribute('value'));
 expect(values.slice(0,6)).toEqual(['employer','establishment','management_model','person','employment','contract']);
 expect(values).toHaveLength(14);
 expect(Array.from(select.querySelectorAll('optgroup')).map(g=>g.getAttribute('label'))).toEqual(['雇用主と事業場（施設で一度だけ）','職員の登録（上から順に）','規則・協定・判断']);
});

test('only administrators see the task list', async () => {
 global.fetch=jest.fn(async()=>response(fixture('LEADER'))) as any;
 const {container}=render(<ContractWorkflow scope="hospital/pharmacy" onChanged={()=>{}}/>);
 await new Promise(r=>setTimeout(r,0));await new Promise(r=>setTimeout(r,0));
 expect(screen.queryByRole('region',{name:'新しい職員を追加する手順'})).toBeNull();
 expect(container).toBeEmptyDOMElement();
});

test('leave kinds keep their own list without groups', async () => {
 global.fetch=jest.fn(async()=>response({...fixture(),leave_accounts:[],leave_policies:[],leave_records:[],leave_obligations:[],ledger_recordings:[]})) as any;
 render(<ContractWorkflow scope="hospital/pharmacy" group="leave" onChanged={()=>{}}/>);
 const select=await screen.findByLabelText('登録する業務');
 expect(select.querySelectorAll('optgroup')).toHaveLength(0);
 expect(screen.queryByRole('region',{name:'新しい職員を追加する手順'})).toBeNull();
});
