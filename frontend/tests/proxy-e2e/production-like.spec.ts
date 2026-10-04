import {test,expect,type Page,type BrowserContext} from '@playwright/test';
const PERSON='合成職員・長い氏名・薬剤部の画面評価';   // synthetic personal data shown to a signed-in admin
const nonceOf=(policy:string)=>/'nonce-([^']+)'/.exec(policy)?.[1];

async function signIn(page:Page){
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
}
async function token(context:BrowserContext){return (await context.cookies()).find(c=>c.name==='pharmshift_token');}
async function apiStatus(page:Page){return page.evaluate(async()=>(await fetch('/api/planning/scopes',{credentials:'include'})).status);}

test('the nonce is fresh on every request through the proxy and the policy is sent once',async({page})=>{
 const seen:string[]=[];
 for(let i=0;i<3;i++){
  const response=(await page.goto('/login'))!;
  const headers=await response.headersArray();
  const policies=headers.filter(h=>h.name.toLowerCase()==='content-security-policy');
  expect(policies).toHaveLength(1);
  expect(headers.some(h=>h.name.toLowerCase()==='age')).toBe(false);          // not served from a cache
  expect(headers.find(h=>h.name.toLowerCase()==='cache-control')?.value).toContain('no-store');
  const nonce=nonceOf(policies[0].value)!;expect(nonce).toBeTruthy();seen.push(nonce);
  const tags=(await response.text()).match(/<script\b[^>]*>/gi)??[];
  expect(tags.filter(t=>!t.includes(`nonce="${nonce}"`))).toEqual([]);
  expect(policies[0].value).toContain('connect-src \'self\' https://pharmshift.test:18540');
 }
 expect(new Set(seen).size).toBe(3);
});

test('redirects stay on the public https origin and cookies are Secure and HttpOnly',async({page,context})=>{
 await page.goto('/planning');
 expect(page.url()).toMatch(/^https:\/\/pharmshift\.test:18540\/login\?redirectTo=%2Fplanning$/);
 await signIn(page);
 const session=await token(context);
 expect(session).toMatchObject({secure:true,httpOnly:true,sameSite:'Lax',domain:'pharmshift.test'});
 await page.goto('/planning/workflows/contracts');
 await expect.poll(async()=>(await page.content()).includes(PERSON)).toBe(true);
 expect(await apiStatus(page)).toBe(200);
});

test('sign-out ends the session on the server and going back shows no personal data',async({page,context},info)=>{
 await page.addInitScript(()=>window.addEventListener('pageshow',e=>{if(e.persisted)sessionStorage.setItem('restored-from-cache','1');}));
 await signIn(page);
 // The page showing personal data stays in the history: sign-out happens on the
 // next page (sign-out replaces only the page it is pressed on).
 await page.goto('/planning/workflows/contracts');
 await expect.poll(async()=>(await page.content()).includes(PERSON)).toBe(true);
 await page.goto('/planning/workflows/leave');
 const before=(await token(context))!;
 await page.getByRole('button',{name:'サインアウト',exact:true}).click();
 await page.waitForURL(u=>u.pathname==='/login'&&u.searchParams.get('reason')==='signed_out');
 await expect(page.getByRole('status').filter({hasText:'サインアウトしました。'})).toBeVisible();
 expect(await token(context)).toBeUndefined();
 await page.goBack();
 await page.waitForTimeout(3000);
 // Back to the contracts page: it is not shown again (sign-in is required).
 expect(new URL(page.url()).pathname).toBe('/login');
 expect(new URL(page.url()).searchParams.get('redirectTo')).toBe('/planning/workflows/contracts');
 expect((await page.content()).includes(PERSON)).toBe(false);
 await info.attach('restored-from-back-forward-cache',{body:String(await page.evaluate(()=>sessionStorage.getItem('restored-from-cache'))),contentType:'text/plain'});
 await info.attach('url-after-back',{body:page.url(),contentType:'text/plain'});
 // The copied cookie no longer works: the session was revoked on the server.
 await context.addCookies([before]);
 await page.goto('/login');
 expect(await apiStatus(page)).toBe(401);
});

test('the idle limit warns, renews on activity, and then ends the session',async({page,context,browser})=>{
 test.setTimeout(240000);
 await signIn(page);
 await page.goto('/planning/workflows/contracts');
 await expect.poll(async()=>(await page.content()).includes(PERSON)).toBe(true);
 const dialog=page.getByRole('alertdialog');
 await expect(dialog).toBeVisible({timeout:45000});                             // 60s limit: warning after 30s
 const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/auth/refresh')&&r.ok());
 await dialog.getByRole('button',{name:'操作を続ける'}).click();
 await refreshed;
 await expect(dialog).toBeHidden();
 const renewed=(await token(context))!;
 await page.waitForURL(u=>u.pathname==='/login'&&u.searchParams.get('reason')==='idle',{timeout:90000});
 expect((await page.content()).includes(PERSON)).toBe(false);
 await context.addCookies([renewed]);
 expect(await apiStatus(page)).toBe(401);
 // The server enforces the limit by itself: a cookie left unused for 60s is refused
 // even by a page that never ran the client-side timer.
 const other=await browser.newContext({ignoreHTTPSErrors:true});
 const probe=await other.newPage();
 const signInPage=await other.newPage();
 await signIn(signInPage);
 const idle=(await token(other))!;
 await signInPage.close();
 await other.clearCookies();await other.addCookies([idle]);
 await probe.goto('/login');
 expect(await apiStatus(probe)).toBe(200);
 await probe.waitForTimeout(65000);
 expect(await apiStatus(probe)).toBe(401);
 await other.close();
});
