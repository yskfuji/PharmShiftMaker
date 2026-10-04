import { expect, test, type Page } from '@playwright/test';

import { focusIndicators, targetSizes, textContrast, textSpacing } from './lib/optical';

// Counterexamples on the real shared styles: each of six appearance defects is injected at
// runtime into the control-state story, and the check that guards it must fail. The same
// check on the untouched story must pass, so the finding comes from the injected defect.
const BASE = process.env.VISUAL_STORYBOOK_URL ?? 'http://127.0.0.1:18530';
const STORY = '部品-操作の状態--controls';

async function open(page: Page) {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`${BASE}/iframe.html?id=${encodeURIComponent(STORY)}&viewMode=story&globals=theme:light`);
  await page.getByRole('button', { name: '主な操作' }).waitFor();
}

// The functional contract of a screen: every control's role, accessible name and disabled state.
async function contract(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('#storybook-root button, #storybook-root input, #storybook-root select, #storybook-root textarea, #storybook-root summary')]
    .map((el) => `${el.tagName}|${el.getAttribute('aria-label') ?? el.closest('label')?.textContent?.trim() ?? el.textContent?.trim()}|${(el as HTMLButtonElement).disabled ? 'disabled' : 'enabled'}`));
}

test('six injected appearance defects are each detected', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  const pristine = await contract(page);
  expect((await textContrast(page)).findings).toEqual([]);
  expect((await targetSizes(page)).findings).toEqual([]);
  expect((await textSpacing(page)).findings).toEqual([]);
  expect((await focusIndicators(page)).findings).toEqual([]);

  // 1. Text too faint to read.
  const faint = page.getByText('保存しました。');
  await faint.evaluate((el) => { (el as HTMLElement).style.color = 'rgb(236, 240, 246)'; });
  await faint.scrollIntoViewIfNeeded();
  expect((await textContrast(page)).findings.map((f) => f.text)).toContain('保存しました。');

  // 2. A control disappears.
  await open(page);
  await page.getByRole('button', { name: '補助の操作' }).evaluate((el) => el.remove());
  expect(await contract(page)).not.toEqual(pristine);

  // 3. A fixed height clips wrapped text.
  await open(page);
  await page.getByText('この項目を入力してください。').evaluate((el) => { const s = (el as HTMLElement).style; s.height = '1rem'; s.overflow = 'hidden'; });
  expect((await textSpacing(page)).findings.map((f) => f.text)).toContain('この項目を入力してください。');

  // 4. Focus is hidden under author content.
  await open(page);
  await page.evaluate(() => { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:50;background:rgba(255,255,255,.01)'; document.body.append(cover); });
  expect((await focusIndicators(page, 40)).findings.some((f) => f.detail.includes('obscured'))).toBe(true);

  // 5. A control that must be unavailable becomes enabled.
  await open(page);
  await page.getByRole('button', { name: '無効（主）' }).evaluate((el) => { (el as HTMLButtonElement).disabled = false; });
  const changed = (await contract(page)).filter((row, i) => row !== pristine[i]);
  expect(changed).toEqual(['BUTTON|無効（主）|enabled']);

  // 6. A click target shrinks below 24px.
  await open(page);
  await page.getByRole('button', { name: '選択中' }).evaluate((el) => { const s = (el as HTMLElement).style; s.setProperty('min-height', '0', 'important'); s.setProperty('height', '16px', 'important'); s.setProperty('padding', '0', 'important'); s.setProperty('font-size', '10px', 'important'); });
  expect((await targetSizes(page)).findings.map((f) => f.text)).toContain('選択中');
});
