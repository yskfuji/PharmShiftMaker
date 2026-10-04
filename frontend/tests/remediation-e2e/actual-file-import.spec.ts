const API = process.env.PHARMSHIFT_E2E_API_URL ?? 'https://127.0.0.1:18510';
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for(const width of [320,768,1440])test(`actual file preview commit lost response ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.goto('/login');
  await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
  await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
  await page.getByRole('link',{name:'実績',exact:true}).click();
  const section=page.getByRole('region',{name:'実績原本のファイル取込'});
  await expect(section).toBeVisible();
  const response=await page.request.get(`${API}/planning/compliance/workflow-context?scope_id=hospital/pharmacy`);
  expect(response.status()).toBe(200);const ctx=await response.json();
  const actual=ctx.actuals.find((a:any)=>a.external_id==='synthetic-clock');
  const terms=ctx.records.find((r:any)=>r.kind==='work_terms'&&r.entity_id===actual.duty.duty_id)?.payload??{
    duty_id:actual.duty.duty_id,employment_revision_id:ctx.employments.find((e:any)=>e.relationship_id===actual.duty.relationship_id).revision_id,scheduled_work:actual.duty.work};
  const body=JSON.stringify({format:'pharmshift-actuals-v1',events:[{external_id:actual.external_id,revision:actual.revision+1,duty:actual.duty,work_terms:terms}]});
  const invalid=JSON.stringify({format:'pharmshift-actuals-v1',events:[{},{}]});
  await page.getByLabel('実績原本ファイル').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(invalid)});
  await section.getByRole('button',{name:'原本と保存済み実績を照合'}).click();
  await expect(section.getByLabel('実績原本の行別エラー').getByRole('listitem')).toHaveCount(2);
  await expect(section.getByRole('button',{name:'全件の差分を確認して保存・再送'})).toHaveCount(0);
  page.once('dialog',d=>d.accept());
  await page.getByLabel('実績原本ファイル').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(body)});
  await expect(section.getByRole('status')).toContainText('プレビュー');
  page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'休暇',exact:true}).click();await expect(page).toHaveURL(/actuals/);
  await section.getByRole('button',{name:'原本と保存済み実績を照合'}).click();await expect(section.getByLabel('実績取込プレビュー')).toBeVisible();
  const unchanged=await page.request.get(`${API}/planning/compliance/workflow-context?scope_id=hospital/pharmacy`);
  expect((await unchanged.json()).actuals.find((a:any)=>a.external_id===actual.external_id).revision).toBe(actual.revision);
  let first='',attempts=0;
  await page.route('**/actual-import/commit?*',async route=>{attempts++;if(attempts===1){first=route.request().postData()!;const r=await route.fetch();expect(r.status()).toBe(200);await route.abort('failed');}else{expect(route.request().postData()).toBe(first);await route.continue();}});
  await section.getByRole('button',{name:'全件の差分を確認して保存・再送'}).click();await expect(section.getByRole('status')).toContainText('通信断');
  await section.getByRole('button',{name:'全件の差分を確認して保存・再送'}).click();await expect(section.getByRole('status')).toContainText('1件を保存しました');
  expect(attempts).toBe(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
  await info.attach('actual-import-axe',{body:JSON.stringify(axe),contentType:'application/json'});expect(axe.violations).toEqual([]);
  await page.screenshot({path:info.outputPath(`actual-import-${width}.png`),fullPage:true});
});
