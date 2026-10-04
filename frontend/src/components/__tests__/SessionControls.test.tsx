import {render,screen,fireEvent,act,waitFor} from '@testing-library/react';
import SessionControls from '../SessionControls';
import {browserNavigation} from '@/lib/browserNavigation';

const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body} as Response);
const interruptedResponse=()=>Object.assign(response({}),{json:async()=>{throw new DOMException('body interrupted','AbortError');}});
let location:{pathname:string;replace:jest.Mock;reload:jest.Mock};
beforeEach(()=>{
 location={pathname:'/planning',replace:jest.fn(),reload:jest.fn()};
 jest.spyOn(browserNavigation,'replace').mockImplementation(url=>location.replace(url));
 jest.spyOn(browserNavigation,'reload').mockImplementation(()=>location.reload());
 jest.spyOn(browserNavigation,'pathname').mockImplementation(()=>location.pathname);
 jest.spyOn(browserNavigation,'pathAndSearch').mockImplementation(()=>location.pathname);
 document.cookie='pharmshift_role=ADMIN';document.cookie='pharmshift_user=%E7%AE%A1%E7%90%86%E8%80%85';
});
afterEach(()=>{jest.useRealTimers();jest.restoreAllMocks();window.localStorage.clear();document.cookie='pharmshift_role=; expires=Thu, 01 Jan 1970 00:00:00 GMT';});

test('nothing is shown on the sign-in page or without a session',()=>{
 global.fetch=jest.fn() as any;
 location.pathname='/login';
 const {container}=render(<SessionControls/>);
 expect(container).toBeEmptyDOMElement();expect(global.fetch).not.toHaveBeenCalled();
});

test('sign-out revokes the session, covers the page and replaces the location',async()=>{
 const calls:string[]=[];
 global.fetch=jest.fn(async(u:any)=>{calls.push(String(u));return String(u).endsWith('/auth/refresh')?response({idle_timeout_seconds:900}):response({},204);}) as any;
 render(<SessionControls/>);
 expect(await screen.findByRole('button',{name:'サインアウト'})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'サインアウト'}));
 expect(await screen.findByText(/サインアウトします。/)).toBeInTheDocument();
 await waitFor(()=>expect(location.replace).toHaveBeenCalledWith('/login?reason=signed_out'));
 expect(calls.some(c=>c.endsWith('/auth/logout'))).toBe(true);
});

test('the idle limit warns first, activity renews, and silence signs out',async()=>{
 jest.useFakeTimers();
 const calls:string[]=[];
 global.fetch=jest.fn(async(u:any)=>{calls.push(String(u));return String(u).endsWith('/auth/refresh')?response({idle_timeout_seconds:900}):response({},204);}) as any;
 render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 await act(async()=>{jest.advanceTimersByTime(779_000);});
 expect(screen.queryByRole('alertdialog')).toBeNull();
 await act(async()=>{jest.advanceTimersByTime(2_000);});   // 13 minutes: two minutes before the end
 expect(screen.getByRole('alertdialog')).toHaveTextContent('まもなく自動的にサインアウトします');
 const renewals=calls.filter(c=>c.endsWith('/auth/refresh')).length;
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'操作を続ける'}));await Promise.resolve();});
 expect(screen.queryByRole('alertdialog')).toBeNull();
 expect(calls.filter(c=>c.endsWith('/auth/refresh')).length).toBeGreaterThan(renewals);
 await act(async()=>{jest.advanceTimersByTime(901_000);await Promise.resolve();});
 expect(screen.getByText(/操作がなかったため、サインアウトします/)).toBeInTheDocument();
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(location.replace).toHaveBeenCalledWith('/login?redirectTo=%2Fplanning&reason=idle');
});

