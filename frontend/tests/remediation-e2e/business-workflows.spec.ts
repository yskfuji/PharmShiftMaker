import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for(const width of [320,768,1440])test(`administrator reconciles a staff declaration and result survives reload ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');
 await page.getByLabel('ユーザーID').fill('pharmacist');await page.getByLabel('パスワード').fill('pass-ph');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 await page.getByRole('link',{name:'兼業・派遣照合',exact:true}).click();
 await page.getByRole('combobox',{name:'他の雇用主・活動先',exact:true}).selectOption({index:1});
 await page.getByRole('combobox',{name:'申告する事業場',exact:true}).selectOption({index:1});
 await page.getByLabel('適用開始（日本時間）',{exact:true}).fill('2026-01-01T00:00');
 await page.getByLabel('適用終了（日本時間）',{exact:true}).fill('2027-01-01T00:00');
 await page.getByLabel('所定労働の開始 1',{exact:true}).fill('2026-01-06T09:00');
 await page.getByLabel('所定労働の終了 1',{exact:true}).fill('2026-01-06T12:00');
 await page.getByRole('checkbox',{name:'この期間の労働区間をすべて記載した',exact:true}).check();
 await page.getByLabel('契約・所定時間・所定外時間の照合資料').fill('合成の申告原本');
 await page.getByRole('button',{name:'申告・訂正を記録',exact:true}).click();
 await expect(page.getByText('申告を記録しました（版 1、照合待ち）。',{exact:true})).toBeVisible();
 const declaration=await page.getByLabel('訂正・取下げする申告').inputValue();
 await page.getByRole('button',{name:'サインアウト',exact:true}).click();
 await page.waitForURL(u=>u.pathname==='/login');await page.goto('/login');
 await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 await page.getByRole('link',{name:'兼業・派遣照合',exact:true}).click();
 await page.getByLabel('訂正・取下げする申告').selectOption(declaration);
 await expect(page.getByRole('heading',{name:'管理者による他社資料との照合判断',exact:true})).toBeVisible();
 await page.getByLabel('照合根拠',{exact:true}).fill('合成管理者が原本と照合。施設の実証拠ではない。');
 await page.getByRole('button',{name:'照合判断を記録',exact:true}).click();
 await expect(page.getByText('申告を記録しました（版 2、確認済み）。',{exact:true})).toBeVisible();
 await page.reload();await page.getByLabel('訂正・取下げする申告').selectOption(declaration);
 await expect(page.getByRole('region',{name:'他社勤務の照合用集計'})).toContainText('照合担当者：admin');
 const api=process.env.PHARMSHIFT_E2E_API_URL??'https://127.0.0.1:18510';
 const response=await page.request.get(api+'/planning/compliance/records?scope_id=hospital%2Fpharmacy');
 expect(response.status()).toBe(200);
 const record=(await response.json()).find((r:{entity_id:string})=>r.entity_id===declaration);
 expect(record.revision).toBe(2);expect(record.payload.status).toBe('REVIEWED');
 expect(record.payload.person_id).toBe('p1');expect(record.payload.review_evidence.verified_by).toBe('admin');
 await page.screenshot({path:info.outputPath(`outside-reviewed-${width}.png`),fullPage:true});
});

for(const width of [320,768,1440])test(`self declaration retry withdrawal and role boundary ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');
 await page.getByLabel('ユーザーID').fill('pharmacist');await page.getByLabel('パスワード').fill('pass-ph');
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 await page.getByRole('link',{name:'兼業・派遣照合',exact:true}).click();
 await expect(page.getByLabel('訂正・取下げする申告')).toBeVisible();
 await page.getByRole('combobox',{name:'他の雇用主・活動先',exact:true}).selectOption({index:1});await page.getByRole('combobox',{name:'申告する事業場',exact:true}).selectOption({index:1});
 await page.getByLabel('適用開始（日本時間）',{exact:true}).fill('2026-01-01T00:00');await page.getByLabel('適用終了（日本時間）',{exact:true}).fill('2027-01-01T00:00');
 await page.getByLabel('所定労働の開始 1',{exact:true}).fill('2026-01-06T09:00');
 await page.getByLabel('所定労働の終了 1',{exact:true}).fill('2026-01-06T12:00');
 await page.getByLabel('契約・所定時間・所定外時間の照合資料').fill('合成の照合資料。未確認。');
 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('link',{name:'休暇',exact:true}).click();
 await expect(page).toHaveURL(/workflows\/outside/);await expect(page.getByRole('combobox',{name:'他の雇用主・活動先',exact:true})).not.toHaveValue('');
 let attempts=0;let first='';
 await page.route('**/planning/compliance/outside-declarations?*',async route=>{
  attempts++;if(attempts===1){first=route.request().postData()!;await route.fetch();await route.abort('failed');}
  else {if(attempts===2)expect(route.request().postData()).toBe(first);await route.continue();}
 });
 await page.getByRole('button',{name:'申告・訂正を記録',exact:true}).click();
 await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
 await page.getByRole('button',{name:'申告・訂正を記録',exact:true}).click();
 await expect(page.getByText('申告を記録しました（版 1、照合待ち）。',{exact:true})).toBeVisible();
 await expect(page.getByLabel('所定労働の開始 1',{exact:true})).toHaveValue('2026-01-06T09:00');
 await page.getByRole('button',{name:'この申告を取り下げる',exact:true}).click();
 await expect(page.getByText('申告を記録しました（版 2、取下げ済み）。',{exact:true})).toBeVisible();
 const geometry=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,inputs:Array.from(document.querySelectorAll('input[type="datetime-local"], input[name="order"]')).map(el=>{const rect=el.getBoundingClientRect();return {name:(el as HTMLInputElement).name,left:rect.left,right:rect.right,width:rect.width};})}));
 await info.attach('outside-input-geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
 expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
 for(const input of geometry.inputs){expect(input.left).toBeGreaterThanOrEqual(0);expect(input.right).toBeLessThanOrEqual(geometry.viewport);}
 await expect(page.locator('[data-current-for="scheduledStart0"]')).toHaveText('現在値：2026-01-06 09:00:00（日本時間）');
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 await info.attach('axe-outside',{body:JSON.stringify(result),contentType:'application/json'});expect(result.violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`outside-${width}.png`),fullPage:true});
 await expect(page.getByRole('link',{name:'契約・制度',exact:true})).toHaveCount(0);
 await page.goto('/planning/workflows/contracts?scope=hospital%2Fpharmacy');await expect(page.getByRole('main').getByRole('alert')).toHaveText('この業務を操作する権限がありません。');
 await expect(page.getByRole('region',{name:'職員と契約の専用操作'})).toHaveCount(0);
});

