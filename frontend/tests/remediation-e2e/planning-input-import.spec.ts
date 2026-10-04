import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const API=(process.env.PHARMSHIFT_E2E_API_URL??'https://127.0.0.1:18510')+'/planning';
const QUERY='?scope_id=hospital%2Fpharmacy';

for(const width of [320,768,1440])test(`planning input file is previewed and registered only on confirmation ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 const latest=await page.evaluate(async([api,query])=>{const r=await fetch(api+'/inputs/latest'+query,{credentials:'include'});return r.json();},[API,QUERY]);
 const picker=page.getByLabel(/登録ファイルを取り込む/);await expect(picker).toBeEnabled();
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/planning/inputs'))posts.push(r.url());});
 // A file for another department: previewed, refused, nothing sent.
 const other={...latest.snapshot,department_id:'other',source_revision:latest.snapshot.source_revision+1};
 await picker.setInputFiles({name:'other.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(other))});
 const preview=page.getByRole('region',{name:'取込ファイルの確認'});
 await expect(preview).toContainText('ファイルの施設・部署：hospital/other／選択中：hospital/pharmacy');
 await expect(preview.getByRole('alert')).toContainText('選択中の部署と異なるため、登録できません');
 await expect(preview.getByRole('button',{name:'この内容で登録する'})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();await info.attach('planning-input-import-axe',{body:JSON.stringify(axe),contentType:'application/json'});expect(axe.violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`planning-input-import-${width}.png`),fullPage:true});
 await preview.getByRole('button',{name:'取込を取り消す'}).click();await expect(preview).toBeHidden();
 expect(posts).toEqual([]);
 // A file for this department: registered only after the explicit confirmation.
 const same={...latest.snapshot,source_revision:latest.snapshot.source_revision+1};
 await picker.setInputFiles({name:'same.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(same))});
 await expect(preview).toContainText('比較した入力：');expect(posts).toEqual([]);
 await preview.getByRole('button',{name:'この内容で登録する'}).click();
 await expect(page.getByText('入力を登録しました。根拠の確認状態を確認してください。')).toBeVisible();
 expect(posts).toHaveLength(1);expect(posts[0]).toContain('scope_id=hospital%2Fpharmacy');
});

test('untracked history with unsaved work keeps the page and explains it',async({page})=>{
 await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');
 const reason=page.getByLabel('公開取消の理由・勤務変更の調整記録');await reason.fill('未保存の取消理由');
 // A traversal to an entry the guard cannot place (no position stamp).
 await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate',{state:null})));
 await expect(page.getByRole('alert').filter({hasText:'この履歴の移動を画面に反映していません'})).toBeVisible();
 await expect(reason).toHaveValue('未保存の取消理由');
 await page.getByRole('button',{name:'この画面で続ける'}).click();
 await expect(page.getByRole('alert').filter({hasText:'この履歴の移動を画面に反映していません'})).toBeHidden();
});
