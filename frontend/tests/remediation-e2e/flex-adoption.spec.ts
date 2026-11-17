import {test,expect,type Page,type TestInfo} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
// Facility flextime adoption (user decisions 2026-09-28): off by default; one
// administrator registers after checking the answers, another reviews the impact
// and confirms. Synthetic data only (PHARMSHIFT_E2E_FLEX=1: a second administrator
// and a synthetic site running into the future; no adoption exists at the start).
const anchor=(()=>{const d=new Date(Date.now()+9*3600000);d.setUTCMonth(d.getUTCMonth()+2,1);return d.toISOString().slice(0,10);})();

async function signIn(page:Page,user:string,password:string){
 await page.goto('/login');await page.getByLabel('ユーザーID').fill(user);await page.getByLabel('パスワード').fill(password);
 await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
}
async function check(page:Page,info:TestInfo,name:string,width:number){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name).toBe(true);
 const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 await info.attach(`flex-axe-${name}`,{body:JSON.stringify(result),contentType:'application/json'});expect(result.violations,name).toEqual([]);
 await page.screenshot({path:info.outputPath(`flex-${name}-${width}.png`),fullPage:true});
}

for(const width of [320,768,1440])test(`facility flextime adoption by two administrators ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await signIn(page,'admin','pass-admin');
 await page.getByRole('navigation',{name:'主な画面'}).getByRole('link',{name:'施設設定'}).click();
 await page.waitForURL(u=>u.pathname==='/settings');
 await expect(page.getByText(/採用していません（既定）/)).toBeVisible();
 await expect(page.getByRole('navigation',{name:'主な画面'}).getByRole('link',{name:'施設設定'})).toHaveAttribute('aria-current','page');
 await page.getByRole('button',{name:'フレックスタイム制の採用を登録する'}).click();
 await page.getByRole('button',{name:'入力内容を確認する'}).click();
 await expect(page.getByRole('heading',{name:/入力内容に誤りがあります/})).toBeVisible();
 await expect(page.getByLabel('対象労働者の範囲')).toHaveAttribute('aria-invalid','true');
 await check(page,info,'errors',width);

 await page.getByLabel('事業場').selectOption('site-hospital');
 await page.getByLabel('対象労働者の範囲').fill('薬剤部の常勤の薬剤師（合成）');
 await page.getByLabel('清算期間の起算日（採用の開始日）').fill(anchor);
 await page.getByLabel('採用の最終日（この日を含む）').fill('2028-12-31');
 await page.getByLabel('フレキシブルタイムの開始').fill('07:00');await page.getByLabel('フレキシブルタイムの終了').fill('20:00');
 await page.getByLabel('コアタイムの開始').fill('10:00');await page.getByLabel('コアタイムの終了').fill('15:00');
 for(const group of ['就業規則の規定（始業・終業の時刻を労働者に委ねる定め）','労使協定']){
  const box=page.getByRole('group',{name:group});
  await box.getByLabel('資料名・保管場所').fill('合成原本（評価用）');
  await box.getByLabel('原本との照合').selectOption('verified');
  await box.getByLabel('原本を確認した人').fill('合成人事担当');
 }
 await page.getByLabel('Person 0').check();
 await page.getByRole('button',{name:'入力内容を確認する'}).click();
 await expect(page.getByRole('heading',{name:'採用の登録（2/2：内容の確認）'})).toBeFocused();
 await check(page,info,'check-answers',width);
 await page.getByRole('button',{name:'この内容で登録する（確認待ち）'}).click();
 await expect(page.getByText(/採用を登録しました。別の管理者が影響を確認して確認するまで/)).toBeVisible();
 await expect(page.getByText(/あなたが登録したため、確認は別の管理者が行います/)).toBeVisible();

 await page.getByRole('button',{name:'サインアウト'}).click();await page.waitForURL(u=>u.pathname==='/login');
 await signIn(page,'developer','pass-dev');
 await page.getByRole('navigation',{name:'主な画面'}).getByRole('link',{name:'施設設定'}).click();
 await page.getByRole('button',{name:'確認の前に影響を表示する'}).click();
 await expect(page.getByRole('heading',{name:'確認すると変わること'})).toBeFocused();
 await check(page,info,'impact',width);
 await page.getByRole('button',{name:'内容と影響を確認して採用する'}).click();
 await expect(page.getByText(/採用を確認しました/)).toBeVisible();
 await expect(page.getByText('採用中',{exact:true})).toBeVisible();
 await check(page,info,'confirmed',width);
});
