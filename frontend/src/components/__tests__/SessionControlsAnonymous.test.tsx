// A separate file: SessionControls remembers, per page load, whether a sign-in cookie was
// ever seen, and this case needs a page on which it never was.
import {render,waitFor} from '@testing-library/react';
import SessionControls from '../SessionControls';
import {browserNavigation} from '@/lib/browserNavigation';

const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body} as Response);

test('someone who never signed in is sent to sign-in without an expiry notice',async()=>{
 const replace=jest.fn();
 jest.spyOn(browserNavigation,'replace').mockImplementation(url=>replace(url));
 jest.spyOn(browserNavigation,'reload').mockImplementation(()=>{});
 jest.spyOn(browserNavigation,'pathname').mockImplementation(()=>'/planning');
 jest.spyOn(browserNavigation,'pathAndSearch').mockImplementation(()=>'/planning');
 global.fetch=jest.fn(async()=>response({detail:'missing'},401)) as any;
 render(<SessionControls/>);
 await waitFor(()=>expect(replace).toHaveBeenCalledWith('/login?redirectTo=%2Fplanning'));
 expect(replace).not.toHaveBeenCalledWith(expect.stringContaining('reason=expired'));
});
