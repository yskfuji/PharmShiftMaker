import {test,expect} from '@playwright/test';

test('workflow link stays clickable while the roster arrives',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  let release!:()=>void;
  const barrier=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/planning/inputs/latest?*',async route=>{
    const response=await route.fetch();await barrier;await route.fulfill({response});
  });
  try {
    await page.goto('/login');await page.getByLabel('ユーザーID').fill('admin');
    await page.getByLabel('パスワード').fill('pass-admin');
    await page.getByRole('button',{name:'サインイン',exact:true}).click();
    await page.waitForURL(u=>u.pathname==='/planning');
    const link=page.getByRole('link',{name:'休暇',exact:true});
    await expect(link).toBeVisible();const before=await link.boundingBox();expect(before).not.toBeNull();
    await page.mouse.move(before!.x+before!.width/2,before!.y+before!.height/2);await page.mouse.down();
    release();await expect(page.getByRole('heading',{name:'契約と適用期間',exact:true})).toBeVisible();
    const after=await link.boundingBox();expect(after).toEqual(before);
    await page.mouse.up();await expect(page).toHaveURL(/\/workflows\/leave\?/);
  } finally {release();}
});
