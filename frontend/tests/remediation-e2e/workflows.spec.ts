import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const NETWORK_ALERT='サーバーに接続できませんでした。通信を確認して、もう一度お試しください。';

async function login(page:Page,user='admin',password='pass-admin'){
 await page.goto('/login');await page.getByLabel('ユーザーID').fill(user);await page.getByLabel('パスワード').fill(password);
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(url=>url.pathname==='/planning');
 await page.getByRole('link',{name:'休暇',exact:true}).click();
 await expect(page.getByRole('heading',{name:'休暇',exact:true,level:1})).toBeVisible();
}
for(const width of [320,768,1440])test(`V3 ledger and hold workflow ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await login(page);
 await page.getByText('過去時点の年休台帳と訂正履歴を確認',{exact:true}).click();
 await page.getByLabel('対象日',{exact:true}).fill('2026-01-31');await page.getByLabel('記録の締切（日本時間）').fill('2026-02-01T00:00');
 await page.getByRole('button',{name:'指定時点の台帳を照会'}).click();await expect(page.getByRole('list',{name:'過去時点の年休残高'}).locator('[data-account-id="g0"]').getByText('残高 5/1 日、予約 0/1 日',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'個人情報管理',exact:true}).click();
 await page.getByText('コピーの残存・消去予約と法的保全',{exact:true}).click();await page.getByLabel('対象職員',{exact:true}).selectOption('p0');
 await page.getByRole('button',{name:'コピーの消去対象を確認'}).click();await expect(page.getByText(/DBの本人記録残存/)).toBeVisible();
 await expect(page.getByRole('button',{name:'この確認版の消去可能分を実行'})).toBeDisabled();
 await page.getByLabel('判断理由',{exact:true}).fill('隔離試験用の保全・実在職員の情報なし');await page.getByRole('button',{name:'保全判断を記録',exact:true}).click();
 await expect(page.getByText('保全判断を記録しました（版 1）。',{exact:true})).toBeVisible();
 const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 await info.attach('axe',{body:JSON.stringify(accessibility),contentType:'application/json'});expect(accessibility.violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel('対象職員',{exact:true}).focus();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'コピーの消去対象を確認'})).toBeFocused();
 await page.screenshot({path:info.outputPath(`v3-${width}.png`),fullPage:true});
});

test('self declaration and self ledger stay within identity',async({page},info)=>{
 await login(page,'pharmacist','pass-ph');
 await expect(page.getByText('コピーの残存・消去予約と法的保全',{exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'兼業・派遣照合',exact:true}).click();
 await page.getByRole('combobox',{name:'他の雇用主・活動先',exact:true}).selectOption({index:1});await page.getByRole('combobox',{name:'申告する事業場',exact:true}).selectOption({index:1});
 await page.getByLabel('適用開始（日本時間）',{exact:true}).fill('2026-01-01T00:00');await page.getByLabel('適用終了（日本時間）',{exact:true}).fill('2027-01-01T00:00');
 await page.getByLabel('契約・所定時間・所定外時間の照合資料').fill('合成資料。労働区間は未確認。');
 await page.getByRole('button',{name:'申告・訂正を記録',exact:true}).click();await expect(page.getByText('申告を記録しました（版 1、照合待ち）。',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'休暇',exact:true}).click();
 await page.getByText('過去時点の年休台帳と訂正履歴を確認',{exact:true}).click();await page.getByLabel('対象日',{exact:true}).fill('2026-01-31');await page.getByLabel('記録の締切（日本時間）').fill('2026-02-01T00:00');
 await page.getByRole('button',{name:'指定時点の台帳を照会'}).click();await expect(page.getByRole('list',{name:'過去時点の年休残高'}).locator('[data-account-id="g1"]').getByText('残高 5/1 日、予約 0/1 日',{exact:true})).toBeVisible();await expect(page.getByRole('list',{name:'過去時点の年休残高'}).locator('[data-account-id="g0"]')).toHaveCount(0);
});

test('dedicated grant correction preserves historical ledger and handles interrupted response',async({page},info)=>{
 await page.setViewportSize({width:320,height:900});await login(page);
 await page.getByText('人事原本と照合して年休の付与・取得を訂正',{exact:true}).click();
 await page.getByRole('combobox',{name:'訂正する原本',exact:true}).selectOption('g0');
 await page.getByLabel('訂正後の付与日数',{exact:true}).fill('3');
 await page.getByLabel('そのうち法定付与日数',{exact:true}).fill('3');
 await page.getByLabel('訂正を把握した日時（日本時間）').fill('2026-03-01T00:00');
 await page.getByLabel('訂正理由',{exact:true}).fill('合成人事原本の照合結果');
 await page.getByLabel('照合した人事資料の参照').fill('synthetic-hr-'+info.project.name);
 await page.getByLabel('根拠の確認者',{exact:true}).fill('isolated-evaluator');
 await expect(page.getByRole('combobox',{name:'訂正する原本',exact:true})).toBeDisabled();
 let idempotency='';let amendment='';let attempts=0;
 await page.route('**/planning/compliance/grant-amendments?*',async route=>{
  const body=route.request().postDataJSON();attempts++;
  if(attempts===1){idempotency=body.idempotency_key;amendment=body.payload.amendment_id;await route.fetch();await route.abort('failed');}
  else{expect(body.idempotency_key).toBe(idempotency);expect(body.payload.amendment_id).toBe(amendment);await route.continue();}
 });
 await page.getByRole('button',{name:'原本を保持して訂正を記録',exact:true}).click();
 await expect(page.getByText('未保存の訂正があります。',{exact:true})).toBeVisible();
 await expect(page.getByRole('alert').filter({hasText:NETWORK_ALERT})).toHaveText(NETWORK_ALERT);
 await page.getByRole('button',{name:'原本を保持して訂正を記録',exact:true}).click();
 await expect(page.getByText('訂正を記録しました。過去時点の台帳で訂正前後を確認してください。',{exact:true})).toBeVisible();
 expect(attempts).toBe(2);
 await page.getByText('過去時点の年休台帳と訂正履歴を確認',{exact:true}).click();
 await page.getByLabel('対象日',{exact:true}).fill('2026-01-31');
 await page.getByLabel('記録の締切（日本時間）').fill('2026-02-01T00:00');
 await page.getByRole('button',{name:'指定時点の台帳を照会'}).click();
 await expect(page.getByRole('list',{name:'過去時点の年休残高'}).locator('[data-account-id="g0"]').getByText('残高 5/1 日、予約 0/1 日',{exact:true})).toBeVisible();
 await page.getByLabel('記録の締切（日本時間）').fill('2026-03-02T00:00');
 await page.getByRole('button',{name:'指定時点の台帳を照会'}).click();
 await expect(page.getByRole('list',{name:'過去時点の年休残高'}).locator('[data-account-id="g0"]').getByText('残高 3/1 日、予約 0/1 日',{exact:true})).toBeVisible();
 const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 expect(accessibility.violations).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await info.attach('axe-correction',{body:JSON.stringify(accessibility),contentType:'application/json'});
 await page.screenshot({path:info.outputPath('grant-correction-response-retry.png'),fullPage:true});
});
