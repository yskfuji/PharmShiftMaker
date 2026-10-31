const {
  chromium,
  expect
} = require('@playwright/test');
const fs = require('fs');
const assert = require('assert/strict');
const ROOT = 'https://localhost:18611',
  API = 'https://localhost:18610',
  QUERY = '?scope=hospital%2Fpharmacy&period=2026-01',
  SCOPE = '?scope_id=hospital%2Fpharmacy';
// This is a synthetic write journey, never a health check against ordinary data.
assert.equal(process.env.PHARMSHIFT_SYNTHETIC_ACCEPTANCE, '1', 'Explicit synthetic environment required');
assert.equal(process.version, 'v26.12.1', 'Use the repository Node version');
const path = require('node:path');
const output = process.env.ACCEPTANCE_OUTPUT;
assert(output && path.isAbsolute(output), 'An absolute new output directory is required');
fs.mkdirSync(output, {
  recursive: false,
  mode: 0o700
});
const artifact = name => path.join(output, name);
const creds = JSON.parse(fs.readFileSync(process.env.ACCEPTANCE_CREDENTIALS));
let stage = 'start';
const evidence = [];
(async () => {
  const browser = await chromium.launch();
  const contexts = [];
  let page;
  try {
    async function login(who) {
      const c = await browser.newContext({
        ignoreHTTPSErrors: false,
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
        viewport: {
          width: 1440,
          height: 1000
        },
        extraHTTPHeaders: {
          Origin: ROOT
        }
      });
      contexts.push(c);
      const p = await c.newPage();
      p.setDefaultTimeout(20000);
      p.setDefaultNavigationTimeout(30000);
      await p.goto(ROOT + '/login?redirectTo=' + encodeURIComponent('/workspace/home' + QUERY));
      await p.getByLabel('ユーザーID').fill(who);
      await p.getByLabel('パスワード', {
        exact: true
      }).fill(creds[who]);
      await p.getByRole('button', {
        name: 'サインイン',
        exact: true
      }).click();
      await p.waitForURL('**/workspace/home?*');
      return {
        c,
        p
      };
    }
    const api = async (c, path, data, status) => {
      const r = await c.request[data ? 'post' : 'get'](API + path, data ? {
        data
      } : {});
      if (status !== undefined) {
        assert.equal(r.status(), status);
        return r;
      }
      if (!r.ok()) throw Error(path + ' HTTP ' + r.status());
      return r.json();
    };
    const capture = async (p, name) => {
      await p.evaluate(() => document.fonts.ready);
      await p.screenshot({
        path: artifact(name + '.png'),
        fullPage: true
      });
      fs.writeFileSync(artifact(name + '.txt'), await p.locator('body').innerText());
      evidence.push({
        stage,
        name,
        url: p.url()
      });
    };
    stage = 'preflight';
    const admin = await login('admin');
    page = admin.p;
    assert.equal((await api(admin.c, '/planning/requests' + SCOPE)).length, 0, 'Fresh synthetic DB required: scope requests exist');
    assert.equal((await api(admin.c, '/planning/publications' + SCOPE)).length, 0, 'Fresh synthetic DB required: scope publications exist');
    stage = 'staff-login';
    const staff = await login('staff');
    page = staff.p;
    await expect(page.getByRole('heading', {
      name: 'あなたの職種と操作権限'
    })).toBeVisible();
    await expect(page.getByText('調剤事務', {
      exact: true
    })).toBeVisible();
    await capture(page, 'staff-home');
    const context = await api(staff.c, '/planning/staff-context' + SCOPE);
    assert.equal(context.permission, 'STAFF');
    assert.equal(context.occupation, 'CLERK');
    await api(staff.c, '/planning/inputs/latest' + SCOPE, undefined, 403);
    // Refuse to reuse a populated DB: previous evidence must stay immutable.
    assert.equal((await api(staff.c, '/planning/requests' + SCOPE)).length, 0, 'Fresh synthetic DB required: requests exist');
    assert.equal((await api(staff.c, '/planning/publications' + SCOPE)).length, 0, 'Fresh synthetic DB required: publications exist');
    stage = 'staff-request';
    await page.goto(ROOT + '/workspace/requests/leave' + QUERY);
    await page.getByLabel('日付', {
      exact: true
    }).fill('2026-01-05');
    await page.getByLabel('種類').selectOption('PUBLIC_HOLIDAY_REQUEST');
    await page.getByRole('button', {
      name: '申請を記録',
      exact: true
    }).click();
    await expect.poll(async () => (await api(staff.c, '/planning/requests' + SCOPE)).length).toBe(1);
    const requests = await api(staff.c, '/planning/requests' + SCOPE);
    assert.equal(requests[0].person_id, 'p0');
    await capture(page, 'staff-request');
    stage = 'admin-refresh';
    page = admin.p;
    await page.goto(ROOT + '/workspace/plan/input' + QUERY);
    await page.getByRole('button', {
      name: '申請・実績を計画に反映',
      exact: true
    }).click();
    await expect(page.getByText('最新の申請・実績を反映した入力版を作りました。')).toBeVisible();
    const input = await api(admin.c, '/planning/inputs/latest' + SCOPE);
    assert(input.snapshot.preferences.some(p => p.request_id === requests[0].request_id && p.person_id === 'p0'));
    await capture(page, 'admin-input');
    stage = 'generate';
    await page.getByRole('link', {
      name: /前提を確認して候補生成へ/
    }).click();
    await page.getByRole('button', {
      name: '3つの案を作る',
      exact: true
    }).click();
    await expect(page.getByRole('link', {
      name: /3案を同じ定義で比較/
    })).toBeVisible({
      timeout: 120000
    });
    await capture(page, 'admin-generated');
    stage = 'compare';
    await page.getByRole('link', {
      name: /3案を同じ定義で比較/
    }).click();
    await page.getByRole('radio').first().check();
    await page.getByRole('link', {
      name: /選んだ案を確認・編集/
    }).click();
    stage = 'review';
    await page.getByRole('button', {
      name: 'サーバーで再検証',
      exact: true
    }).click();
    await expect(page.getByText('公開前の最終確認', {
      exact: true
    })).toBeVisible();
    const draft = new URL(page.url()).searchParams.get('draft');
    assert(draft);
    await api(staff.c, `/planning/drafts/${draft}/review` + SCOPE, {
      version: 1,
      idempotency_key: 'staff-review-denied-browser'
    }, 403);
    await capture(page, 'admin-reviewed');
    stage = 'publish';
    await page.getByRole('button', {
      name: '確認した案を公開',
      exact: true
    }).click();
    await page.waitForURL('**/workspace/schedule?*');
    await capture(page, 'admin-published');
    const published = await api(admin.c, '/planning/publications' + SCOPE);
    assert.equal(published.length, 1);
    assert(published[0].assignments.some(x => x.person_id === 'p0' && x.task === 'reception'));
    stage = 'staff-refetch';
    page = staff.p;
    await page.goto(ROOT + '/workspace/schedule' + QUERY);
    const personal = await api(staff.c, '/planning/publications' + SCOPE);
    assert.equal(personal.length, 1);
    assert.equal(personal[0].assignments.length, 1);
    assert.equal(personal[0].assignments[0].person_id, 'p0');
    assert.equal(personal[0].publication_id, published[0].publication_id);
    const assertOwnRoster = async () => {
      await expect(page.getByText('自分の公開勤務 1件', {
        exact: true
      })).toBeVisible();
      const roster = page.getByRole('region', {
        name: '月間勤務表',
        exact: true
      });
      await expect(roster.getByText('あなた', {
        exact: true
      })).toBeVisible();
      await expect(roster.getByRole('button', {
        name: /日勤.*09:00–13:00/
      })).toBeVisible();
      for (const name of ['Person 1', 'Person 2', 'Person 3']) await expect(page.getByText(name, {
        exact: true
      })).toHaveCount(0);
    };
    await assertOwnRoster();
    await capture(page, 'staff-published');
    await page.reload();
    await assertOwnRoster();
    await capture(page, 'staff-published-reloaded');
    const pharmacist = await login('pharmacist');
    assert.equal((await api(pharmacist.c, '/planning/staff-context' + SCOPE)).occupation, 'PHARMACIST');
    await api(pharmacist.c, '/planning/inputs/latest' + SCOPE, undefined, 403);
    await api(staff.c, '/planning/staff-context?scope_id=other%2Fpharmacy', undefined, 403);
    fs.writeFileSync(artifact('journey-result.json'), JSON.stringify({
      status: 'passed',
      tlsVerification: true,
      stages: evidence,
      publication_id: published[0].publication_id,
      request_id: requests[0].request_id,
      draft_id: draft,
      input_hash: input.input_hash,
      registered_person: 'p0',
      private_filter: 'only p0 assignments',
      scope_escape_status: 403,
      staff_management_status: 403,
      auth: 'mock; not real IdP'
    }, null, 2));
    console.log('PASS browser request → input refresh → generation → comparison → review → publish → staff reread.');
  } catch (e) {
    fs.writeFileSync(artifact('journey-failure.json'), JSON.stringify({
      stage,
      error: e.message,
      completed: evidence
    }, null, 2));
    if (page) {
      await page.screenshot({
        path: artifact('journey-failure.png'),
        fullPage: true
      });
      fs.writeFileSync(artifact('journey-failure.txt'), await page.locator('body').innerText());
    }
    throw e;
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error('Failed stage: ' + stage + '; ' + e.message);
  process.exit(1);
});
