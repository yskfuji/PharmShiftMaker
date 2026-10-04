import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

for(const width of [320,768,1440])test(`admin management and monthly grid at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(url=>!url.pathname.startsWith('/login'));
 await page.goto('/planning');await expect(page.getByRole('heading',{name:'契約・年休・記録の管理'})).toBeVisible();
 await expect(page.getByRole('heading',{name:/月間勤務表/})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByText('契約・兼業・年休・実績を登録または訂正',{exact:true}).click();
 await page.getByLabel('操作',{exact:true}).selectOption('person');
 await page.getByLabel('職員ID（必須）',{exact:true}).fill(`visual-${info.project.name}-${width}`);
 await page.getByLabel('氏名（必須）',{exact:true}).fill('長い氏名を持つ合成職員・薬剤部・視覚評価用');
 await expect(page.getByText(/未保存の変更があります/)).toBeVisible();
 await page.getByRole('button',{name:'内容を照合して保存',exact:true}).click();
 await expect(page.getByText('記録しました。計画入力への反映と再確認が必要です。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'未保存の編集を破棄'}).click();
 const analysis=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 await info.attach('axe.json',{body:JSON.stringify(analysis,null,2),contentType:'application/json'});
 expect(analysis.violations).toEqual([]);
 await page.getByLabel('操作',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.locator(':focus')).toHaveCount(1);
 await page.screenshot({path:path.resolve('..',`audit/completion-2026-09-22/${info.project.name}-${width}.png`),fullPage:true});
 // CSS zoom probes are recorded separately from real assistive technology/browser zoom.
 for(const zoom of ['200%','400%']){await page.evaluate(z=>{document.body.style.zoom=z;},zoom);await page.getByRole('heading',{name:'契約・年休・記録の管理'}).scrollIntoViewIfNeeded();await expect(page.getByRole('heading',{name:'契約・年休・記録の管理'})).toBeVisible();await page.screenshot({path:path.resolve('..',`audit/completion-2026-09-22/${info.project.name}-${width}-zoom-${zoom}.png`),fullPage:false});}
});
