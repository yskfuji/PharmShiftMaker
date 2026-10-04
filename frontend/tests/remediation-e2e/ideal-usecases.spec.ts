import {test, expect, type BrowserContext, type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';

type UseCase = {id:string;title:string;route:string;e2e:string};
const cases = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../docs/ideal-ui/usecases.json'), 'utf8')) as {use_cases:UseCase[]}).use_cases;
const IDEAL = process.env.IDEAL_UI === '1';

async function signIn(page: Page, context: BrowserContext) {
  await context.clearCookies();
  await page.goto('/login');
  await page.getByLabel('ユーザーID').fill('admin');
  await page.getByLabel('パスワード').fill('pass-admin');
  await page.getByRole('button', {name: 'サインイン', exact: true}).click();
  await page.waitForURL((url) => url.pathname === '/workspace/home');
}

for (const useCase of cases) {
  for (const width of [320, 768, 1440]) {
    test(`${useCase.e2e} ${width}`, async ({page, context}) => {
      test.skip(!IDEAL, 'The ideal matrix is an IDEAL_UI=1 acceptance gate.');
      test.setTimeout(120_000);
      await page.setViewportSize({width, height: 900});
      await signIn(page, context);
      const response = await page.goto(useCase.route);
      expect(response?.status(), `${useCase.id} ${useCase.route}`).toBe(200);
      await expect(page.locator('main#main h1')).toBeVisible({timeout: 20_000});
      await expect(page.getByRole('alert').filter({hasText: /権限|読み込めません|見つかりません/})).toHaveCount(0);
      if (useCase.route.split('/').length > 3) {
        const section = useCase.route.split('/')[2];
        const nav = page.getByRole('navigation', {name: new RegExp(section === 'plan' ? '計画' : section === 'operations' ? '当日運用' : section === 'requests' ? '申請' : section === 'people' ? '職員' : section === 'governance' ? 'ガバナンス' : '設定')});
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      }
      const reflow = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        culprits: [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((element) => {
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const box = element.getBoundingClientRect();
            return box.right > innerWidth + 0.5 || box.left < -0.5;
          })
          .slice(0, 12)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            className: element.className,
            text: element.textContent?.trim().slice(0, 80),
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right),
          })),
      }));
      expect(reflow.documentWidth, JSON.stringify(reflow)).toBeLessThanOrEqual(reflow.viewportWidth);
      const axe = await new AxeBuilder({page}).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(axe.violations, `${useCase.id} ${useCase.title}`).toEqual([]);
    });
  }
}
