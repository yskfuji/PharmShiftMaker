import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {audit, WIDTHS, FIXED_NOW} from './lib/audit';

const BASE='https://127.0.0.1:18531';
test('generate after uncertain response, review, publish and read populated mobile/desktop views', async ({page}, info) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  await page.clock.setFixedTime(FIXED_NOW);
  await page.goto(BASE+'/login');
  await page.getByLabel('ユーザーID').fill('admin');
  await page.getByLabel('パスワード').fill('pass-admin');
  await page.getByRole('button',{name:'サインイン',exact:true}).click();
  await page.waitForURL(u=>u.pathname==='/planning');
  // The fixture's January rule review is deliberately historical. Record a
  // fresh synthetic review through the dedicated UI before generating today.
  await page.getByRole('link',{name:'契約・制度',exact:true}).click();
  await expect(page.getByRole('heading',{name:'契約・制度',exact:true})).toBeVisible();
  const form=page.getByRole('region',{name:'職員と契約の専用操作'});
  await form.getByLabel('登録する業務').selectOption('rule_review');
  await form.getByLabel('編集する対象').selectOption('review');
  await form.getByLabel('今回の確認日',{exact:true}).fill('2026-09-28');
  await form.getByLabel('次回の確認期限',{exact:true}).fill('2026-10-28');
  await form.getByLabel('資料の版（改正日など）',{exact:true}).fill('local-synthetic-ui-2026-09-28');
  await form.getByLabel('取得した資料のSHA-256（16進64桁）',{exact:true}).fill(createHash('sha256').update('Synthetic UI acceptance rule; not a facility or legal source.').digest('hex'));
  await form.getByRole('button',{name:'この内容を保存・再送',exact:true}).click();
  await expect(form.getByText(/記録を保存して再取得しました/)).toBeVisible();
  await form.getByLabel('登録する業務').selectOption('rule_decision');
  await form.getByLabel('編集する対象').selectOption('new');
  await form.getByRole('combobox',{name:'判断する制度確認（資料のハッシュ付き）',exact:true}).selectOption('review');
  await form.getByRole('button',{name:'影響を表示する',exact:true}).click();
  await expect(form.getByText(/旧い規則版で決まった記録/)).toBeVisible();
  await form.getByRole('combobox',{name:'判断',exact:true}).selectOption('publish');
  await form.getByLabel('判断日',{exact:true}).fill('2026-09-28');
  await form.getByLabel('原本確認の資料名・参照先',{exact:true}).fill('合成UI試験の判断。施設の承認・法的根拠ではない');
  await form.getByRole('combobox',{name:'原本確認の状態',exact:true}).selectOption('verified');
  await form.getByLabel('原本確認の確認責任者',{exact:true}).fill('synthetic-auditor');
  await form.getByRole('button',{name:'この内容を保存・再送',exact:true}).click();
  await expect(form.getByText(/記録を保存して再取得しました/)).toBeVisible();
  await page.getByRole('link',{name:'月間勤務表',exact:true}).click();
  await page.getByRole('button',{name:'申請・実績を計画に反映',exact:true}).click();
  await expect(page.getByText('最新の申請・実績・休暇残数を反映しました。',{exact:true})).toBeVisible();
  let posts=0;
  await page.route('**/planning/jobs?*',async route=>{
    if(route.request().method()!=='POST') return route.continue();
    posts++;
    if(posts===1){const accepted=await route.fetch();expect(accepted.status()).toBe(202);await route.abort('failed');}
    else await route.continue();
  });
  await page.getByRole('button',{name:'勤務案を生成',exact:true}).click();
  await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
  await page.getByRole('button',{name:'勤務案を生成',exact:true}).click();
  await expect(page.getByRole('heading',{name:/勤務案の確認・編集/})).toBeVisible({timeout:45_000});
  expect(posts).toBe(1); // retry recovered the existing job by key
  await expect(page.getByRole('button',{name:'確認した案を公開',exact:true})).toBeDisabled();
  const selectedName=await page.getByRole('checkbox',{checked:true}).first().getAttribute('aria-label');
  expect(selectedName).toBeTruthy();
  const selected=page.getByRole('checkbox',{name:selectedName!,exact:true});
  await selected.uncheck();
  await expect(page.getByText('未保存の変更があります。保存すると以前の確認は解除されます。')).toBeVisible();
  await expect(page.getByRole('button',{name:'内容を検証・確認',exact:true})).toBeDisabled();
  await selected.check();
  await page.getByRole('button',{name:'内容を検証・確認',exact:true}).click();
  await expect(page.getByRole('button',{name:'確認した案を公開',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'確認した案を公開',exact:true}).click();
  await expect(page.getByText('確認した案を公開しました。',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'月間勤務表 — 公開済み',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'月間勤務表 — 下書き（未公開）',exact:true})).toHaveCount(0);
  await page.reload();
  const response=await page.request.get('https://127.0.0.1:18540/planning/publications?scope_id=hospital/pharmacy');
  expect(response.status()).toBe(200);
  const publications=await response.json();
  const duty=publications[0].assignments[0];
  expect(duty).toBeDefined();
  for(const width of WIDTHS){
    await page.setViewportSize({width,height:900});
    if(width<768){
      await page.getByRole('combobox',{name:'表示日',exact:true}).selectOption(new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date(duty.start)));
      const peopleSelect=page.getByRole('combobox',{name:'職員',exact:true});
      await peopleSelect.selectOption(duty.person_id);
      const bounds=await peopleSelect.boundingBox();
      expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);
      await page.getByRole('button',{name:/詳細を表示/}).first().click();
      await expect(page.getByRole('button',{name:'詳細を閉じる',exact:true})).toBeVisible();
      await page.getByRole('button',{name:'詳細を閉じる',exact:true}).click();
    } else await expect(page.getByRole('region',{name:'月間勤務表（横スクロール可能）'})).toBeVisible();
    const result=await audit(page,info,`populated-planning-light-${width}`,width,'light');
    expect(result.findings).toEqual([]);
  }
  await page.goto(BASE+'/dashboard');
  await page.getByLabel('対象月',{exact:true}).fill('2026-01');
  await expect(page.getByText('取得時刻：',{exact:false})).toBeVisible();
  const card=page.getByRole('heading',{name:'公開勤務の割当',exact:true}).locator('..').locator('..');
  await expect(card).toContainText(`${publications[0].assignments.length}件`);
  await info.attach('flow-result',{body:JSON.stringify({job_posts:posts,publication_versions:publications.map((p:{version:number})=>p.version),assignment_count:publications[0].assignments.length}),contentType:'application/json'});
});
