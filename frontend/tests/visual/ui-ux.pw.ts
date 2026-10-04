import {expect, test} from '@playwright/test';
import {audit, WIDTHS, FIXED_NOW} from './lib/audit';
import {focusIndicators, textContrast, textSpacing} from './lib/optical';

const BASE = 'https://127.0.0.1:18531';
for (const [user, password] of [['admin','pass-admin'], ['leader','pass-lead'], ['pharmacist','pass-ph']]) {
  test(`${user}: live dashboard, scoped links and recovery from failed read`, async ({page, context}, info) => {
    test.setTimeout(600_000);
    await page.clock.setFixedTime(FIXED_NOW);
    const observed: {method: string; path: string; status: number; surface:'api'|'frontend'|'other'}[] = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/planning/')) observed.push({method: response.request().method(), path: url.pathname, status:response.status(), surface:url.origin==='https://127.0.0.1:18540'?'api':url.origin===BASE?'frontend':'other'});
    });
    await page.goto(`${BASE}/login`);
    await page.getByLabel('ユーザーID').fill(user);
    await page.getByLabel('パスワード').fill(password);
    await page.getByRole('button',{name:'サインイン',exact:true}).click();
    await page.waitForURL(url => url.pathname === '/planning');
    for (const theme of ['light','dark']) {
      await context.addCookies([{name:'ps-theme',value:theme,url:BASE,secure:true,sameSite:'Lax'}]);
      for (const width of WIDTHS) {
        await page.setViewportSize({width,height:900});
        await page.goto(`${BASE}/dashboard`);
        await page.getByLabel('対象月', {exact:true}).fill('2026-01');
        await expect(page.getByText('取得時刻：',{exact:false})).toBeVisible();
        await expect(page.getByText('99.9%')).toHaveCount(0);
        if (process.env.VISUAL_PUBLISHED === '1') {
          const response = await page.request.get('https://127.0.0.1:18540/planning/dashboard?scope_id=hospital/pharmacy&period=2026-01');
          expect(response.status()).toBe(200);
          const data = await response.json();
          expect(data.metrics.published_periods.value).toBe(1);
          if (user !== 'pharmacist') expect(data.metrics.assigned_duties.value).toBeGreaterThan(0);
          const cards = page.getByRole('region',{name:'対象月の業務状況'});
          await expect(cards.getByRole('heading',{name:'公開勤務の割当'}).locator('..').locator('..')).toContainText(`${data.metrics.assigned_duties.value}件`);
        }
        const result = await audit(page,info,`live-dashboard-${user}-${theme}-${width}`,width,theme);
        expect(result.findings).toEqual([]);
        await page.getByRole('link',{name:'勤務表・公開状態を確認'}).click();
        await expect(page.getByRole('heading',{name:'勤務表・計画'})).toBeVisible();
        await expect(page.getByLabel('施設・部署',{exact:false}).first()).toHaveValue('hospital/pharmacy');
        if(user==='pharmacist') {
          const month=page.getByLabel('表示する月（本人の公開勤務）');
          await expect(month).toHaveValue('2026-01');
          await month.fill('2026-02');
          await expect(page.getByText('2026-02-01〜2026-02-28（日本時間）')).toBeVisible();
          await expect(page.getByRole('region',{name:'現在の計画状態'})).toHaveCount(0);
          await expect(page.getByRole('navigation',{name:'勤務管理の業務'}).getByRole('link',{name:'休暇',exact:true})).toHaveAttribute('href',/period=2026-02/);
        }
        if(theme==='light') {
          for(const name of ['契約・制度','兼業・派遣照合','休暇','実績','個人情報管理','復旧状況']) {
            const denied=(name==='契約・制度'||name==='復旧状況')?user!=='admin':name==='実績'&&user==='pharmacist';
            if(denied){
              await expect(page.getByRole('navigation',{name:'勤務管理の業務'}).getByRole('link',{name,exact:true})).toHaveCount(0);
              const path={'契約・制度':'contracts','実績':'actuals','復旧状況':'recovery'}[name];
              await page.goto(`${BASE}/planning/workflows/${path}?scope=hospital/pharmacy`);
            }else await page.getByRole('navigation',{name:'勤務管理の業務'}).getByRole('link',{name,exact:true}).click();
            await expect(page.getByRole('heading',{level:1,name,exact:true})).toBeVisible();
            await expect(page.getByLabel('施設・部署',{exact:false}).first()).toHaveValue('hospital/pharmacy');
            if(denied) await expect(page.getByRole('main').getByRole('alert')).toContainText('この業務を操作する権限がありません');
          }
        }
      }
    }
    await page.route('**/planning/dashboard?**', route => route.fulfill({status:503,body:'temporarily unavailable'}));
    await page.goto(`${BASE}/dashboard`);
    await expect(page.getByRole('region',{name:'対象月の業務状況'}).getByRole('alert')).toContainText('現在情報を取得できません');
    await page.unroute('**/planning/dashboard?**');
    await page.getByRole('button',{name:'再読込',exact:true}).click();
    await expect(page.getByText('取得時刻：',{exact:false})).toBeVisible();
    await info.attach('observed-api', {body:JSON.stringify(observed),contentType:'application/json'});
    await info.attach('render-engine',{body:JSON.stringify({browser:page.context().browser()?.version(),locale:'ja-JP',timezone:'Asia/Tokyo'}),contentType:'application/json'});
  });
}

