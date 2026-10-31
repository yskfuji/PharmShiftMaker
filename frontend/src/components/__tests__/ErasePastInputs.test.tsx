import {fireEvent, render, screen} from '@testing-library/react';
import ErasePastInputs from '@/features/workspace/governance/ErasePastInputs';

const reply=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body});
const candidate={input_hash:'old-input',input_revision:1,period:{start:'2025-01-01',end:'2025-02-01'},erasable:true,blockers:[],target_count:1};
const plan={plan_id:'plan-1',fingerprint:'fingerprint-1',input_hash:'old-input',erasable:true,targets:[{table:'planning_inputs',key:'old-input',hash:'hash'}],blockers:[],limitations:['バックアップは別照合']};
let mode:string, calls:{url:string;body:string}[];
beforeEach(()=>{
  mode='normal';calls=[];let key=0;
  Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:()=>`key-${++key}`});
  global.fetch=jest.fn(async(url,options)=>{
    if(!options?.body)return reply({observed_at:'2026-10-30T00:00:00Z',inputs:[candidate]});
    calls.push({url:String(url),body:String(options.body)});
    if(String(url).includes('preview'))return reply({...plan,erasable:mode!=='blocked',blockers:mode==='blocked'?['保全あり']:[]});
    if(mode==='lost'&&calls.filter(c=>c.url.includes('execute')).length===1)throw new TypeError('lost');
    if(mode==='conflict')return reply({},409);
    return reply({plan_id:'plan-1',status:'EXECUTED',deleted:1,duplicate:mode==='lost'});
  }) as jest.Mock;
});
async function prepare(){
  render(<ErasePastInputs scope="hospital/pharmacy"/>);
  fireEvent.click(screen.getByText('過去勤務入力の一覧を取得'));
  await screen.findByLabelText('確認する勤務入力');
  fireEvent.change(screen.getByLabelText('確認する勤務入力'),{target:{value:'old-input'}});
  fireEvent.click(screen.getByText('消去計画を作成・同一再送'));
  await screen.findByText('消去計画の確認');
}
const confirm=()=>fireEvent.click(screen.getByLabelText('消去する記録と残る記録を確認し、取り消せない消去に同意した'));
test('preview is not execution; explicit consent binds the server plan',async()=>{
  await prepare();expect(calls).toHaveLength(1);
  expect(screen.getByText('この旧勤務入力を消去・同一再送')).toBeDisabled();
  confirm();fireEvent.click(screen.getByText('この旧勤務入力を消去・同一再送'));
  await screen.findByText(/消去を実行しました/);
  expect(JSON.parse(calls[1].body)).toMatchObject({expected_revision:0,payload:{plan_id:'plan-1',fingerprint:'fingerprint-1'}});
});
test('lost response retains identity and cannot be discarded as a failed write',async()=>{
  mode='lost';await prepare();confirm();fireEvent.click(screen.getByText('この旧勤務入力を消去・同一再送'));
  await screen.findByText(/応答不明です/);
  expect(screen.getByText('実行せず選択へ戻る')).toBeDisabled();
  expect(screen.getByText('過去勤務入力の一覧を取得')).toBeDisabled();
  fireEvent.click(screen.getByText('この旧勤務入力を消去・同一再送'));
  await screen.findByText(/同じ計画は既に実行済み/);
  expect(calls[2]).toEqual(calls[1]);
});
test('server refusal blocks execution even when earlier candidate was erasable',async()=>{
  mode='blocked';await prepare();
  expect(screen.getByText('消去できません：保全あり')).toBeVisible();
  expect(screen.queryByText('この旧勤務入力を消去・同一再送')).not.toBeInTheDocument();
});
test('conflict invalidates the plan instead of retrying destructive execution',async()=>{
  mode='conflict';await prepare();confirm();fireEvent.click(screen.getByText('この旧勤務入力を消去・同一再送'));
  await screen.findByText(/対象・保存規則・保全が変わりました/);
  expect(screen.queryByText('この旧勤務入力を消去・同一再送')).not.toBeInTheDocument();
  expect(screen.getByText('過去勤務入力の一覧を取得')).toBeEnabled();
});