test('an expired session goes to sign-in and a restored page is reloaded',async()=>{
 global.fetch=jest.fn(async()=>response({detail:'expired'},401)) as any;
 render(<SessionControls/>);
 await waitFor(()=>expect(location.replace).toHaveBeenCalledWith('/login?redirectTo=%2Fplanning&reason=expired'));
 const restored=new Event('pageshow') as PageTransitionEvent;Object.defineProperty(restored,'persisted',{value:true});
 window.dispatchEvent(restored);
 expect(location.reload).toHaveBeenCalled();
});

test('the warning buttons work although pressing them is activity',async()=>{
 jest.useFakeTimers();
 const calls:string[]=[];
 global.fetch=jest.fn(async(u:any)=>{calls.push(String(u));return String(u).endsWith('/auth/refresh')?response({idle_timeout_seconds:900}):response({},204);}) as any;
 render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 await act(async()=>{jest.advanceTimersByTime(781_000);});
 const now=screen.getByRole('button',{name:'今すぐサインアウト'});
 fireEvent.pointerDown(now);
 expect(screen.getByRole('alertdialog')).toBeInTheDocument();      // still there for the click
 await act(async()=>{fireEvent.click(now);await Promise.resolve();await Promise.resolve();});
 expect(location.replace).toHaveBeenCalledWith('/login?reason=signed_out');
 expect(calls.some(c=>c.endsWith('/auth/logout'))).toBe(true);
});

test('a failed sign-out is retried and then reported instead of leaving silently',async()=>{
 global.fetch=jest.fn(async(u:any)=>String(u).endsWith('/auth/refresh')?response({idle_timeout_seconds:900}):response({detail:'unavailable'},503)) as any;
 render(<SessionControls/>);
 fireEvent.click(await screen.findByRole('button',{name:'サインアウト'}));
 expect(await screen.findByText(/サインアウトを確認できませんでした/)).toBeInTheDocument();
 expect(location.replace).not.toHaveBeenCalled();
 expect((global.fetch as jest.Mock).mock.calls.filter(([u])=>String(u).endsWith('/auth/logout'))).toHaveLength(3);
});

test('work in another tab keeps this tab open, and the absolute limit ends it',async()=>{
 jest.useFakeTimers();
 const absolute=new Date(Date.now()+20*60_000).toISOString();
 global.fetch=jest.fn(async(u:any)=>String(u).endsWith('/auth/refresh')?response({idle_timeout_seconds:900,absolute_expires_at:absolute}):response({},204)) as any;
 render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 await act(async()=>{jest.advanceTimersByTime(600_000);});
 window.localStorage.setItem('pharmshift-session-renewed-at',String(Date.now()));   // renewed by another tab
 await act(async()=>{jest.advanceTimersByTime(300_000);});                           // 15 min after this tab's renewal
 expect(screen.queryByText(/サインアウトします/)).toBeNull();
 await act(async()=>{jest.advanceTimersByTime(301_000);await Promise.resolve();});   // absolute limit (20 min)
 expect(screen.getByText(/有効期限が切れました/)).toBeInTheDocument();
});

test('the idle watcher runs with the default limit when the server has not answered',async()=>{
 jest.useFakeTimers();
 global.fetch=jest.fn(async(u:any)=>String(u).endsWith('/auth/refresh')?response({},503):response({},204)) as any;
 render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 await act(async()=>{jest.advanceTimersByTime(781_000);});
 expect(screen.getByRole('alertdialog')).toBeInTheDocument();
 expect(document.activeElement).toBe(screen.getByRole('button',{name:'操作を続ける'}));
});

