const API = process.env.PHARMSHIFT_E2E_API_URL ?? 'https://127.0.0.1:18510';
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Uses the isolated API, real version checks and a real lost response after commit.
for(const width of [320,768,1440])test(`dedicated contract forms conflict retry ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');
 await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 await page.getByRole('link',{name:'契約・制度',exact:true}).click();
 const section=page.getByRole('region',{name:'職員と契約の専用操作'});
 await expect(section.getByLabel('編集する対象')).toBeVisible();
 const contextResponse=await page.request.get(`${API}/planning/compliance/workflow-context?scope_id=hospital/pharmacy`);expect(contextResponse.status()).toBe(200);const context=await contextResponse.json();
 const person=context.people[0],record=context.records.find((r:any)=>r.kind==='person'&&r.entity_id===person.person_id),version=record?.revision??0;
 await section.getByLabel('編集する対象').selectOption(person.person_id);await section.getByLabel('職員の氏名').fill(`編集内容 ${info.project.name} ${width}`);
 // Cancel an actual link navigation with unsaved changes.
 page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'休暇',exact:true}).click();await expect(page).toHaveURL(/contracts/);
 const concurrent=await page.request.post(`${API}/planning/compliance/records/person?scope_id=hospital/pharmacy`,{headers:{Origin:new URL(page.url()).origin},data:{expected_revision:version,idempotency_key:crypto.randomUUID(),payload:{person_id:person.person_id,name:`別管理者 ${info.project.name} ${width}`}}});expect(concurrent.status()).toBe(200);
 await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByText('競合した内容の確認')).toBeVisible();await expect(section.getByRole('button',{name:'この内容を保存・再送'})).toBeDisabled();
 await section.getByRole('button',{name:'三つの内容を確認し、編集中の内容を保持'}).click();
 let first='',attempts=0;
 await page.route('**/compliance/records/person?*',async route=>{attempts++;if(attempts===1){first=route.request().postData()!;const result=await route.fetch();expect(result.status()).toBe(200);await route.abort('failed');}else{expect(route.request().postData()).toBe(first);await route.continue();}});
 await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByRole('alert')).toContainText('通信が途切れた場合');await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByText(/記録を保存して再取得しました/)).toBeVisible();expect(attempts).toBe(2);await page.unroute('**/compliance/records/person?*');
 // Edit an existing contract with its current revision; no ID/version typing.
 await section.getByLabel('登録する業務').selectOption('contract');
 await section.getByLabel('編集する対象').selectOption(context.contracts.find((c:any)=>c.person_id===person.person_id).revision_id);
 await section.getByLabel('最大連続勤務日数').fill('5');await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByText(/記録を保存して再取得しました/)).toBeVisible();
 // Qualification selects the person and approved task/location candidates.
 await section.getByLabel('登録する業務').selectOption('capability');await section.getByLabel('対象職員').selectOption(person.person_id);
 await section.getByLabel('適用開始（日本時間）').fill('2026-09-01T00:00:01');await expect(section.getByLabel('適用開始（日本時間）')).toHaveValue('2026-09-01T00:00:01');
 const candidate=context.duty_options[0];expect(candidate).toBeTruthy();await section.getByRole('combobox', {name:'担当業務',exact:true}).selectOption(candidate.task);await section.getByRole('combobox', {name:'勤務場所',exact:true}).selectOption(candidate.location);
 await section.getByLabel('適用開始（日本時間）').fill('2026-09-01T00:00');await section.getByLabel('適用終了（日本時間）').fill('2026-10-01T00:00');await section.getByLabel('原本確認の資料名・参照先').fill(`合成資格 ${info.project.name} ${width}`);
 await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByText(/記録を保存して再取得しました/)).toBeVisible();
 // New establishment uses the existing employer candidate and generated identity.
 await section.getByLabel('登録する業務').selectOption('establishment');await section.getByLabel('事業場の雇用主').selectOption(context.contracts[0].employer_id);
 await section.getByLabel('適用開始（日本時間）').fill('2026-09-01T00:00');await section.getByLabel('適用終了（日本時間）').fill('2026-10-01T00:00');await section.getByLabel('原本確認の資料名・参照先').fill(`合成事業場 ${info.project.name} ${width}`);
 await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByText(/記録を保存して再取得しました/)).toBeVisible();
 const createdSiteId=await section.getByLabel('編集する対象').inputValue();expect(createdSiteId).not.toBe('new');
 // Agreement and rule review use the same versioned edit session.
 await section.getByLabel('登録する業務').selectOption('agreement');await section.getByLabel('協定を適用する事業場').selectOption(createdSiteId);
 await section.getByLabel('適用開始（日本時間）').fill('2026-09-01T00:00');await section.getByLabel('適用終了（日本時間）').fill('2026-10-01T00:00');await section.getByLabel('協定年の起算日').fill('2026-04-01');await section.getByLabel('協定月の起算日').fill('2026-09-16');await section.getByLabel('原本確認の資料名・参照先').fill(`合成協定 ${info.project.name} ${width}`);
 await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByText(/記録を保存して再取得しました/)).toBeVisible();
 await section.getByLabel('登録する業務').selectOption('rule_review');await section.getByLabel('適用を確認する規則版').selectOption(context.rule_revision);
 await section.getByLabel('適用開始（日本時間）').fill('2026-09-01T00:00');await section.getByLabel('適用終了（日本時間）').fill('2026-10-01T00:00');await section.getByLabel('一次資料のURL').fill('https://www.mhlw.go.jp/');await section.getByLabel('資料の版（改正日など）').fill('合成資料 第1版');await section.getByLabel('取得した資料のSHA-256（16進64桁）').fill('a'.repeat(64));await section.getByLabel('照合した条項').fill('合成検証用条項');await section.getByLabel('経過措置・非該当の理由').fill('合成ケース：未確認');await section.getByLabel('今回の確認日').fill('2026-09-01');await section.getByLabel('次回の確認期限').fill('2026-10-01');await section.getByLabel('原本確認の資料名・参照先').fill(`合成規則 ${info.project.name} ${width}`);
 await section.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(section.getByText(/記録を保存して再取得しました/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();await info.attach('contract-workflow-axe',{body:JSON.stringify(axe),contentType:'application/json'});expect(axe.violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`contract-workflow-${width}.png`),fullPage:true});
});
