import {test,expect,type Page,type TestInfo} from '@playwright/test';
import matrix from './fixtures/access-matrix.json';
// Screen transitions (plan stage T). Per role, a crawl from /planning follows every
// same-site link and must reach exactly the screens of the access matrix, each with
// one h1, its own title, the right 主な画面 item, a working skip link, the stated
// permission view and no console error. Then the transition behaviours: history,
// the unsaved-changes guard, sign-in return paths, not-found, focus after an in-app
// navigation and the session warning dialog. Synthetic data only.
type Role='admin'|'leader'|'pharmacist';
type Entry=(typeof matrix.pages)[number];
const PASSWORD:Record<Role,string>={admin:'pass-admin',leader:'pass-lead',pharmacist:'pass-ph'};
const SUFFIX=' | PharmShiftMaker';
const keyOf=(path:string)=>path.replace(/^\/schedule\/\d+\/\d+$/,'/schedule/:year/:month');
const pattern=(text:string)=>new RegExp(text.startsWith('^')?text:`^${text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`);
const entry=(key:string)=>matrix.pages.find(p=>p.key===key) as Entry|undefined;

async function signIn(page:Page,role:Role,target='/planning'){
 await page.getByLabel('ユーザーID').fill(role);await page.getByLabel('パスワード').fill(PASSWORD[role]);
 await page.getByRole('button',{name:'サインイン',exact:true}).click();
 const expected=new URL(target,'https://127.0.0.1');
 await page.waitForURL(u=>u.pathname===expected.pathname&&Array.from(expected.searchParams).every(([key,value])=>u.searchParams.get(key)===value));
}
function watch(page:Page){
 const errors:string[]=[];
 page.on('console',m=>{if(m.type()==='error')errors.push(`${page.url()} ${m.text()} @${m.location().url}`);});
 page.on('pageerror',e=>errors.push(`${page.url()} ${e.message}`));
 return errors;
}
/** Wait until a client-loaded workflow page has read the memberships. */
async function settled(page:Page){
 await page.waitForLoadState('networkidle');
 await expect(page.getByText(/(所属と操作権限|管理者の所属)を(読み込み中|確認しています)/)).toHaveCount(0);
}

async function inspect(page:Page,role:Role,url:string,status:number,info:TestInfo){
 const path=new URL(url).pathname,key=keyOf(path),expected=entry(key);
 expect(expected,`not in the access matrix: ${path}`).toBeTruthy();
 expect(status,`${path} status`).toBeLessThan(400);
 // The bypass target is deliberately unavailable while identity is still hidden/inert.
 // Its single DOM instance is also the readiness signal (identity is displayed in two places).
 await expect(page.getByRole('link',{name:'本文へ移動'})).toHaveCount(1);
 // The skip link is the first stop and moves focus to the main content.
 await page.keyboard.press('Tab');
 const skip=await page.evaluate(()=>({text:document.activeElement?.textContent?.trim(),visible:(document.activeElement as HTMLElement|null)?.getBoundingClientRect().width??0}));
 expect(skip.text,`${path} first Tab stop`).toBe('本文へ移動');expect(skip.visible,`${path} skip link shown on focus`).toBeGreaterThan(1);
 await page.keyboard.press('Enter');
 await expect.poll(()=>page.evaluate(()=>document.activeElement?.id),{message:`${path} skip link target`}).toBe('main');
 await settled(page);
 const h1=await page.evaluate(()=>Array.from(document.querySelectorAll('h1')).map(h=>({text:h.textContent?.trim()??'',visible:h.checkVisibility()})));
 expect(h1.length,`${path} one h1 ${JSON.stringify(h1)}`).toBe(1);
 expect(h1[0].visible,`${path} h1 visible`).toBe(true);expect(h1[0].text,`${path} h1`).toMatch(pattern(expected!.h1));
 const title=await page.title();
 expect(title.endsWith(SUFFIX),`${path} title ${title}`).toBe(true);
 expect(title.slice(0,-SUFFIX.length)).toMatch(pattern(expected!.title));
 const current=await page.evaluate(()=>Array.from(document.querySelectorAll('nav[aria-label="主な画面"]')).map(n=>Array.from(n.querySelectorAll('a[aria-current="page"]')).map(a=>a.textContent?.trim())));
 expect(current.length,`${path} 主な画面`).toBeGreaterThan(0);
 for(const items of current)expect(items,`${path} aria-current`).toEqual([expected!.nav]);
 const state=(expected!.roles as Record<Role,string>)[role];
 // "allowed" is also not a failure view: no alert in the main content.
 if(state==='allowed')await expect(page.getByRole('main').getByRole('alert'),`${path} ${role} alert`).toHaveCount(0);
 if('state_text' in expected!&&expected!.state_text){
  const message=page.getByText(expected!.state_text,{exact:true});
  if(state==='allowed')await expect(message).toHaveCount(0);
  else await expect(message,`${path} ${role} expected ${state}`).toBeVisible();
  if(state==='denied'){
   await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
   await expect(page.getByRole('region',{name:'職員と契約の専用操作'})).toHaveCount(0);
  }
 }
 if('links' in expected!&&expected!.links){
  const labels=await page.getByRole('main').getByRole('region',{name:/hospital\/pharmacy/}).getByRole('link').allTextContents();
  expect(labels,`${path} ${role} workflows`).toEqual((expected!.links as Record<Role,string[]>)[role]);
 }
 return {key,title,state};
}

