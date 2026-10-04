import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import IdentityProvider, {IdentityDisplay, IdentityBoundary, IdentitySkipLink} from '../IdentityProvider';
import {browserNavigation} from '@/lib/browserNavigation';
let path='/planning';
jest.mock('next/navigation',()=>({usePathname:()=>path}));
const identity={user_id:'u-1',display_name:'山田 太郎',global_role:'ADMIN',identifier_kind:'login_id'};
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body} as Response);
const view=()=> <IdentityProvider><IdentitySkipLink/><IdentityDisplay/><IdentityDisplay/><IdentityBoundary><main id="main" tabIndex={-1}><input aria-label="業務入力" defaultValue="未保存"/></main></IdentityBoundary></IdentityProvider>;
beforeEach(()=>{path='/planning';jest.spyOn(browserNavigation,'reload').mockImplementation(()=>{});document.cookie='pharmshift_user=%ZZ';document.cookie='pharmshift_role=DEVELOPER';});
afterEach(()=>jest.restoreAllMocks());

test('two identity slots use the same verified source, independent of malformed display cookies',async()=>{
 global.fetch=jest.fn(async()=>response(identity));render(view());
 expect(await screen.findAllByText('山田 太郎')).toHaveLength(2);
 expect(screen.getAllByText('ログインID：u-1')).toHaveLength(2);
 expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/auth/me'),expect.objectContaining({cache:'no-store',credentials:'include'}));
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(screen.queryByText('DEVELOPER')).not.toBeInTheDocument();
});

test('OIDC ID is an account ID; absent display name is explicit',async()=>{
 global.fetch=jest.fn(async()=>response({...identity,display_name:null,identifier_kind:'account_id'}));render(view());
 expect(await screen.findAllByText('表示名未登録')).toHaveLength(2);
 expect(screen.getAllByText('アカウントID：u-1')).toHaveLength(2);
 expect(screen.queryByText(/ログインID/)).not.toBeInTheDocument();
});

test.each([403,503])('a background recheck failure preserves the already verified principal (%s)',async(status)=>{
 global.fetch=jest.fn().mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({},status));
 render(view());await screen.findAllByText('山田 太郎');
 act(()=>window.dispatchEvent(new Event('session-renewed')));
 await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.getAllByText('山田 太郎')).toHaveLength(2);
 expect(screen.getByRole('textbox')).toHaveValue('未保存');
});

test('a pathname recheck keeps verified content interactive while its response is pending',async()=>{
 let finish!:(v:Response)=>void;
 global.fetch=jest.fn().mockResolvedValueOnce(response(identity)).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const r=render(view());await screen.findAllByText('山田 太郎');
 path='/settings';r.rerender(view());
 await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
 expect(screen.getByRole('textbox')).toHaveValue('未保存');
 expect(screen.getByRole('link',{name:'本文へ移動'})).toBeInTheDocument();
 await act(async()=>finish(response(identity)));
 expect(browserNavigation.reload).not.toHaveBeenCalled();
});

test('initial checking exposes neither the inert business content nor its skip link',async()=>{
 let finish!:(v:Response)=>void;
 global.fetch=jest.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));
 render(view());
 expect(screen.queryByRole('link',{name:'本文へ移動'})).not.toBeInTheDocument();
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 await act(async()=>finish(response(identity)));
 expect(screen.getByRole('link',{name:'本文へ移動'})).toBeInTheDocument();
 expect(screen.getByRole('textbox')).toHaveValue('未保存');
});

test('an initial failure stays fail closed and retry does not expose content early',async()=>{
 let finish!:(v:Response)=>void;
 global.fetch=jest.fn().mockResolvedValueOnce(response({},503)).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 render(view());await screen.findByRole('alert');
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'本人情報を再確認'}));
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 await act(async()=>finish(response(identity)));
 expect(screen.getByRole('textbox')).toHaveValue('未保存');
});

test('same-name different account forces business state reset before reload',async()=>{
 global.fetch=jest.fn().mockResolvedValueOnce(response(identity)).mockResolvedValueOnce(response({...identity,user_id:'u-2'}));render(view());
 await screen.findAllByText('山田 太郎');act(()=>window.dispatchEvent(new Event('session-renewed')));
 await waitFor(()=>expect(browserNavigation.reload).toHaveBeenCalledTimes(1));
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();expect(screen.queryByText('ログインID：u-2')).not.toBeInTheDocument();
});

test('401 ends business display and announces invalidation, with no renewal request',async()=>{
 global.fetch=jest.fn(async()=>response({},401));const invalid=jest.fn();window.addEventListener('session-invalidated',invalid);
 render(view());await waitFor(()=>expect(invalid).toHaveBeenCalledTimes(1));
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
 expect(fetch).toHaveBeenCalledTimes(1);window.removeEventListener('session-invalidated',invalid);
});

test('body interruption cannot fall back to a display cookie',async()=>{
 global.fetch=jest.fn(async()=>({...response({}),json:async()=>{throw new DOMException('interrupted','AbortError');}}));
 render(view());await screen.findByRole('alert');expect(screen.queryByText('%ZZ')).not.toBeInTheDocument();
});

test('sign-out invalidates an in-flight response',async()=>{
 let finish!:(v:Response)=>void;global.fetch=jest.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));render(view());
 act(()=>window.dispatchEvent(new Event('session-ending')));
 await act(async()=>finish(response(identity)));
 expect(screen.queryByText('山田 太郎')).not.toBeInTheDocument();expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('a pathname change cannot revive an identity after session ending',async()=>{
 global.fetch=jest.fn(async()=>response(identity));const r=render(view());await screen.findAllByText('山田 太郎');
 act(()=>window.dispatchEvent(new Event('session-ending')));
 path='/settings';r.rerender(view());
 await waitFor(()=>expect(screen.getByText(/本人情報を再確認しています/)).toBeInTheDocument());
 expect(fetch).toHaveBeenCalledTimes(1);
 expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