test('declaration conflict requires three-way review before retry',async({page},info)=>{
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('pharmacist');await page.getByLabel('パスワード').fill('pass-ph');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 await page.getByRole('link',{name:'兼業・派遣照合',exact:true}).click();
 await page.getByRole('combobox',{name:'他の雇用主・活動先',exact:true}).selectOption({index:1});await page.getByRole('combobox',{name:'申告する事業場',exact:true}).selectOption({index:1});
 await page.getByLabel('適用開始（日本時間）',{exact:true}).fill('2026-01-01T00:00');await page.getByLabel('適用終了（日本時間）',{exact:true}).fill('2027-01-01T00:00');
 await page.getByLabel('契約・所定時間・所定外時間の照合資料').fill('編集開始時の合成資料');
 await page.getByRole('button',{name:'申告・訂正を記録',exact:true}).click();await expect(page.getByText('申告を記録しました（版 1、照合待ち）。',{exact:true})).toBeVisible();
 await page.getByLabel('契約・所定時間・所定外時間の照合資料').fill('編集中の合成資料');
 const identity=await page.getByLabel('訂正・取下げする申告').inputValue();
 const concurrent=await page.evaluate(async ({id,api})=>{
  const base=api+'/planning/compliance',query='?scope_id=hospital%2Fpharmacy';
  const response=await fetch(base+'/records'+query,{credentials:'include'});
  const rows=await response.json();const row=rows.find((r:{entity_id:string})=>r.entity_id===id);
  const changed=await fetch(base+'/outside-declarations'+query,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_revision:row.revision,idempotency_key:crypto.randomUUID(),payload:{...row.payload,reference:'別操作で更新した合成資料'}})});
  return changed.status;
 },{id:identity,api:process.env.PHARMSHIFT_E2E_API_URL??'https://127.0.0.1:18510'});
 expect(concurrent).toBe(200);
 await page.getByRole('button',{name:'申告・訂正を記録',exact:true}).click();await expect(page.getByRole('heading',{name:'競合した内容の比較'})).toBeVisible();
 // Per-field three-way table: the changed field shows start, current and edited values.
 const reference=page.getByRole('row').filter({has:page.getByRole('rowheader',{name:/^申告の参照/})});
 await expect(reference.getByRole('cell')).toHaveText(['編集開始時の合成資料','別操作で更新した合成資料','編集中の合成資料']);
 await expect(page.getByRole('button',{name:'申告・訂正を記録',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'差分を確認して編集中の内容を適用'}).click();await expect(page.getByText('申告を記録しました（版 3、照合待ち）。',{exact:true})).toBeVisible();
});
