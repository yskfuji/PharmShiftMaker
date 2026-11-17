import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import ConflictTable from '../ConflictTable';
import UnsavedNavigationBoundary from '../UnsavedNavigationBoundary';
import PlanningWorkspace from '../PlanningWorkspace';
import useUnsavedNavigation,{hasUnsavedChanges} from '../useUnsavedNavigation';

const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body,text:async()=>JSON.stringify(body)} as Response);
beforeEach(()=>{Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('test-random-key')});});
afterEach(()=>jest.restoreAllMocks());

test('conflict table lists every field once, differing fields first, with labels',()=>{
 render(<ConflictTable base={{purpose:'開始時',days:30,evidence:{status:'verified'}}} current={{purpose:'現在',days:30,evidence:{status:'verified'}}} proposed={{purpose:'編集中',days:30,evidence:{status:'verified'}}} labels={{purpose:'利用目的'}}/>);
 const rows=screen.getAllByRole('row').filter(r=>r.getAttribute('data-changed'));
 expect(rows.map(r=>r.getAttribute('data-changed'))).toEqual(['true','false','false']);
 expect(rows[0]).toHaveTextContent('利用目的差分あり開始時現在編集中');
 expect(screen.getByText('差分のある項目（1項目）')).toBeInTheDocument();
 expect(screen.getByText('差分のない項目（2項目）')).toBeInTheDocument();
 expect(screen.getByRole('rowheader',{name:'evidence.status'})).toBeInTheDocument();
});

test('conflict table compares with types, orders indices numerically and marks missing fields',()=>{
 const items=Array.from({length:11},(_,i)=>i);
 render(<ConflictTable base={undefined} current={{count:5,items}} proposed={{count:'5',items,note:null}}/>);
 const changed=screen.getAllByRole('row').filter(r=>r.getAttribute('data-changed')==='true').map(r=>r.querySelector('th')?.textContent);
 expect(changed).toEqual(['count差分あり','items.0差分あり','items.1差分あり','items.2差分あり','items.3差分あり','items.4差分あり','items.5差分あり','items.6差分あり','items.7差分あり','items.8差分あり','items.9差分あり','items.10差分あり','note差分あり']);
 expect(screen.getAllByRole('row').find(r=>r.querySelector('th')?.textContent==='note差分あり')).toHaveTextContent('［項目なし］［項目なし］［空欄］');
});

function Dirty(){useUnsavedNavigation(true);return <p>編集中</p>;}

test('untracked history with unsaved work keeps the page and explains it',async()=>{
 render(<><UnsavedNavigationBoundary/><Dirty/></>);
 await waitFor(()=>expect(hasUnsavedChanges()).toBe(true));
 const router=jest.fn();window.addEventListener('popstate',router);
 act(()=>{window.dispatchEvent(new PopStateEvent('popstate',{state:null}));});
 expect(router).not.toHaveBeenCalled();  // the router does not render the destination
 expect(await screen.findByRole('alert')).toHaveTextContent('この履歴の移動を画面に反映していません');
 expect(screen.getByText('編集中')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'この画面で続ける'}));
 expect(screen.queryByRole('alert')).toBeNull();
 window.removeEventListener('popstate',router);
});

function workspaceFetch(posts:{url:string;body:any}[],latest:{hash:string}={hash:'h1'},scopeRevision=3){
 const input={input_hash:'h1',input_revision:3,publication_version:0,stale:false,snapshot:{period:{start:'2026-01-05T00:00:00+09:00',end:'2026-01-12T00:00:00+09:00'},people:[{person_id:'p0',name:'職員甲'},{person_id:'p1',name:'職員乙'}],contracts:[],candidates:[],leaves:[]}};
 return jest.fn(async(url:any,options:any)=>{const u=String(url);
  if(options?.method==='POST'){posts.push({url:u,body:JSON.parse(options.body)});return response({input_hash:'h2'});}
  if(u.includes('/planning/scopes'))return response([{person_id:'p0',scope_id:'hospital/pharmacy',role:'ADMIN',input_revision:scopeRevision}]);
  if(u.includes('/inputs/latest'))return response(u.includes('input_hash=')?input:{...input,input_hash:latest.hash});
  if(u.includes('/planning/inputs?'))return response([]);
  if(u.includes('/publications')||u.includes('/notifications'))return response([]);
  return response([]);
 }) as any;
}

