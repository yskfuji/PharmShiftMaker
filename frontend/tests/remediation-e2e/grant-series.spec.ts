import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for(const width of [320,768,1440])test(`complete HR grant series ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(url=>url.pathname==='/planning');
 await page.getByRole('link',{name:'休暇',exact:true}).click();
 await page.getByText('人事原本から通常・比例付与を照合',{exact:true}).click();
 await page.getByRole('button',{name:'最新の付与原本を読み込む'}).click();
 await page.getByRole('combobox',{name:'照合する付与ロット',exact:true}).selectOption('split-first');
 await page.getByLabel('人事が確認した付与基準日').fill('2026-01-02');
 await page.getByLabel('系列全体の人事原本参照').fill('synthetic HR series register');
 await page.getByRole('checkbox',{name:'表示された系列に未取込・未確認の付与がないことを原本と照合しました'}).check();
 await page.getByLabel('確認済み勤続月数').fill('6');await page.getByLabel('週の所定労働時間',{exact:true}).fill('20');
 await page.getByLabel('週の所定労働日数',{exact:true}).fill('4');
 await page.getByLabel('出勤率の分子（人事確認済み日数）').fill('80');await page.getByLabel('出勤率の分母（人事確認済み日数）').fill('100');
 await page.getByLabel('付与照合の原本参照').fill('synthetic HR original');await page.getByLabel('付与照合の確認者').fill('isolated reviewer');
 await page.getByRole('button',{name:'通常・比例付与を照合して記録'}).click();
 await expect(page.getByText('表による法定付与：7日／原本：7日',{exact:true})).toBeVisible();
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 expect(axe.violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`grant-series-${width}.png`),fullPage:true});
});

// Reproduce the original pointer-down/up race with an explicitly held sibling
// context response, not a sleep or a retry of the summary click.
test('grant action remains stable while adjacent candidates finish loading',async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(url=>url.pathname==='/planning');
 let release!:()=>Promise<void>;let captured!:()=>void;const ready=new Promise<void>(resolve=>{captured=resolve;});
 await page.route('**/planning/compliance/workflow-context?*',async route=>{
  const response=await route.fetch();release=async()=>{await route.fulfill({response});};captured();
 });
 await page.getByRole('link',{name:'休暇',exact:true}).click();await ready;
 const summary=page.getByText('人事原本から通常・比例付与を照合',{exact:true});await expect(summary).toBeVisible();
 await summary.scrollIntoViewIfNeeded();const before=await summary.boundingBox();expect(before).not.toBeNull();
 await page.mouse.move(before!.x+before!.width/2,before!.y+before!.height/2);await page.mouse.down();
 await release();await expect(page.getByRole('combobox',{name:'登録する業務',exact:true})).toBeVisible();
 const after=await summary.boundingBox();await page.mouse.up();
 await info.attach('grant-summary-layout',{body:JSON.stringify({before,after}),contentType:'application/json'});
 expect(after).toEqual(before);
 await expect(page.getByRole('button',{name:'最新の付与原本を読み込む'})).toBeVisible();
 await page.getByRole('button',{name:'最新の付与原本を読み込む'}).click();
 await expect(page.getByRole('combobox',{name:'照合する付与ロット',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('grant-stable-1440.png'),fullPage:true});
});