test('an aborted renewal body keeps the last confirmed deadline and releases the request',async()=>{
 jest.useFakeTimers();
 let requests=0;
 const aborted=interruptedResponse();
 global.fetch=jest.fn(async(u:any)=>String(u).endsWith('/auth/logout')?response({},204):++requests===1?response({idle_timeout_seconds:90}):aborted) as any;
 render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 const confirmed=window.localStorage.getItem('pharmshift-session-renewed-at');
 await act(async()=>{jest.advanceTimersByTime(61_000);fireEvent.keyDown(document.body,{key:'Tab'});});
 expect(requests).toBe(2);
 expect(window.localStorage.getItem('pharmshift-session-renewed-at')).toBe(confirmed);
 await act(async()=>{jest.advanceTimersByTime(1_000);fireEvent.keyDown(document.body,{key:'Tab'});});
 expect(requests).toBe(3); // finally permits another attempt after the failed body.
 await act(async()=>{jest.advanceTimersByTime(29_000);});
 expect(location.replace).toHaveBeenCalledWith('/login?redirectTo=%2Fplanning&reason=idle');
});

test('activity may retry an aborted body and only a confirmed retry updates shared time',async()=>{
 jest.useFakeTimers();let requests=0;
 global.fetch=jest.fn(async()=>++requests===1?interruptedResponse():response({idle_timeout_seconds:900})) as any;
 render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 expect(window.localStorage.getItem('pharmshift-session-renewed-at')).toBeNull();
 await act(async()=>{jest.advanceTimersByTime(61_000);fireEvent.keyDown(document.body,{key:'Tab'});});
 expect(requests).toBe(2);
 expect(Number(window.localStorage.getItem('pharmshift-session-renewed-at'))).toBe(Date.now());
});

test('a late renewal body cannot restore shared time after confirmed sign-out',async()=>{
 let complete!:(v:unknown)=>void;
 const body=new Promise(resolve=>{complete=resolve;});
 global.fetch=jest.fn(async(u:any)=>String(u).endsWith('/auth/refresh')?{ok:true,status:200,json:()=>body} as Response:response({},204)) as any;
 render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'サインアウト'}));});
 expect(window.localStorage.getItem('pharmshift-session-renewed-at')).toBe('0');
 await act(async()=>{complete({idle_timeout_seconds:900});});
 expect(window.localStorage.getItem('pharmshift-session-renewed-at')).toBe('0');
 expect(location.replace).toHaveBeenCalledTimes(1);
 expect(location.replace).toHaveBeenCalledWith('/login?reason=signed_out');
});

test.each([200,401])('a response after unmount has no shared-state or redirect effect (%s)',async(status)=>{
 let complete!:(v:Response)=>void;
 global.fetch=jest.fn(()=>new Promise<Response>(resolve=>{complete=resolve;})) as any;
 const view=render(<SessionControls/>);
 view.unmount();
 await act(async()=>{complete(response({idle_timeout_seconds:900},status));});
 expect(window.localStorage.getItem('pharmshift-session-renewed-at')).toBeNull();
 expect(location.replace).not.toHaveBeenCalled();
});

test('a renewal body completing after unmount cannot update shared time',async()=>{
 let complete!:(v:unknown)=>void;
 const body=new Promise(resolve=>{complete=resolve;});
 global.fetch=jest.fn(async()=>({ok:true,status:200,json:()=>body} as Response)) as any;
 const view=render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 view.unmount();
 await act(async()=>{complete({idle_timeout_seconds:900});});
 expect(window.localStorage.getItem('pharmshift-session-renewed-at')).toBeNull();
 expect(location.replace).not.toHaveBeenCalled();
});

test('an interrupted renewal does not remove the last confirmed absolute deadline',async()=>{
 jest.useFakeTimers();let requests=0;
 const absolute=new Date(Date.now()+90_000).toISOString();
 global.fetch=jest.fn(async(u:any)=>String(u).endsWith('/auth/logout')?response({},204):++requests===1?response({idle_timeout_seconds:900,absolute_expires_at:absolute}):interruptedResponse()) as any;
 render(<SessionControls/>);
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 await act(async()=>{jest.advanceTimersByTime(61_000);fireEvent.keyDown(document.body,{key:'Tab'});});
 await act(async()=>{jest.advanceTimersByTime(30_000);});
 expect(location.replace).toHaveBeenCalledWith('/login?redirectTo=%2Fplanning&reason=expired');
});