function file(snapshot:unknown){const f=new File([JSON.stringify(snapshot)],'input.json',{type:'application/json'});Object.defineProperty(f,'text',{value:async()=>JSON.stringify(snapshot)});return f;}

test('input file is previewed, checked against the department and registered only on confirmation',async()=>{
 const posts:{url:string;body:any}[]=[];global.fetch=workspaceFetch(posts);
 render(<PlanningWorkspace/>);
 const picker=await screen.findByLabelText(/登録ファイルを取り込む/);
 await screen.findAllByText('職員乙');  // the current input has been loaded
 const other={facility_id:'hospital',department_id:'other',period:{start:'2026-01-05T00:00:00+09:00',end:'2026-01-12T00:00:00+09:00'},people:[{person_id:'p0'},{person_id:'p9'}],candidates:[{},{}],demands:[{}]};
 fireEvent.change(picker,{target:{files:[file(other)]}});
 const preview=await screen.findByRole('region',{name:'取込ファイルの確認'});
 expect(preview).toHaveTextContent('ファイルの施設・部署：hospital/other／選択中：hospital/pharmacy');
 expect(preview).toHaveTextContent('職員 2人（追加 1人・現在の入力にない／削除 1人）・勤務候補 2件・必要配置 1件');
 expect(preview).toHaveTextContent('現在の入力から外れる職員：職員乙');
 expect(screen.getByRole('alert')).toHaveTextContent('選択中の部署と異なるため、登録できません');
 expect(screen.getByRole('button',{name:'この内容で登録する'})).toBeDisabled();
 expect(hasUnsavedChanges()).toBe(true);  // a previewed file is unsaved work
 expect(posts).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'取込を取り消す'}));
 await waitFor(()=>expect(hasUnsavedChanges()).toBe(false));
 fireEvent.change(picker,{target:{files:[file({...other,department_id:'pharmacy'})]}});
 fireEvent.click(await screen.findByRole('button',{name:'この内容で登録する'}));
 await waitFor(()=>expect(posts).toHaveLength(1));
 expect(posts[0].url).toContain('/planning/inputs?scope_id=hospital%2Fpharmacy');
 expect(posts[0].body.expected_revision).toBe(3);
 expect(posts[0].body.snapshot.department_id).toBe('pharmacy');
});

test('a typed cancellation reason is unsaved work of the planning screen',async()=>{
 global.fetch=workspaceFetch([]);
 render(<PlanningWorkspace/>);
 await screen.findAllByText('職員乙');
 expect(hasUnsavedChanges()).toBe(false);
 fireEvent.change(screen.getByLabelText('公開取消の理由・勤務変更の調整記録'),{target:{value:'人員不足のため'}});
 await waitFor(()=>expect(hasUnsavedChanges()).toBe(true));
});

test('grant assessment uses the shared unsaved-change guard',async()=>{
 const GrantAssessment=(await import('../GrantAssessment')).default;
 const context={input_hash:'h',source_revision:3,findings:[],accounts:[{account_id:'g',person_id:'p',employer_id:'e',granted_on:'2026-04-01',statutory_days:3}]};
 global.fetch=jest.fn(async()=>response(context)) as any;
 render(<GrantAssessment scope="hospital/pharmacy"/>);
 fireEvent.click(screen.getByText('最新の付与原本を読み込む'));
 fireEvent.change(await screen.findByLabelText('確認済み勤続月数'),{target:{value:'6'}});
 await waitFor(()=>expect(hasUnsavedChanges()).toBe(true));
 const followed=jest.spyOn(window,'confirm').mockReturnValue(false);
 const link=document.createElement('a');link.href='/schedule';document.body.appendChild(link);
 fireEvent.click(link);
 expect(followed).toHaveBeenCalled();  // links ask before discarding, like the other forms
 link.remove();
});