test('optical counterexamples: focus truncation and invisible text are detected', async ({page}) => {
  await page.setContent('<style>body{background:white;color:white}button{padding:12px}</style><p>invisible text</p><button>A</button><button>B</button><button>C</button>');
  expect((await textContrast(page)).findings.length).toBeGreaterThan(0);
  expect((await focusIndicators(page,2)).skipped).toHaveLength(1);
  await page.setContent('<p>No interactive controls</p>');
  expect((await focusIndicators(page,2)).skipped).toEqual([]);
  await page.setContent('<details><summary>Details</summary><input/><button>Hidden</button></details><p style="color: blue">text</p>');
  expect((await focusIndicators(page,5)).skipped).toEqual([]);
  const style = await page.locator('p').getAttribute('style');
  await textSpacing(page);
  expect(await page.locator('p').getAttribute('style')).toBe(style);
  // Chromium/WebKit may serialize a cleared CSSOM as style=""; no inline
  // declaration may remain, and authored declarations above must be exact.
  expect(await page.locator('summary').evaluate(el => (el as HTMLElement).style.length)).toBe(0);
  await page.setContent('<input type="date" aria-label="date"/><input type="file" aria-label="file"/><button>End</button>');
  expect((await focusIndicators(page,30)).skipped).toEqual([]);
  await page.setContent('<button>A</button><button>B</button>');
  await page.locator('button').first().evaluate(el => el.addEventListener('keydown',event => {if ((event as KeyboardEvent).key === 'Tab') event.preventDefault();}));
  expect((await focusIndicators(page,5)).skipped).toHaveLength(1);
});

test('optical counterexamples: clipped scroll text is ignored but a real overlay is reported', async ({page}) => {
  await page.setContent(`<style>body{background:#fff;color:#111}.scroll{width:180px;overflow:auto}.wide{position:relative;width:600px;height:60px}.far{position:absolute;left:500px;top:10px}</style>
    <div class="scroll"><div class="wide"><span>左端の文字</span><span class="far">右端の文字</span></div></div>`);
  const scroll=page.locator('.scroll');
  await scroll.evaluate(el=>{el.scrollLeft=0;});
  let result=await textContrast(page);
  expect(result.findings).toEqual([]);expect(result.skipped).toEqual([]);
  await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
  result=await textContrast(page);
  expect(result.findings).toEqual([]);expect(result.skipped).toEqual([]);

  await page.setContent(`<style>body{background:#fff;color:#111}.box{position:relative;width:220px}.cover{position:absolute;inset:0;background:#fff}</style>
    <div class="box"><span>実際に覆われた文字</span><span class="cover" aria-hidden="true"></span></div>`);
  result=await textContrast(page);
  expect(result.skipped.map((finding)=>finding.text)).toContain('実際に覆われた文字');
  expect(result.skipped.find((finding)=>finding.text==='実際に覆われた文字')?.detail).toContain('covered');
});

test('optical counterexample: a trap on the final native input remains incomplete', async ({page}) => {
  for (const type of ['date', 'file', 'button']) {
    await page.setContent(`<button>Start</button><input type="${type}" aria-label="Last"/>`);
    await page.locator('input').evaluate(el => el.addEventListener('keydown', event => {if ((event as KeyboardEvent).key === 'Tab') event.preventDefault();}));
    expect((await focusIndicators(page,30)).skipped).toHaveLength(1);
  }
});

test('optical focus coverage excludes a control disabled during traversal', async ({page}) => {
  await page.setContent('<button id="first">First</button><button id="conditional">Conditional</button><button>Last</button>');
  await page.locator('#first').evaluate(element => element.addEventListener('keydown', event => {
    if ((event as KeyboardEvent).key === 'Tab') {
      (document.querySelector('#conditional') as HTMLButtonElement).disabled = true;
    }
  }));
  expect((await focusIndicators(page, 10)).skipped).toEqual([]);
});


test('optical modal scope: intentional cycling completes, an internal trap does not', async ({page}) => {
  for (const role of ['dialog', 'alertdialog'] as const) {
  await page.setContent(`<button inert>Background</button><div role="${role}" aria-modal="true" style="position:fixed;inset:10px"><button>First</button><button>Last</button></div>`);
  await page.getByRole(role).evaluate(el => el.addEventListener('keydown', event => {
    const key = event as KeyboardEvent;
    if (key.key !== 'Tab') return;
    const items = [...el.querySelectorAll<HTMLElement>('button,[tabindex]')].filter(node => node.offsetParent !== null);
    if (!key.shiftKey && document.activeElement === items.at(-1)) {key.preventDefault();items[0].focus();}
    if (key.shiftKey && document.activeElement === items[0]) {key.preventDefault();items.at(-1)?.focus();}
  }));
  expect((await focusIndicators(page,10)).skipped).toEqual([]);
  expect(await page.locator('[data-optical-traversal-end]').count()).toBe(0);
  await page.getByRole('button',{name:'Last',exact:true}).evaluate(el => el.addEventListener('keydown', event => {
    if ((event as KeyboardEvent).key === 'Tab') {event.preventDefault();event.stopPropagation();}
  }));
  expect((await focusIndicators(page,10)).skipped).toHaveLength(1);
  }
});
