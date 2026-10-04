import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for(const width of [320,768,1440])test(`registered publication download interrupted response ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');
 await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 const summary=page.locator('summary').filter({hasText:'公開版 1'});await expect(summary).toBeVisible();await summary.click();
 const region=page.getByRole('region',{name:'公開版の登録済み出力'});await expect(region).toBeVisible();
 let sent='',transfer='',attempts=0;
 await page.route('**/planning/artifacts/*/download?*',async route=>{
  attempts++;
  if(attempts===1){sent=route.request().postData()!;const r=await route.fetch();expect(r.status()).toBe(200);transfer=r.headers()['x-transfer-id'];await route.abort('failed');}
  else{expect(route.request().postData()).toBe(sent);const r=await route.fetch();expect(r.headers()['x-transfer-id']).toBe(transfer);await route.fulfill({response:r});}
 });
 await region.getByRole('button',{name:'この公開版を出力'}).click();await expect(region.getByRole('status')).toContainText('通信断');
 const [download]=await Promise.all([page.waitForEvent('download'),region.getByRole('button',{name:'この公開版を出力'}).click()]);
 await expect(region.getByRole('status')).toContainText(transfer);expect(attempts).toBe(2);
 await download.saveAs(info.outputPath('registered-publication.json'));
 await page.unroute('**/planning/artifacts/*/download?*');
 await region.getByLabel('出力形式').selectOption('csv');
 const [csv]=await Promise.all([page.waitForEvent('download'),region.getByRole('button',{name:'この公開版を出力'}).click()]);
 await csv.saveAs(info.outputPath('registered-publication.csv'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(axe.violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`publication-artifact-${width}.png`),fullPage:true});
});
