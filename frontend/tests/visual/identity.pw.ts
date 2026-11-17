import {test,expect} from '@playwright/test';
import {WIDTHS,THEMES,explicit,scheme} from './lib/audit';
const BASE='https://127.0.0.1:18531';
const routes=['/dashboard','/planning','/planning/workflows','/planning/workflows/contracts','/planning/workflows/outside','/planning/workflows/leave','/planning/workflows/actuals','/planning/workflows/privacy','/planning/workflows/recovery','/settings','/requests','/schedule/2026/1'];
for(const [user,password] of [['admin','pass-admin'],['leader','pass-lead'],['pharmacist','pass-ph'],['developer','pass-dev']]){
 test(`${user}: verified account meaning across routes, widths and themes`,async({page,context},info)=>{
  test.setTimeout(360000);
  await page.goto(BASE+'/login');await page.getByLabel('ユーザーID').fill(user);await page.getByLabel('パスワード').fill(password);await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
  // These cookies are intentionally invalid/dishonest; signed authentication is untouched.
  await context.addCookies([{name:'pharmshift_user',value:'%ZZ',url:BASE,secure:true},{name:'pharmshift_role',value:'ADMIN',url:BASE,secure:true}]);
  for(const route of routes){
   await page.goto(BASE+route);
   const header=page.getByRole('navigation',{name:'サインイン中のアカウント'});
   await expect(header.locator('[data-verified-identity]')).toContainText(`ログインID：${user}`);
   const slots=page.locator('[data-verified-identity]');
   await expect(slots).toHaveCount(2);
   await expect(slots).toHaveText([`${user}ログインID：${user}`,`${user}ログインID：${user}`]);
   await expect(page.getByText('%ZZ',{exact:true})).toHaveCount(0);
  }
  await page.goto(BASE+'/planning');
  for(const theme of THEMES){
   await context.addCookies([{name:'ps-theme',value:explicit(theme)??'system',url:BASE,secure:true}]);await page.emulateMedia({colorScheme:scheme(theme)});
   for(const width of WIDTHS){
    await page.setViewportSize({width,height:900});await page.reload();
    await expect(page.getByRole('navigation',{name:'サインイン中のアカウント'})).toContainText(`ログインID：${user}`);
    const image=await page.screenshot({fullPage:true});await info.attach(`identity-${user}-${theme}-${width}`,{body:image,contentType:'image/png'});
   }
  }
 });
}
