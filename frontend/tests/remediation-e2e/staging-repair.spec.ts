import {test,expect} from '@playwright/test';
const API=(process.env.PHARMSHIFT_E2E_API_URL??'https://127.0.0.1:18510');
const local=(s:string)=>new Date(new Date(s).getTime()+9*3600000).toISOString().replace(/:00\.000Z$/,'').replace(/\.000Z$/,'');
for(const width of [320,768,1440])test(`invalid staging remains editable and repairable ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 const before=await page.request.get(`${API}/planning/compliance/workflow-context?scope_id=hospital/pharmacy`);expect(before.status()).toBe(200);const ctx=await before.json(),site=ctx.establishments[0];expect(site).toBeTruthy();
 const agreementId=crypto.randomUUID(),endAfterSite=new Date(Date.parse(site.end)+86400000).toISOString();
 const injected=await page.request.post(`${API}/planning/compliance/records/agreement?scope_id=hospital/pharmacy`,{headers:{Origin:new URL(page.url()).origin},data:{expected_revision:0,idempotency_key:crypto.randomUUID(),payload:{agreement_id:agreementId,employer_id:site.employer_id,establishment_id:site.establishment_id,start:site.start,end:endAfterSite,year_start:local(site.start).slice(0,10),month_anchor:local(site.start).slice(0,10),daily_limit_seconds:0,monthly_limit_seconds:0,annual_limit_seconds:0,special_clause:false,holiday_work_permitted:false,evidence:{reference:`不整合修復の合成原本 ${info.project.name} ${width}`,status:'unverified'}}}});expect(injected.status()).toBe(200);
 const invalid=await page.request.get(`${API}/planning/compliance/workflow-context?scope_id=hospital/pharmacy`);expect(invalid.status()).toBe(200);expect((await invalid.json()).staging_valid).toBe(false);
 await page.getByRole('link',{name:'契約・制度',exact:true}).click();const section=page.getByRole('region',{name:'職員と契約の専用操作'});await expect(section.getByRole('alert',{name:'編集中の契約・制度の不整合'})).toBeVisible();
 await section.getByLabel('登録する業務').selectOption('agreement');await section.getByLabel('編集する対象').selectOption(agreementId);await section.getByLabel('適用終了（日本時間）').fill(local(site.end));
 await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByText(/記録を保存して再取得しました/)).toBeVisible();await expect(section.getByRole('alert',{name:'編集中の契約・制度の不整合'})).toHaveCount(0);
 const after=await page.request.get(`${API}/planning/compliance/workflow-context?scope_id=hospital/pharmacy`);expect(after.status()).toBe(200);const repaired=await after.json();expect(repaired.staging_valid).toBe(true);const row=repaired.records.find((r:any)=>r.kind==='agreement'&&r.entity_id===agreementId);expect(row.revision).toBe(2);expect(Date.parse(row.payload.end)).toBe(Date.parse(site.end));
 await info.attach('staging-repair',{body:JSON.stringify({agreementId,invalidStagingDisplayed:true,repairedRevision:row.revision}),contentType:'application/json'});
 await page.screenshot({path:info.outputPath(`staging-repair-${width}.png`),fullPage:true});
});