for(const role of ['admin','leader','pharmacist'] as Role[])for(const width of [320,768,1440])
test(`navigation crawl matches the access matrix for ${role} ${width}`,async({page},info)=>{
 test.setTimeout(170_000);
 await page.setViewportSize({width,height:900});
 const errors=watch(page);
 await page.goto('/login');await signIn(page,role);
 const origin=new URL(page.url()).origin,queue=['/planning'],seen=new Set<string>(),visited:Record<string,{title:string;state:string;url:string}>={};
 while(queue.length&&Object.keys(visited).length<30){
  const next=queue.shift()!;
  const response=await page.goto(next);expect(response,next).not.toBeNull();
  const result=await inspect(page,role,page.url(),response!.status(),info);
  if(visited[result.key])continue;
  visited[result.key]={title:result.title,state:result.state,url:page.url()};
  const links=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(a=>!a.hasAttribute('download')&&a.target!=='_blank').map(a=>a.href));
  for(const href of links){
   const url=new URL(href);
   if(url.origin!==origin||url.pathname.startsWith('/login')||url.pathname.startsWith('/api/'))continue;
   const key=keyOf(url.pathname);
   if(seen.has(key))continue;seen.add(key);queue.push(url.pathname+url.search);
  }
 }
 await info.attach(`crawl-${role}-${width}`,{body:JSON.stringify({visited,errors},null,1),contentType:'application/json'});
 // Exactly the matrix: nothing missing, nothing unexpected (inspect() fails on unknown screens).
 const discoverable=matrix.pages.filter(p=>p.roles[role]!=='denied');
 expect(Object.keys(visited).sort()).toEqual(discoverable.map(p=>p.key).sort());
 // Hidden links are not permission enforcement: exercise every denied URL directly.
 for(const denied of matrix.pages.filter(p=>p.roles[role]==='denied')){
  const response=await page.goto(denied.visit);
  await inspect(page,role,page.url(),response!.status(),info);
 }
 const titles=Object.values(visited).map(v=>v.title);
 expect(new Set(titles).size,'every screen has its own title').toBe(titles.length);
 expect(errors).toEqual([]);
});

