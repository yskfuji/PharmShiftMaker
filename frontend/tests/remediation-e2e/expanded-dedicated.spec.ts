const API = process.env.PHARMSHIFT_E2E_API_URL ?? 'https://127.0.0.1:18510';
import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Each invocation requires the runner's isolated synthetic DB. UUIDs are created by the UI.
for(const width of [320,768,1440])test(`dedicated employment leave and qualification operations ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');await page.getByRole('link',{name:'契約・制度',exact:true}).click();
 let form=page.getByRole('region',{name:'職員と契約の専用操作'});
 const select=(name:string,value:string)=>form.getByRole('combobox',{name,exact:true}).selectOption(value);
 const fill=(name:string,value:string)=>form.getByLabel(name,{exact:true}).fill(value);
 const dates=async()=>{await fill('適用開始（日本時間）','2026-01-01T00:00');await fill('適用終了（日本時間）','2027-01-01T00:00');};
 const evidence=async(label='原本確認')=>{await fill(label+'の資料名・参照先','隔離合成原本 '+info.project.name+' '+width);await select(label+'の状態','verified');await fill(label+'の確認責任者','synthetic-reviewer');};
 const save=async()=>{await form.getByRole('button',{name:'この内容を保存・再送'}).click();await expect(form.getByText(/記録を保存して再取得しました/)).toBeVisible();return form.getByLabel('編集する対象').inputValue();};
 const personName='合成職員 '+info.project.name+' '+width+' '+crypto.randomUUID();await form.getByLabel('編集する対象').selectOption('new');await fill('職員の氏名',personName);const person=await save();
 const baselineResponse=await page.request.get(`${API}/planning/compliance/workflow-context?scope_id=hospital/pharmacy`);expect(baselineResponse.status()).toBe(200);const baseline=await baselineResponse.json();const primaryEmployer=baseline.contracts[0].employer_id;
 await select('登録する業務','establishment');await select('事業場の雇用主',primaryEmployer);await dates();await evidence();const primarySite=await save();
 await select('登録する業務','employment');await select('対象職員',person);await select('雇用先の事業場',primarySite);await dates();await fill('契約締結順（未確認の場合は空欄）','1');await form.getByLabel('週起算と法定休日を原本照合した').check();await evidence('兼業申告の確認');await save();
 await select('登録する業務','employer');await fill('雇用主の正式名称','合成法人 '+info.project.name+' '+width);await evidence();const employer=await save();expect(employer).not.toBe('new');
 await select('登録する業務','establishment');await select('事業場の雇用主',employer);await dates();await evidence();const site=await save();
 await select('登録する業務','employment');await select('対象職員',person);await select('雇用先の事業場',site);await dates();await fill('契約締結順（未確認の場合は空欄）','2');await form.getByLabel('週起算と法定休日を原本照合した').check();await evidence('兼業申告の確認');await save();
 // Every consent remains separate in the submitted model.
 await select('登録する業務','management_model');await select('対象職員',person);await dates();await select('先契約の雇用主',primaryEmployer);await select('後契約の雇用主',employer);await fill('管理モデルの月起算日','2026-01-01');await evidence('先契約の雇用主の合意');await evidence('後契約の雇用主の合意');await evidence('通知の確認');await save();
 await select('登録する業務','capability');await select('対象職員',person);await dates();await form.getByRole('combobox',{name:'担当業務',exact:true}).selectOption({index:1});await form.getByRole('combobox',{name:'勤務場所',exact:true}).selectOption({index:1});await evidence();await save();
 await select('登録する業務','capability_amendment');const qualification=form.getByRole('combobox',{name:'取消・失効の対象資格',exact:true});const target=await qualification.locator('option').filter({hasText:personName}).getAttribute('value');expect(target).toBeTruthy();await qualification.selectOption(target!);await fill('資格を使用できなくなる日時（日本時間）','2026-01-15T00:00:07');await fill('資格の取消・失効理由','合成失効確認');await evidence();await save();
 await page.getByRole('link',{name:'休暇',exact:true}).click();form=page.getByRole('region',{name:'年休原本の専用操作'});
 await select('登録する業務','leave_policy');await select('対象職員',person);await select('年休を管理する雇用主',employer);await dates();await fill('時間年休上限の年起算日','2026-01-01');await form.getByLabel('時間単位年休を認める協定がある').check();await form.getByLabel('半日単位の取得を認める').check();await evidence();const policy=await save();
 await select('登録する業務','leave_account');await select('対象職員',person);await select('年休を管理する雇用主',employer);await fill('原本の付与日','2026-01-01');await fill('失効日（この日を含まない）','2028-01-01');await fill('原本の付与日数','10');await fill('うち法定付与日数','10');await evidence();const account=await save();
 await select('登録する業務','ledger_recording');await select('記録日時を付す原本',account);await fill('外部人事の原本イベント番号','isolated-'+account);await fill('外部人事の原本改定番号','1');await fill('原本を把握した日時（日本時間）','2026-01-01T00:00:01');await evidence();await save();
 await select('登録する業務','leave_obligation');await select('対象職員',person);await select('年休を管理する雇用主',employer);await fill('管理期間の開始日','2026-01-01');await fill('管理期間の終了日（この日を含まない）','2027-01-01');await form.getByRole('group',{name:'対象判定に用いた付与原本'}).getByRole('checkbox').check();await evidence();await save();
 await select('登録する業務','leave_record');await select('対象の付与原本',account);await select('対象者・雇用主の取得規則',policy);await fill('イベントの効力日','2026-01-20');await fill('対象区間の開始（日本時間）','2026-01-20T09:00');await fill('対象区間の終了（日本時間）','2026-01-20T17:00');await evidence();const reservation=await save();
 await form.getByLabel('編集する対象').selectOption('new');await select('対象の付与原本',account);await select('対象者・雇用主の取得規則',policy);await select('年休イベント','release');await select('解除・取消の元イベント',reservation);await fill('イベントの効力日','2026-01-20');await fill('対象区間の開始（日本時間）','2026-01-20T09:00');await fill('対象区間の終了（日本時間）','2026-01-20T17:00');await evidence();await save();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();await info.attach('expanded-axe',{body:JSON.stringify(axe),contentType:'application/json'});expect(axe.violations).toEqual([]); for(const key of ['account_id','policy_id']){const selected=page.locator(`[data-selected-for="${key}"]`);await expect(selected).toBeVisible();const label=await selected.textContent();expect(label).not.toContain('未選択');expect(await selected.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);}
await page.screenshot({path:info.outputPath(`expanded-${width}.png`),fullPage:true});
});
