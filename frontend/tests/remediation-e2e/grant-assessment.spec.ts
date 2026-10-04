import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const NETWORK_ALERT='サーバーに接続できませんでした。通信を確認して、もう一度お試しください。';
for(const width of [320,768,1440])test(`dedicated proportional grant assessment ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(url=>url.pathname==='/planning');
 await page.getByRole('link',{name:'休暇',exact:true}).click();
 await page.getByText('人事原本から通常・比例付与を照合',{exact:true}).click();
 await page.getByRole('button',{name:'最新の付与原本を読み込む'}).click();
 await page.getByRole('combobox',{name:'照合する付与ロット',exact:true}).selectOption('g1');
 await page.getByLabel('確認済み勤続月数').fill('6');await page.getByLabel('週の所定労働時間',{exact:true}).fill('20');
 await page.getByLabel('週の所定労働時間の端数（分）',{exact:true}).fill('1');
 await page.getByLabel('週の所定労働時間の端数（秒）',{exact:true}).fill('1');
 await page.getByLabel('週の所定労働日数',{exact:true}).fill('3');
 await page.getByLabel('出勤率の分子（人事確認済み日数）').fill('80');await page.getByLabel('出勤率の分母（人事確認済み日数）').fill('100');
 await page.getByLabel('付与照合の原本参照').fill('synthetic HR table');await page.getByLabel('付与照合の確認者').fill('isolated evaluator');
 await expect(page.getByRole('button',{name:'最新の付与原本を読み込む'})).toBeDisabled();
 let requestBody='';let attempts=0;
 await page.route('**/planning/compliance/grant-assessments?*',async route=>{
  attempts++;
  if(attempts===1){requestBody=route.request().postData()!;expect(JSON.parse(requestBody).payload.scheduled_week_seconds).toBe(72061);await route.fetch();await route.abort('failed');}
  else{expect(route.request().postData()).toBe(requestBody);await route.continue();}
 });
 const submit=page.getByRole('button',{name:'通常・比例付与を照合して記録'});
 await submit.click();await expect(page.getByRole('alert').filter({hasText:NETWORK_ALERT})).toHaveText(NETWORK_ALERT);
 await submit.click();await expect(page.getByText('照合一致',{exact:true})).toBeVisible();
 await expect(page.getByText('表による法定付与：5日／原本：5日',{exact:true})).toBeVisible();expect(attempts).toBe(2);
 await page.getByLabel('付与照合の確認者').focus();await page.keyboard.press('Tab');await expect(submit).toBeFocused();
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 expect(axe.violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await info.attach('axe-assessment',{body:JSON.stringify(axe),contentType:'application/json'});
 await page.screenshot({path:info.outputPath(`grant-assessment-${width}.png`),fullPage:true});
});
