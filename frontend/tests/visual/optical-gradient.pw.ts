import { expect, test } from '@playwright/test';

import { focusIndicators, nonText, textContrast } from './lib/optical';

// Counterexamples for the worst-case gradient judgement in lib/optical.ts.
test('text over a colour-only gradient is judged at its least favourable colour', async ({ page }) => {
  await page.setContent('<div style="background:linear-gradient(90deg,#fff,#111);padding:20px"><p style="color:#fff;margin:0">白い文字</p></div>');
  const low = await textContrast(page);
  expect(low.skipped).toEqual([]);
  expect(low.findings.map((f) => f.text)).toContain('白い文字');
  await page.setContent('<div style="background:linear-gradient(90deg,#000,#222);padding:20px"><p style="color:#fff;margin:0">白い文字</p></div>');
  const high = await textContrast(page);
  expect(high.skipped).toEqual([]);
  expect(high.findings).toEqual([]);
});

test('a transparent stop shows the backdrop below it', async ({ page }) => {
  await page.setContent('<div style="background:#fff"><div style="background:linear-gradient(90deg,transparent,#000);padding:20px"><p style="color:#fff;margin:0">白い文字</p></div></div>');
  expect((await textContrast(page)).findings.map((f) => f.text)).toContain('白い文字');
});

test('text over an image is still reported as not judgeable', async ({ page }) => {
  await page.setContent('<div style="background-image:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=);padding:20px"><p style="margin:0">画像の上</p></div>');
  const result = await textContrast(page);
  expect(result.skipped.map((s) => s.detail)).toEqual(['image behind the text']);
});

test('a control and a focus ring on a gradient are judged against its worst colour', async ({ page }) => {
  await page.setContent('<div style="background:linear-gradient(#fff,#777);padding:30px"><input aria-label="入力" style="border:1px solid #ddd;background:transparent"><button style="outline:2px solid #bbb;outline-offset:2px">ボタン</button></div><style>button:focus-visible{outline:2px solid #bbb}</style>');
  const boundary = await nonText(page);
  expect(boundary.findings.map((f) => f.check)).toContain('control-boundary');
  const focus = await focusIndicators(page, 5);
  expect(focus.findings.some((f) => f.detail.includes('indicator ratio'))).toBe(true);
});

test('an infinite animation does not stop the focus traversal', async ({ page }) => {
  await page.setContent('<style>@keyframes s{to{opacity:.5}} .x{animation:s 1s infinite}</style><div class="x">読込中</div><button>A</button><button>B</button>');
  const result = await focusIndicators(page, 10);
  expect(result.skipped).toEqual([]);
});

test('a gradient in another colour space is not judgeable, never silently passed', async ({ page }) => {
  await page.setContent('<div style="background:linear-gradient(90deg,oklch(1 0 0),oklch(0.2 0 0));padding:20px"><p style="color:#fff;margin:0">白い文字</p></div>');
  const result = await textContrast(page);
  expect(result.findings).toEqual([]);
  expect(result.skipped.map((s) => s.text)).toContain('白い文字');
});

test('a focus ring over an image is not judgeable, not judged against white', async ({ page }) => {
  await page.setContent('<div style="background-image:url(data:image/gif;base64,R0lGODlhAQABAAAAACw=);padding:30px"><button>画像の上</button></div>');
  const result = await focusIndicators(page, 5);
  expect(result.skipped.map((s) => s.detail)).toContain('background not measurable');
});
