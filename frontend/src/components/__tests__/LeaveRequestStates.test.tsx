import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import LeaveRequestWorkspace from '@/features/workspace/requests/LeaveRequestWorkspace';

const row={request_id:'r1',person_id:'self',version:1,kind:'PUBLIC_HOLIDAY_REQUEST',status:'PENDING',payload:{start:'2026-01-05T09:00:00+09:00',end:'2026-01-05T17:00:00+09:00'}};
const reply=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body,text:async()=>JSON.stringify(body)});
let key: number;
beforeEach(()=>{key=0;Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn(()=> `request-key-${++key}`)});});

test.each(['network','decode'])('an unknown %s outcome preserves its request identity and entered date',async(mode)=>{
 const bodies:string[]=[];
 global.fetch=jest.fn(async(url,options)=>{
  if(options?.method==='POST'){bodies.push(String(options.body));if(bodies.length===1){if(mode==='network')throw new TypeError('Failed to fetch');return {...reply(row),json:async()=>{throw new SyntaxError('truncated JSON')}};}return reply(row);}
  return reply(String(url).includes('/requests?')?[row]:[]);
 }) as jest.Mock;
 render(<LeaveRequestWorkspace scope="test/pharmacy" personId="self" canReview={false} onChanged={()=>{}}/>);
 await screen.findByText(/あなた：.*確認待ち/);
 jest.mocked(global.crypto.randomUUID).mockClear(); // Exclude the navigation document identity.
 fireEvent.change(screen.getByLabelText('日付'),{target:{value:'2026-01-06'}});
 fireEvent.click(screen.getByRole('button',{name:'申請を記録'}));
 await screen.findByText(/操作が反映されたかは不明/);
 expect(screen.getByRole('button',{name:'申請履歴を再取得'})).toBeEnabled();
 expect(screen.getByLabelText('日付')).toHaveValue('2026-01-06');
 fireEvent.click(screen.getByRole('button',{name:'申請を記録'}));
 await waitFor(()=>expect(bodies).toHaveLength(2));
 expect(bodies[1]).toBe(bodies[0]);
 expect(global.crypto.randomUUID).toHaveBeenCalledTimes(1);
});

test('a restricted request read is not presented as a connection failure or an empty history',async()=>{
 global.fetch=jest.fn(async(url)=>String(url).includes('/requests?')?reply({detail:'restricted'},423):reply([])) as jest.Mock;
 render(<LeaveRequestWorkspace scope="test/pharmacy" personId="self" canReview={false} onChanged={()=>{}}/>);
 await screen.findByText(/利用制限中のため表示できません/);
 expect(screen.queryByText(/確認待ち/)).not.toBeInTheDocument();
 expect(screen.getByLabelText('日付')).toHaveValue('');
 expect(screen.getByRole('button',{name:'申請を記録'})).toBeDisabled();
 expect(screen.queryByText('申請履歴はありません。')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'申請履歴を再取得'})).toBeEnabled();
});


test('a confirmed write remains confirmed when the following display refresh fails',async()=>{
 global.fetch=jest.fn(async(url,options)=>reply(options?.method==='POST'?row:String(url).includes('/requests?')?[row]:[])) as jest.Mock;
 render(<LeaveRequestWorkspace scope="test/pharmacy" personId="self" canReview={false} onChanged={async()=>{throw new TypeError('Failed to fetch');}}/>);
 await screen.findByText(/あなた：.*確認待ち/);
 jest.mocked(global.crypto.randomUUID).mockClear(); // Exclude the navigation document identity.
 fireEvent.change(screen.getByLabelText('日付'),{target:{value:'2026-01-06'}});
 fireEvent.click(screen.getByRole('button',{name:'申請を記録'}));
 await screen.findByText(/操作は記録されましたが、画面を更新できませんでした/);
 expect(screen.queryByText(/反映されたかは不明/)).not.toBeInTheDocument();
});


test('an empty confirmed history is distinguished from a failed read',async()=>{
 global.fetch=jest.fn(async()=>reply([])) as jest.Mock;
 render(<LeaveRequestWorkspace scope="test/pharmacy" personId="self" canReview={false} onChanged={()=>{}}/>);
 await screen.findByText('申請履歴はありません。');
 expect(screen.getByRole('button',{name:'申請を記録'})).toBeEnabled();
});


test('a confirmed write remains confirmed when the following history GET fails',async()=>{
 let written=false;
 global.fetch=jest.fn(async(url,options)=>{
  if(options?.method==='POST'){written=true;return reply(row);}
  return String(url).includes('/requests?') ? written ? reply({detail:'unavailable'},503) : reply([row]) : reply([]);
 }) as jest.Mock;
 render(<LeaveRequestWorkspace scope="test/pharmacy" personId="self" canReview={false} onChanged={()=>{}}/>);
 await screen.findByText(/あなた：.*確認待ち/);
 fireEvent.change(screen.getByLabelText('日付'),{target:{value:'2026-01-06'}});
 fireEvent.click(screen.getByRole('button',{name:'申請を記録'}));
 await screen.findByText(/操作は記録されましたが、画面を更新できませんでした/);
 expect(screen.queryByText(/反映されたかは不明/)).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'申請を記録'})).toBeDisabled();
 expect(screen.queryByText(/あなた：.*確認待ち/)).not.toBeInTheDocument();
});

