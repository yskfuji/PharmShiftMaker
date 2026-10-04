import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { allOptical, textSpacing, type Finding } from './optical';

export const WIDTHS = [320, 768, 1440] as const;
// Themes: "light"/"dark" are explicit choices (data-theme); "system-light"/"system-dark"
// leave the choice to the operating system (prefers-color-scheme) with no data-theme.
export const THEMES = (process.env.VISUAL_THEMES ?? 'light,dark,system-light,system-dark').split(',').map((t) => t.trim()).filter(Boolean);
const SCREENSHOTS = process.env.VISUAL_SCREENSHOTS !== '0';
// Baselines are kept for the two explicit themes; the system themes are checked optically.
const BASELINE_THEMES = new Set(['light', 'dark']);
// A fixed clock keeps dates on screen stable between runs.
export const FIXED_NOW = new Date('2026-09-28T09:00:00+09:00');

export const scheme = (theme: string) => (theme.endsWith('dark') ? 'dark' : 'light') as 'dark' | 'light';
export const explicit = (theme: string) => (theme === 'light' || theme === 'dark' ? theme : null);

export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForLoadState('networkidle');
  // Measure the steady rendering state. Button mode/theme changes also animate
  // foreground colors; network-idle alone does not imply those have finished.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await page.waitForFunction(()=>!document.getAnimations().some(animation=>
    (animation.playState==='running'||animation.pending)&&Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))),undefined,{timeout:5000});
}

/** Stories: set the theme in the page (the story's globals cover the first render). */
export async function applyTheme(page: Page, theme: string): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme(theme) });
  await page.evaluate((value) => {
    if (value) document.documentElement.dataset.theme = value;
    else delete document.documentElement.dataset.theme;
  }, explicit(theme));
}

export type Audit = { findings: Finding[]; skipped: Finding[] };

/**
 * One audit of the current page: a screenshot first (chromium, explicit themes; compared
 * with the committed baseline), then the optical checks (all engines), and text spacing
 * at 320 and 1440. Findings and skipped cases are attached as JSON; findings must be empty.
 */
export async function audit(page: Page, info: TestInfo, name: string, width: number, theme: string, mask: Locator[] = []): Promise<Audit> {
  await settle(page);
  // Screenshots first: the focus check moves focus with Tab, which would leave a ring in the picture.
  if (SCREENSHOTS && info.project.name === 'chromium-linux' && BASELINE_THEMES.has(theme)) {
    await expect.soft(page).toHaveScreenshot(`${name}.png`, { fullPage: true, mask });
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, mask });
  const result = await allOptical(page, width);
  if (width === 1440 || width === 320) {
    const spacing = await textSpacing(page);
    result.findings.push(...spacing.findings);
    result.skipped.push(...spacing.skipped);
  }
  await info.attach(`optical-${name}`, { body: JSON.stringify(result.findings, null, 1), contentType: 'application/json' });
  await info.attach(`skipped-${name}`, { body: JSON.stringify(result.skipped, null, 1), contentType: 'application/json' });
  expect.soft(result.skipped, '判定不能・打切りは未完了です。個別評価が必要です。').toEqual([]);
  return result;
}
