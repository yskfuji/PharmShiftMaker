import {test,expect} from '@playwright/test';
import {audit,WIDTHS,FIXED_NOW} from './lib/audit';
const BASE='https://127.0.0.1:18531',API='https://127.0.0.1:18540';
for(const [user,password] of [['admin','pass-admin'],['leader','pass-lead'],['pharmacist','pass-ph']]){
 test(`${user}: primary navigation, compatibility permissions and retained context`,async({page},info)=>{
  test.setTimeout(180000);await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(BASE+'/login');await page.getByLabel('ユーザーID').fill(user);await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
  for(const width of WIDTHS){
   await page.setViewportSize({width,height:900});
   await page.goto(BASE+'/planning/workflows?scope=hospital/pharmacy&period=2026-02');
   const main=page.getByRole('navigation',{name:'主な画面'}).filter({visible:true});
   await expect(main.getByRole('link')).toHaveCount(4);
   await expect(page.getByRole('heading',{name:'互換管理',exact:true})).toBeVisible();
   await page.getByRole('link',{name:'休暇',exact:true}).click();
   await expect(page).toHaveURL(/period=2026-02/);
   await expect(page.getByRole('combobox',{name:'施設・部署',exact:true})).toHaveValue('hospital/pharmacy');
   await page.getByRole('navigation',{name:'主な画面'}).filter({visible:true}).getByRole('link',{name:'業務管理',exact:true}).click();
   await expect(page).toHaveURL(/period=2026-02/);
   if(user==='pharmacist')await expect(page.getByRole('link',{name:'旧休暇枠',exact:true})).toHaveCount(0);
   else await expect(page.getByRole('link',{name:'旧休暇枠',exact:true})).toBeVisible();
   await page.goto(BASE+'/requests');
   await expect(page.getByRole('heading',{name:'旧休暇枠',exact:true})).toBeVisible();
   if(user==='admin')await expect(page.getByRole('button',{name:'登録/更新',exact:true})).toBeVisible();
   else await expect(page.getByRole('button',{name:'登録/更新',exact:true})).toHaveCount(0);
   if(user==='leader')await expect(page.getByText('参照のみ。枠の更新は管理者・開発者に限られます。')).toBeVisible();
   if(user==='pharmacist')await expect(page.getByRole('main').getByRole('alert')).toContainText('参照する権限がありません');
   const result=await audit(page,info,`ia-compatibility-${user}-${width}`,width,'light');expect(result.findings).toEqual([]);
  }
  if(user!=='admin'){
   const response=await page.request.put(API+'/leave-quotas/2026/person-0/PAID_LEAVE_REQUEST?month=1',{data:{total_days:11},headers:{Origin:BASE}});
   expect(response.status()).toBe(403); // API denial, not merely hidden controls
  }
 });
}
test('contract selection remains editable with in-page navigation and explicit unsaved exit',async({page},info)=>{
 test.setTimeout(180000);await page.clock.setFixedTime(FIXED_NOW);
 await page.goto(BASE+'/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 await page.goto(BASE+'/planning/workflows/contracts?scope=hospital/pharmacy');
 const form=page.getByRole('region',{name:'職員と契約の専用操作'});
 await form.getByLabel('編集する対象').selectOption({index:2});
 const name=await form.getByLabel('職員の氏名').inputValue();
 await form.getByLabel('職員の氏名').fill(name+'・未保存');
 let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss();});
 await page.getByRole('navigation',{name:'主な画面'}).filter({visible:true}).getByRole('link',{name:'業務管理',exact:true}).click();
 expect(dialogs).toBe(1);await expect(form.getByLabel('職員の氏名')).toHaveValue(name+'・未保存');
 for(const width of WIDTHS){await page.setViewportSize({width,height:900});const result=await audit(page,info,`ia-contract-edited-${width}`,width,'light');expect(result.findings).toEqual([]);}
 await form.getByRole('button',{name:'未保存の内容を破棄',exact:true}).click();
 await expect(form.getByLabel('職員の氏名')).toHaveValue(name);
});