test('a late old history cannot clear a newer restriction or expose stale rows',async()=>{
 const pending: Array<(value: ReturnType<typeof reply>)=>void>=[];
 let reads=0;
 global.fetch=jest.fn(async(url)=>{
  if(!String(url).includes('/requests?'))return reply([]);
  if(++reads===1)return reply([row]);
  return new Promise<ReturnType<typeof reply>>(resolve=>pending.push(resolve));
 }) as jest.Mock;
 render(<LeaveRequestWorkspace scope="test/pharmacy" personId="self" canReview={false} onChanged={()=>{}}/>);
 await screen.findByText(/あなた：.*確認待ち/);
 act(()=>{window.dispatchEvent(new Event('planning-records-changed'));});
 act(()=>{window.dispatchEvent(new Event('planning-records-changed'));});
 expect(pending).toHaveLength(2);
 await act(async()=>{pending[1](reply({detail:'restricted'},423));});
 await screen.findByText(/利用制限中のため表示できません/);
 await act(async()=>{pending[0](reply([row]));});
 expect(screen.getByText(/利用制限中のため表示できません/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'申請を記録'})).toBeDisabled();
 expect(screen.queryByText(/あなた：.*確認待ち/)).not.toBeInTheDocument();
});


test.each([200, 409])('a late POST (%s) cannot replace the new scope or start an old reload', async(status) => {
 let finish!: (value: ReturnType<typeof reply>) => void;
 const changed = jest.fn();
 global.fetch = jest.fn(async(url, options) => {
  if (options?.method === 'POST') return new Promise<ReturnType<typeof reply>>(resolve => { finish = resolve; });
  if (String(url).includes('new%2Fpharmacy')) return reply([]);
  return reply(String(url).includes('/requests?') ? [row] : []);
 }) as jest.Mock;
 const {rerender} = render(<LeaveRequestWorkspace scope="old/pharmacy" personId="self" canReview={false} onChanged={changed}/>);
 await screen.findByText(/あなた：.*確認待ち/);
 fireEvent.change(screen.getByLabelText('日付'), {target:{value:'2026-01-06'}});
 fireEvent.click(screen.getByRole('button', {name:'申請を記録'}));
 rerender(<LeaveRequestWorkspace scope="new/pharmacy" personId="self" canReview={false} onChanged={changed}/>);
 await screen.findByText('申請履歴はありません。');
 const callsBefore = jest.mocked(fetch).mock.calls.length;
 await act(async() => { finish(reply(row, status)); });
 expect(jest.mocked(fetch).mock.calls).toHaveLength(callsBefore);
 expect(changed).not.toHaveBeenCalled();
 expect(screen.queryByText(/あなた：.*確認待ち/)).not.toBeInTheDocument();
 expect(screen.queryByText('申請の競合を確認')).not.toBeInTheDocument();
 expect(screen.getByLabelText('日付')).toHaveValue('');
 expect(screen.getByRole('button', {name:'申請を記録'})).toBeEnabled();
});

test('a conflict detail arriving after a person change cannot expose the old history', async() => {
 let finish!: (value: ReturnType<typeof reply>) => void;
 let conflictRead = false;
 global.fetch = jest.fn(async(url, options) => {
  if (options?.method === 'POST') { conflictRead = true; return reply({}, 409); }
  if (String(url).includes('/requests?') && conflictRead) {
   conflictRead = false;
   return new Promise<ReturnType<typeof reply>>(resolve => { finish = resolve; });
  }
  return reply([]);
 }) as jest.Mock;
 const props = {scope:'test/pharmacy', canReview:false, onChanged:jest.fn()};
 const {rerender} = render(<LeaveRequestWorkspace {...props} personId="self"/>);
 await screen.findByText('申請履歴はありません。');
 fireEvent.change(screen.getByLabelText('日付'), {target:{value:'2026-01-06'}});
 fireEvent.click(screen.getByRole('button', {name:'申請を記録'}));
 await waitFor(() => expect(finish).toBeDefined());
 rerender(<LeaveRequestWorkspace {...props} personId="new-self"/>);
 await screen.findByText('申請履歴はありません。');
 await act(async() => { finish(reply([row])); });
 expect(screen.queryByText('申請の競合を確認')).not.toBeInTheDocument();
 expect(props.onChanged).not.toHaveBeenCalled();
 expect(screen.getByRole('button', {name:'申請を記録'})).toBeEnabled();
});
