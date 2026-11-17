import {test,expect,Page} from '@playwright/test';
async function traverse(page:Page,direction:'back'|'forward',accept:boolean){const dialog=page.waitForEvent('dialog');await page.evaluate(direction=>history[direction](),direction);const prompt=await dialog;if(accept)await prompt.accept();else await prompt.dismiss();}

for(const width of [320,768,1440])test(`unsaved tracked history back forward ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');await page.getByLabel('パスワード').fill('pass-admin');await page.getByRole('button',{name:'サインイン',exact:true}).click();await page.waitForURL(u=>u.pathname==='/planning');await page.getByRole('link',{name:'契約・制度',exact:true}).click();
 const form=page.getByRole('region',{name:'職員と契約の専用操作'});await expect(form.getByLabel('編集する対象')).toBeVisible();await form.getByLabel('編集する対象').selectOption('new');
 const original=await page.evaluate(()=>{const original={...history.state};history.pushState({...history.state,otherSubsystem:'retained'},'',location.pathname+location.search+'#first');history.pushState({...history.state},'',location.pathname+location.search+'#second');return original;});
 await form.getByLabel('職員の氏名').fill('履歴移動中も失わない未保存名');
 for(let repetition=0;repetition<2;repetition++){
  await traverse(page,'back',false);await expect(page).toHaveURL(/#second$/);await expect(form.getByLabel('職員の氏名')).toHaveValue('履歴移動中も失わない未保存名');
 }
 await traverse(page,'back',true);await expect(page).toHaveURL(/#first$/);
 await expect(form.getByLabel('職員の氏名')).toHaveValue('履歴移動中も失わない未保存名');
 await traverse(page,'forward',false);await expect(page).toHaveURL(/#first$/);await expect(form.getByLabel('職員の氏名')).toHaveValue('履歴移動中も失わない未保存名');
 await traverse(page,'forward',true);await expect(page).toHaveURL(/#second$/);
 const current=await page.evaluate(()=>history.state);expect(current.otherSubsystem).toBe('retained');for(const key of Object.keys(original).filter(k=>!k.startsWith('__pharmshift_')))expect(current).toHaveProperty(key);
 await form.getByRole('button',{name:'未保存の内容を破棄',exact:true}).click();await page.evaluate(()=>history.back());await expect(page).toHaveURL(/#first$/);
 await info.attach('history-state-preservation',{body:JSON.stringify({originalKeys:Object.keys(original),currentKeys:Object.keys(current),backRejections:2,forwardRejections:1}),contentType:'application/json'});
});
