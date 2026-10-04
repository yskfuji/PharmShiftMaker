import {test,expect,type Page} from '@playwright/test';
// S03: the nonce CSP is enforced by real browsers on every page, the app runs
// without violations, and injected markup, inline handlers and eval do not run.
// Boundary (CSP 'strict-dynamic', observed in all three engines in e2e-all-r1):
// a script element created by script that already runs is trusted; the policy
// protects against injected markup, not against code that already executes.
const ROUTES=['/login','/','/dashboard','/requests','/settings','/schedule','/schedule/2026/4','/planning',
 '/planning/workflows/contracts','/planning/workflows/outside','/planning/workflows/leave',
 '/planning/workflows/actuals','/planning/workflows/privacy','/planning/workflows/recovery'];

async function watch(page:Page){
 const errors:string[]=[];
 // Console errors only: Firefox also logs a warning that 'self' is ignored when
 // 'strict-dynamic' is present (the fallback kept for older browsers), which is not a violation.
 page.on('console',m=>{if(m.type()==='error'&&/Content[- ]Security[- ]Policy|Refused to/i.test(m.text()))errors.push(m.text());});
 // Init scripts are run by the automation protocol, not by the page, so the
 // policy does not apply to this listener. It is the engine-independent record.
 await page.addInitScript(()=>{(window as any).__csp=[];document.addEventListener('securitypolicyviolation',e=>(window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));});
 return errors;
}
const nonceOf=(policy:string)=>/'nonce-([^']+)'/.exec(policy)?.[1];

test('every page carries a fresh nonce policy and loads without violations',async({page})=>{
 const errors=await watch(page);
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 const seen=new Set<string>();
 for(const route of ROUTES){
  const response=await page.goto(route);expect(response,route).not.toBeNull();
  const policy=(await response!.allHeaders())['content-security-policy']??'';
  expect(policy,route).toContain("'strict-dynamic'");expect(policy,route).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
  const nonce=nonceOf(policy);expect(nonce,route).toBeTruthy();expect(seen.has(nonce!),route).toBe(false);seen.add(nonce!);
  // Every script in the served HTML carries this response's nonce.
  const tags=(await response!.text()).match(/<script\b[^>]*>/gi)??[];
  expect(tags.length,route).toBeGreaterThan(0);expect(tags.filter(t=>!t.includes(`nonce="${nonce}"`)),route).toEqual([]);
  await page.waitForLoadState('networkidle');
  // In the document too (the property: browsers hide the attribute); chunks that
  // webpack adds later (data-webpack) are trusted through 'strict-dynamic' instead.
  const scripts=await page.evaluate(()=>Array.from(document.querySelectorAll('script:not([data-webpack])')).map(s=>(s as HTMLScriptElement).nonce));
  expect(scripts.every(n=>n===nonce),route).toBe(true);
  expect(await page.evaluate(()=>(window as any).__csp),route).toEqual([]);
 }
 expect(errors).toEqual([]);
});

test('injected markup, inline handlers and eval do not run',async({page})=>{
 await watch(page);
 await page.goto('/login');await page.waitForLoadState('networkidle');
 const ran=await page.evaluate(async()=>{
  const w=window as any;
  // Markup as an injection would deliver it: an inline event handler, and a
  // parser-inserted script in a srcdoc frame (which inherits the page's policy).
  const holder=document.createElement('div');holder.innerHTML='<img src="data:," onerror="window.__handler=1">';document.body.appendChild(holder);
  // The marker is the positive control: the frame itself loads, only its script is refused.
  const frame=document.createElement('iframe');frame.srcdoc='<p id="loaded">x</p><script>parent.__framed=1<\/script>';document.body.appendChild(frame);
  // Boundary: a script element created by running script is trusted ('strict-dynamic').
  // Eval is tried by the page's own code in a later task: while the automation
  // protocol evaluates (this function, and anything it runs synchronously), all
  // three engines lift the eval restriction (observed in e2e-all-r2 and csp-r3).
  const created=document.createElement('script');
  created.textContent="window.__created=1;setTimeout(()=>{try{(0,eval)('1');window.__eval='ran'}catch(e){window.__eval=e.name}},0)";
  document.body.appendChild(created);
  await new Promise(r=>setTimeout(r,1000));
  return {handler:w.__handler,framed:w.__framed,frameLoaded:!!frame.contentDocument?.getElementById('loaded'),
          evaluated:w.__eval,created:w.__created,reports:w.__csp as string[]};
 });
 expect(ran.handler).toBeUndefined();expect(ran.frameLoaded).toBe(true);expect(ran.framed).toBeUndefined();
 expect(ran.created).toBe(1);expect(ran.evaluated).toBe('EvalError');
 expect(ran.reports.filter(r=>/^(frame-src|child-src|default-src)/.test(r))).toEqual([]);
 expect(ran.reports.some(r=>r.startsWith('script-src')&&/inline/.test(r))).toBe(true);
 expect(ran.reports.some(r=>/eval/.test(r))).toBe(true);
});
