import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import {allOptical,textContrast,textSpacing} from '../visual/lib/optical';
import {settle} from '../visual/lib/audit';
const LEGACY_YEAR=2026,LEGACY_MONTH=9;

// Legacy records deliberately use their existing API, not the planning ledger.
// Seed an old record through the API; exercise editing/deletion through the UI.
for(const user of ['admin','developer'])for(const width of [320,768,1440])
test(`${user}: legacy quota update delete and department boundary ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');
 await page.getByLabel('ユーザーID').fill(user);await page.getByLabel('パスワード').fill(user==='admin'?'pass-admin':'pass-dev');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 const api=process.env.PHARMSHIFT_E2E_API_URL??'https://127.0.0.1:18510';
 const year=LEGACY_YEAR,month=LEGACY_MONTH;
 const person='synthetic-legacy-'+user+'-'+randomUUID();
 const seeded=await page.evaluate(async({api,person,year,month})=>{
  const headers={'Content-Type':'application/json'};
  const staff=await fetch(api+'/staff/',{method:'POST',credentials:'include',headers,body:JSON.stringify({person_id:person,name:'合成・旧枠確認',role:'PHARMACIST',timeline:[]})});
  const quota=await fetch(`${api}/leave-quotas/${year}/${person}/PAID_LEAVE_REQUEST?month=${month}`,{method:'PUT',credentials:'include',headers,body:JSON.stringify({total_days:5})});
  return [staff.status,quota.status];
 },{api,person,year,month});
 expect(seeded).toEqual([201,200]);
 await page.goto('/requests');await expect(page.getByRole('heading',{name:'旧休暇枠',exact:true})).toBeVisible();
 const row=page.getByRole('row').filter({hasText:person});
 await expect(row).toContainText('5 日');
 await row.getByRole('button',{name:'編集',exact:true}).click();
 await row.getByRole('spinbutton',{name:'旧休暇枠の年間日数',exact:true}).fill('7');
 await settle(page);
 const a11y=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 await info.attach('legacy-editor-axe',{body:JSON.stringify(a11y),contentType:'application/json'});expect(a11y.violations).toEqual([]);
 await row.getByRole('button',{name:'保存',exact:true}).click();
 await expect(row.getByRole('spinbutton')).toHaveCount(0);await expect(row).toContainText('7 日');
 await page.reload();await expect(page.getByRole('row').filter({hasText:person})).toContainText('7 日');
 const badge=page.getByRole('row').filter({hasText:person}).locator('td').nth(1).locator('span').first();
 const badgeBounds=await badge.boundingBox();expect(badgeBounds).not.toBeNull();
 // Product readability criterion, not a WCAG numeric requirement: the short
 // kind label must not collapse into a one-character vertical column.
 expect(badgeBounds!.height).toBeLessThanOrEqual(48);
 const remainingBounds=await page.getByRole('row').filter({hasText:person}).locator('td').nth(4).locator('div').first().boundingBox();
 expect(remainingBounds).not.toBeNull();expect(remainingBounds!.height).toBeLessThanOrEqual(48);
 const region=page.getByRole('region',{name:'旧休暇枠の比較表'});
 await region.focus();await expect(region).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 for(const theme of ['light','dark','system-light','system-dark']){
  await page.emulateMedia({colorScheme:theme.endsWith('dark')?'dark':'light'});
  await page.getByRole('combobox',{name:'配色',exact:true}).selectOption(theme.startsWith('system-')?'system':theme);
  await expect.poll(()=>page.locator('html').getAttribute('data-theme')).toBe(theme.startsWith('system-')?null:theme);
  expect(await page.evaluate(()=>matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme.endsWith('dark'));
  await settle(page);
  await region.evaluate(el=>{el.scrollLeft=0;});
  await page.screenshot({path:info.outputPath(`legacy-populated-${user}-${theme}-${width}.png`),fullPage:true});
  const leftContrast=await textContrast(page);
  await region.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  await page.screenshot({path:info.outputPath(`legacy-populated-${user}-${theme}-${width}-right.png`),fullPage:true});
  const rightContrast=await textContrast(page);
  await region.evaluate(el=>{el.scrollLeft=0;});
  const optical=await allOptical(page,width);
  const spacing=await textSpacing(page);
  await info.attach(`legacy-optical-${theme}`,{body:JSON.stringify({leftContrast,rightContrast,optical,spacing}),contentType:'application/json'});
  expect(leftContrast.findings).toEqual([]);expect(leftContrast.skipped).toEqual([]);
  expect(rightContrast.findings).toEqual([]);expect(rightContrast.skipped).toEqual([]);
  expect(optical.findings).toEqual([]);expect(optical.skipped).toEqual([]);
  expect(spacing.findings).toEqual([]);expect(spacing.skipped).toEqual([]);
 }

 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('row').filter({hasText:person}).getByRole('button',{name:'削除',exact:true}).click();
 await expect(page.getByRole('row').filter({hasText:person})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('row').filter({hasText:person})).toHaveCount(0);
 const remaining=await page.request.get(`${api}/leave-quotas/?year=${year}&month=${month}`);
 expect(remaining.status()).toBe(200);
 expect((await remaining.json()).items.some((item:{person_id:string})=>item.person_id===person)).toBe(false);
 if(user==='developer'){
  // Global developer access to this compatibility API does not grant membership.
  await page.goto('/planning/workflows/contracts?scope=hospital%2Fpharmacy');
  await expect(page.getByRole('region',{name:'職員と契約の専用操作'})).toHaveCount(0);
  const response=await page.request.get(api+'/planning/compliance/records?scope_id=hospital%2Fpharmacy');
  expect(response.status()).toBe(403);
 }
});