test('registration is refused when the compared input is no longer the latest',async()=>{
 const posts:{url:string;body:any}[]=[],latest={hash:'h1'};global.fetch=workspaceFetch(posts,latest);
 render(<PlanningWorkspace/>);
 const picker=await screen.findByLabelText(/登録ファイルを取り込む/);
 await screen.findAllByText('職員乙');
 fireEvent.change(picker,{target:{files:[file({facility_id:'hospital',department_id:'pharmacy',people:[{person_id:'p0'}]})]}});
 await screen.findByRole('region',{name:'取込ファイルの確認'});
 latest.hash='h9';  // another administrator registered a newer input meanwhile
 fireEvent.click(screen.getByRole('button',{name:'この内容で登録する'}));
 expect(await screen.findByText(/比較した入力が部署の最新版ではない/)).toBeInTheDocument();
 expect(posts).toHaveLength(0);
 expect(screen.queryByRole('region',{name:'取込ファイルの確認'})).toBeNull();
});

test('the untracked-history banner closes on the next tracked traversal',async()=>{
 render(<><UnsavedNavigationBoundary/><Dirty/></>);
 await waitFor(()=>expect(hasUnsavedChanges()).toBe(true));
 act(()=>{window.dispatchEvent(new PopStateEvent('popstate',{state:null}));});
 expect(await screen.findByRole('alert')).toBeInTheDocument();
 act(()=>{window.dispatchEvent(new PopStateEvent('popstate',{state:window.history.state}));});
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});

test('registration sends the department revision even when requests made the displayed input stale',async()=>{
 const posts:{url:string;body:any}[]=[];global.fetch=workspaceFetch(posts,{hash:'h1'},7);  // input revision 3, department 7
 render(<PlanningWorkspace/>);
 const picker=await screen.findByLabelText(/登録ファイルを取り込む/);
 await screen.findAllByText('職員乙');
 fireEvent.change(picker,{target:{files:[file({facility_id:'hospital',department_id:'pharmacy',people:[{person_id:'p0'}]})]}});
 fireEvent.click(await screen.findByRole('button',{name:'この内容で登録する'}));
 await waitFor(()=>expect(posts).toHaveLength(1));
 expect(posts[0].body.expected_revision).toBe(7);
});

test('candidate derivation creates a new input through the server with evidence and an idempotency key',async()=>{
 const posts:{url:string;body:any}[]=[];global.fetch=workspaceFetch(posts);
 render(<PlanningWorkspace/>);
 await screen.findByRole('heading',{name:'契約・資格から勤務候補を再導出'});
 const derive=screen.getByRole('button',{name:'新しい入力版を作る'});
 expect(derive).toBeDisabled();
 fireEvent.change(screen.getByLabelText('再導出する理由（必須）'),{target:{value:'資格改訂を反映'}});
 fireEvent.change(screen.getByLabelText('根拠の参照（必須）'),{target:{value:'承認記録 C-17'}});
 fireEvent.click(derive);
 await waitFor(()=>expect(posts.some(row=>row.url.includes('/planning/candidates/derive?'))).toBe(true));
 const request=posts.find(row=>row.url.includes('/planning/candidates/derive?'))!;
 expect(request.body).toEqual({expected_version:3,evidence:{reason:'資格改訂を反映',reference:'承認記録 C-17'},idempotency_key:'test-random-key'});
 expect(await screen.findByText(/新しい不変の計画入力版/)).toBeInTheDocument();
});

test('the file picker waits until the department\'s latest input has been read',async()=>{
 // A file chosen before that read would be compared with nothing and then dropped
 // when the input arrives (seen in Firefox, e2e-all-r3). jsdom runs effects at once,
 // so this guards the condition; the one-frame race itself is checked in browsers.
 const posts:{url:string;body:any}[]=[];const base=workspaceFetch(posts);let release:()=>void=()=>{};
 const gate=new Promise<void>(r=>{release=r;});
 global.fetch=jest.fn(async(url:any,options:any)=>{if(String(url).includes('/inputs/latest'))await gate;return base(url,options);}) as any;
 render(<PlanningWorkspace/>);
 const picker=await screen.findByLabelText(/登録ファイルを取り込む/);
 expect(picker).toBeDisabled();
 await act(async()=>{release();});
 await waitFor(()=>expect(picker).toBeEnabled());
});
