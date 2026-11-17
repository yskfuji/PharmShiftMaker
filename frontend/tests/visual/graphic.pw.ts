import {test,expect} from '@playwright/test';
import {WIDTHS,THEMES,explicit,scheme,settle} from './lib/audit';
const BASE='https://127.0.0.1:18531';
// Representative real-API presentation checks, not all-operation acceptance.
test('soft presentation: filled login and four business screens retain controls',async({page,context},info)=>{
 test.setTimeout(600000);
 await page.clock.setFixedTime(new Date('2026-01-06T03:00:00Z'));
 for(const theme of THEMES){
  await context.addCookies([{name:'ps-theme',value:explicit(theme)??'system',url:BASE,secure:true}]);
  await page.emulateMedia({colorScheme:scheme(theme)});
  for(const width of WIDTHS){
   await page.setViewportSize({width,height:900});await page.goto(BASE+'/login');
   await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
   await settle(page);
   const padding=await page.getByLabel('ユーザーID').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft));
   expect(padding,'icon padding must not be overwritten by shared control styling').toBeGreaterThanOrEqual(40);
   await page.screenshot({path:info.outputPath(`login-${theme}-${width}.png`),fullPage:true});
  }
 }
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 const routes=['/planning','/planning/workflows/contracts','/planning/workflows/leave','/planning/workflows/privacy'];
 for(const route of routes){
  for(const theme of THEMES){
   await context.addCookies([{name:'ps-theme',value:explicit(theme)??'system',url:BASE,secure:true}]);await page.emulateMedia({colorScheme:scheme(theme)});
   for(const width of WIDTHS){
    await page.setViewportSize({width,height:900});await page.goto(BASE+route);
    await expect(page.getByRole('navigation',{name:'サインイン中のアカウント'})).toContainText('ログインID：admin');
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    if(route.endsWith('/contracts')){
     await expect(page.getByLabel('編集する対象')).toBeVisible();
     await page.getByLabel('編集する対象').selectOption('p0');
     await expect(page.getByLabel('職員の氏名')).not.toHaveValue('');
    }
    await settle(page);
    const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,
     shortControls:[...document.querySelectorAll<HTMLElement>('.ui-control,.ui-button:not(.ui-table-action)')].filter(e=>e.getClientRects().length&&e.getBoundingClientRect().height<43).map(e=>e.outerHTML.slice(0,160))}));
    expect(metrics.overflow,`${route} overflow ${width}`).toBe(false);expect(metrics.shortControls).toEqual([]);
    if(route==='/planning'){
     const notification=page.getByRole('button',{name:'確認しました',exact:true});
     await expect(notification).toBeVisible();
     expect(await notification.evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(16);
    }
    await info.attach(`${route}-${theme}-${width}-metrics`,{body:JSON.stringify(metrics),contentType:'application/json'});
    await page.screenshot({path:info.outputPath(`${route.replaceAll('/','-')}-${theme}-${width}.png`),fullPage:true});
   }
  }
 }
});