for(const width of [320,768,1440])test(`history and unsaved-changes guard on transitions ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const errors=watch(page);
 await page.goto('/login');await signIn(page,'admin');
 const main=page.getByRole('navigation',{name:'主な画面'}).first();
 // Each page finishes loading before the next move (WebKit logs requests cut off by leaving as errors).
 await page.waitForLoadState('networkidle');
 await main.getByRole('link',{name:'施設設定',exact:true}).click();await page.waitForURL(u=>u.pathname==='/settings');await page.waitForLoadState('networkidle');
 await page.goBack();await page.waitForURL(u=>u.pathname==='/planning');
 await expect(page.getByRole('heading',{level:1,name:'勤務表・計画'})).toBeVisible();await page.waitForLoadState('networkidle');
 await page.goForward();await page.waitForURL(u=>u.pathname==='/settings');
 await expect(page.getByRole('heading',{level:1,name:'施設設定'})).toBeVisible();
 // Unsaved input: cancelling the prompt keeps the page and the input; accepting leaves.
 await page.waitForLoadState('networkidle');
 await page.goto('/planning/workflows/contracts?scope=hospital%2Fpharmacy');
 const form=page.getByRole('region',{name:'職員と契約の専用操作'});
 await form.getByLabel('編集する対象').selectOption('new');await form.getByLabel('職員の氏名').fill('遷移で失わない合成名');
 const decisions:boolean[]=[false];const prompts:string[]=[];
 page.on('dialog',d=>{prompts.push(d.type());if(d.type()==='beforeunload'||decisions.shift())void d.accept();else void d.dismiss();});
 await page.getByRole('navigation',{name:'主な画面'}).first().getByRole('link',{name:'施設設定',exact:true}).click();
 await expect.poll(()=>prompts.length).toBe(1);
 expect(new URL(page.url()).pathname).toBe('/planning/workflows/contracts');
 await expect(form.getByLabel('職員の氏名')).toHaveValue('遷移で失わない合成名');
 decisions.push(true);
 await page.getByRole('navigation',{name:'主な画面'}).first().getByRole('link',{name:'施設設定',exact:true}).click();
 await page.waitForURL(u=>u.pathname==='/settings');
 expect(prompts[0]).toBe('confirm');
 expect(errors).toEqual([]);
});

for(const width of [320,768,1440])test(`sign-in returns to the same page and department ${width}`,async({page,context})=>{
 await page.setViewportSize({width,height:900});
 const target='/planning/workflows/leave?scope=hospital%2Fpharmacy';
 // Signed out: the proxy sends the request to sign-in with the path and query.
 await page.goto(target);await page.waitForURL(u=>u.pathname==='/login');
 expect(new URL(page.url()).searchParams.get('redirectTo')).toBe(target);
 await signIn(page,'leader',target);
 await expect(page.getByRole('heading',{level:1,name:'休暇'})).toBeVisible();
 // Signed in, but the API answers 401 (session ended elsewhere): 「ログインへ」 keeps the query.
 await page.route('**/planning/scopes',route=>route.fulfill({status:401,contentType:'application/json',body:'{"detail":"expired"}'}));
 await page.reload();
 await expect(page.getByText(/ログインし直してください。/)).toBeVisible();
 const link=page.getByRole('link',{name:'ログインへ',exact:true});
 expect(new URL(await link.getAttribute('href')??'',page.url()).searchParams.get('redirectTo')).toBe('/planning/workflows/leave?scope=hospital%2Fpharmacy');
 await page.unroute('**/planning/scopes');
 await link.click();await page.waitForURL(u=>u.pathname==='/login');
 await context.clearCookies();
 await signIn(page,'leader',target);
 await expect(page.getByLabel('施設・部署')).toHaveValue('hospital/pharmacy');
 // Only same-site paths are accepted as a return destination.
 for(const hostile of ['%2F%2Fexample.org%2Fx','%2F%09%2Fexample.org','%2F%0A%2Fexample.org','%2F%5Cexample.org','%2F.%2F%2Fexample.org','%2F%252e%2F%2Fexample.org']){
  // Leave the signed-in page first: it reacts to the lost session with its own redirect.
  await page.goto('about:blank');await context.clearCookies();
  await page.goto(`/login?redirectTo=${hostile}`);await signIn(page,'leader','/planning');
 }
});

for(const width of [320,768,1440])test(`unknown addresses show the Japanese not-found page ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const errors=watch(page);
 await page.goto('/login');await signIn(page,'pharmacist');
 // Each page finishes loading before the next move (WebKit logs requests cut off by leaving as errors).
 await page.waitForLoadState('networkidle');
 for(const path of ['/planning/workflows/unknown','/schedule/2026/13','/no-such-page']){
  const response=await page.goto(path);await page.waitForLoadState('networkidle');
  // An unmatched address is a 404. A known route with an unknown parameter renders the same
  // view itself (a notFound() thrown there reaches the browser as an empty page; see
  // app/not-found.tsx), so it answers 200 and asks not to be indexed.
  expect(response?.status(),path).toBe(path==='/no-such-page'?404:200);
  await expect(page.locator('meta[name="robots"][content*="noindex"]'),path).not.toHaveCount(0);
  // Rendered on the server: the page does not depend on scripts to show the heading.
  expect(await response!.text(),`${path} server-rendered`).toMatch(/<h1[^>]*>ページが見つかりません<\/h1>/);
  await expect(page.getByRole('heading',{level:1,name:'ページが見つかりません'})).toBeVisible();
  expect(await page.title()).toBe('ページが見つかりません'+SUFFIX);
  await expect(page.getByRole('navigation',{name:'主な画面'}).getByRole('link',{name:'勤務表・計画',exact:true})).toBeVisible();
  // One level-1 heading for assistive technology (a streamed not-found may leave the hidden
  // loading view in the DOM in WebKit; hidden elements are not in the accessibility tree).
  await expect(page.getByRole('heading',{level:1})).toHaveCount(1);
 }
 await page.getByRole('link',{name:'勤務計画・公開へ',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 // Only the not-found documents themselves may log their 404 status.
 expect(errors.filter(e=>!/status of 404.*@https:\/\/[^/]+\/no-such-page$/.test(e))).toEqual([]);
});

for(const width of [320,768,1440])test(`focus moves to the new heading after an in-app navigation ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/login');await signIn(page,'leader');
 await page.goto('/schedule/2026/4');
 await expect(page.getByRole('heading',{level:1,name:'2026年4月の確定済みシフトはありません'})).toBeVisible();
 expect(await page.title()).toBe('2026年4月のシフト'+SUFFIX);
 // A client-side (next/link) transition: no page load, so focus is moved on purpose.
 await page.evaluate(()=>{(window as unknown as {__same:boolean}).__same=true;});
 await page.getByRole('link',{name:'ダッシュボードに戻る',exact:true}).click();
 await page.waitForURL(u=>u.pathname==='/dashboard');
 const heading=page.getByRole('heading',{level:1,name:'ダッシュボード'});
 await expect(heading).toBeFocused();
 expect(await page.evaluate(()=>(window as unknown as {__same?:boolean}).__same)).toBe(true);
 expect(await page.title()).toBe('ダッシュボード'+SUFFIX);
 // Native compatibility navigation starts a new document; retain keyboard access through the skip link.
 await page.getByRole('navigation',{name:'主な画面'}).first().getByRole('link',{name:'業務管理',exact:true}).click();
 await page.getByRole('link',{name:'旧保存シフト',exact:true}).click();
 await page.waitForURL(u=>/^\/schedule\/\d+\/\d+$/.test(u.pathname));
 await expect(page.getByRole('heading',{level:1,name:/^\d{4}年\d{1,2}月の確定済みシフトはありません$/})).toBeVisible();
 await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'本文へ移動'})).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.getByRole('main')).toBeFocused();
 // Native compatibility navigation preserves the URL contract; it may reload the document.
});

for(const width of [320,768,1440])test(`session warning is a modal dialog ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/login');await signIn(page,'pharmacist');
 // A short idle limit from the (synthetic) refresh answer brings the warning at once.
 let short=true;
 await page.route('**/auth/refresh',async route=>{
  const response=await route.fetch();const body=await response.json();
  await route.fulfill({response,json:short?{...body,idle_timeout_seconds:240}:body});
 });
 await page.clock.install();
 await page.goto('/dashboard');
 const opener=page.getByRole('button',{name:'サインアウト',exact:true});
 await expect(opener).toBeVisible();await opener.focus();
 await page.clock.fastForward(125_000);
 const dialog=page.getByRole('alertdialog');
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('button',{name:'操作を続ける'})).toBeFocused();
 await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'今すぐサインアウト'})).toBeFocused();
 await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'操作を続ける'})).toBeFocused();
 await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('button',{name:'今すぐサインアウト'})).toBeFocused();
 // Everything but the dialog is inert while it is open.
 expect(await page.evaluate(()=>Array.from(document.body.children).filter(c=>c.getAttribute('role')!=='alertdialog'&&!c.hasAttribute('inert')&&!['SCRIPT','TEMPLATE'].includes(c.tagName)).map(c=>c.tagName))).toEqual([]);
 short=false;
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(opener).toBeFocused();
 expect(await page.evaluate(()=>document.querySelectorAll('[inert]').length)).toBe(0);
 expect(new URL(page.url()).pathname).toBe('/dashboard');
});
