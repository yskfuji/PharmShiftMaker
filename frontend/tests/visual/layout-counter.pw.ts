import { expect, test } from '@playwright/test';

import { layout } from './lib/layout';

// Counterexamples for lib/layout.ts: each defect it guards must be reported, and the
// corrected layout must pass.
const APP = (lab: string, main: string) => `<div class="ideal-app"><main class="ideal-main" style="padding:16px">${lab}${main}</main></div>`;

test('evaluation controls fixed over the page content are reported', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const content = '<section class="ideal-panel" style="height:900px;background:#eee">内容</section>';
  await page.setContent(APP('<aside class="ideal-lab" style="position:fixed;right:16px;bottom:16px;width:300px;height:40px">UI Lab</aside>', content));
  expect((await layout(page)).join()).toContain('lab overlaps');
  await page.setContent(APP('<aside class="ideal-lab" style="position:static;height:40px">UI Lab</aside>', content));
  expect(await layout(page)).toEqual([]);
});

test('a toolbar button whose label wraps is reported', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const button = (flex: string) => `<div class="ideal-toolbar" style="display:flex;flex-direction:column;padding:22px"><div class="ideal-actions" style="display:flex;flex-wrap:wrap;gap:10px;width:100%">`
    + ['自分の予定を印刷', 'カレンダーに追加（.ics）'].map((t) => `<a class="ideal-button" style="flex:${flex};display:inline-flex;padding:9px 14px;border:1px solid #333;font-size:14px;line-height:20px">${t}</a>`).join('') + '</div></div>';
  await page.setContent(APP('', button('1')));
  expect((await layout(page)).join()).toContain('toolbar button wraps');
  await page.setContent(APP('', button('1 1 12rem')));
  expect(await layout(page)).toEqual([]);
});
