import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
for(const width of [320,768,1440])test(`retained control policy edit and automatic revision ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 await page.getByRole('link',{name:'個人情報管理',exact:true}).click();
 await page.getByText('保存規則の確認・改定',{exact:true}).click();
 await page.getByLabel('対象データ種別',{exact:true}).selectOption('control');
 // The start point selects the retention chain and is locked once editing begins.
 await page.getByLabel('保存期間の起算',{exact:true}).selectOption('last_activity');
 await page.getByLabel('利用目的',{exact:true}).fill('再作成防止制御の保存・利用制限の評価');
 await page.getByLabel('保存日数',{exact:true}).fill('365');await page.getByLabel('根拠を確認した法定最低保存日数',{exact:true}).fill('0');
 await page.getByLabel('適用開始日',{exact:true}).fill('2030-01-01');await page.getByLabel('適用終了日（この日を含まない）',{exact:true}).fill('2031-01-01');
 await page.getByLabel('更新担当者',{exact:true}).fill('synthetic-officer');await page.getByLabel('次回確認日',{exact:true}).fill('2030-12-01');
 await page.getByLabel('保存根拠・条項',{exact:true}).fill('合成規則。施設の承認済み規則ではない');
 await expect(page.getByLabel('対象データ種別',{exact:true})).toBeDisabled();
 const submit=page.getByRole('button',{name:'保存規則の改定を記録',exact:true});await submit.click();
 await expect(page.getByText('判断と履歴を記録しました。',{exact:true})).toBeVisible();
 // Unchecked confirmation must persist as unverified, never auto-certify a rule.
 const rules=await page.evaluate(async api=>{const r=await fetch(api+'/planning/compliance/privacy?scope_id=hospital%2Fpharmacy',{credentials:'include'});return r.json();},process.env.PHARMSHIFT_E2E_API_URL??'https://127.0.0.1:18510');
 const latest=rules.rules.filter((r:any)=>r.payload.category==='control').sort((a:any,b:any)=>b.revision-a.revision)[0];expect(latest.payload.evidence.status).toBe('unverified');
 await expect(page.getByText(`取得した現在版：${latest.revision}`,{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();expect(axe.violations).toEqual([]);
 await info.attach('axe-governance',{body:JSON.stringify(axe),contentType:'application/json'});await page.screenshot({path:info.outputPath(`control-policy-${width}.png`),fullPage:true});
});
