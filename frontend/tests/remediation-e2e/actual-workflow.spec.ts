import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for(const width of [320,768,1440])test(`dedicated actual correction retry and review ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');
 await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 await page.getByRole('link',{name:'実績',exact:true}).click();
 await expect(page.getByLabel('照合する勤務')).toBeVisible();
 await page.getByLabel('照合する勤務').selectOption('actual:synthetic-clock');
 await page.getByLabel('実労働1 終了',{exact:true}).fill(`2026-01-05T14:00:${String(width%59+1).padStart(2,'0')}`);
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('link',{name:'休暇',exact:true}).click();
 await expect(page).toHaveURL(/workflows\/actuals/);
 let first='',attempts=0;
 await page.route('**/planning/compliance/actual-events?*',async route=>{
   attempts++;if(attempts===1){first=route.request().postData()!;const r=await route.fetch();expect(r.status()).toBe(200);await route.abort('failed');}
   else {expect(route.request().postData()).toBe(first);await route.continue();}
 });
 await page.getByRole('button',{name:'実績と所定区分を保存・再送',exact:true}).click();
 await expect(page.getByRole('main').getByRole('status')).toContainText('通信が途切れた場合');
 await page.getByRole('button',{name:'実績と所定区分を保存・再送',exact:true}).click();
 await expect(page.getByRole('main').getByRole('status')).toContainText('実績と勤務区分を保存しました');
 await page.getByLabel('照合内容・差異の理由').fill('合成原本との差異を確認。全件照合の証明ではない。');
 await page.getByRole('button',{name:'照合結果を記録・再送'}).click();
 await expect(page.getByRole('main').getByRole('status')).toHaveText('照合内容を記録しました。');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 await info.attach('actual-axe',{body:JSON.stringify(result),contentType:'application/json'});expect(result.violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`actual-${width}.png`),fullPage:true});
});
