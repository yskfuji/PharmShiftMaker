import {expect, test} from '@playwright/test';
import {applyTheme, audit, explicit, FIXED_NOW, scheme, THEMES, WIDTHS} from './lib/audit';

const states = ['clerk', 'clerical-leader', 'pharmacist', 'assistant', 'unknown', 'failure', 'restricted'];
const base = process.env.VISUAL_STORYBOOK_URL ?? 'http://127.0.0.1:18530';
for (const state of states) {
  test(`occupation and permission: ${state}`, async ({page}, info) => {
    test.setTimeout(180_000);
    await page.clock.setFixedTime(FIXED_NOW);
    const findings: string[] = [];
    for (const theme of THEMES) {
      await page.emulateMedia({colorScheme: scheme(theme)});
      for (const width of WIDTHS) {
        await page.setViewportSize({width, height: 900});
        await page.goto(`${base}/iframe.html?id=ideal-ui-v3-multirole--${state}&viewMode=story&globals=theme:${explicit(theme) ?? 'system'}`);
        await expect(page.getByRole('heading', {name: 'あなたの職種と操作権限'})).toBeVisible();
        await expect(page.getByText('職種と操作権限を確認しています…')).toHaveCount(0);
        await applyTheme(page, theme);
        const result = await audit(page, info, `multirole-${state}-${theme}-${width}`, width, theme);
        findings.push(...result.findings.map(f => `${theme}/${width}: ${f.check} ${f.detail}`));
      }
    }
    expect(findings).toEqual([]);
  });
}
