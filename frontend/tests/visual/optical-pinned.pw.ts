import { expect, test, type Page } from '@playwright/test';

import { textContrast } from './lib/optical';

/*
 * Counterexamples for the one covering lib/optical.ts does not report as `skipped`: a cell
 * of a scrolled table under a `position: sticky` cell of the same table. Each page is
 * written here with inline styles, so it needs neither Storybook nor the application's
 * stylesheet. The faint text (ratio about 1.2 on white) is what proves a judgement: where
 * the text shows it must be a finding, and where it is under the pinned cell it must be
 * neither a finding nor skipped. Every other covering must stay `skipped`, as before.
 */
const CELL = 'box-sizing:border-box;min-width:160px;padding:10px 12px;border-top:1px solid rgb(214,221,228);text-align:left;white-space:nowrap;background:rgb(255,255,255);';
const PINNED = `${CELL}position:sticky;left:0;z-index:1;border-right:1px solid rgb(214,221,228);font-weight:600;`;
const FAINT = 'color:rgb(226,230,236)';
const COVERED = 'text covered by another element at its centre';

/** A table in a region 360px wide: a pinned row header of 160px and three more columns. The
 * second column holds the faint text. `head` pins the head row as well. */
const table = (options: { pinned?: string; head?: string; label?: string; second?: string; first?: string; /** What the first row's header holds instead of its name. */ header?: string } = {}) => `
  <div class="region" role="region" aria-label="${options.label ?? '表'}" tabindex="0" style="box-sizing:border-box;width:360px;${options.head ? 'height:120px;' : ''}overflow:auto;border:1px solid rgb(214,221,228);background:rgb(255,255,255)">
    <table style="border-collapse:separate;border-spacing:0;font:14px/1.6 sans-serif;color:rgb(23,32,42)">
      <thead><tr>${['職員', '区分', '開始', '終了'].map((name, index) => `<th scope="col" style="${index === 0 ? options.pinned ?? PINNED : CELL}${options.head ?? ''}${index === 0 && options.head ? 'z-index:2;' : ''}">${name}</th>`).join('')}</tr></thead>
      <tbody>${['高橋 葵', '鈴木 悠斗', '佐藤 美咲', '田中 蓮'].map((name, row) => `<tr><th scope="row" style="${options.pinned ?? PINNED}">${(row === 0 && options.header) || name}</th><td style="${CELL}">${(row === 0 && options.first) || options.second || `<span style="${FAINT}">淡い文字</span>`}</td><td style="${CELL}">2026-10-12 08:30</td><td style="${CELL}">2026-10-12 17:30</td></tr>`).join('')}</tbody>
    </table>
  </div>`;
const page_ = (body: string) => `<!doctype html><html lang="ja"><body style="margin:0;padding:24px;background:rgb(255,255,255)">${body}</body></html>`;

async function judge(page: Page, html: string, scroll: { left?: number; top?: number } = {}) {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.setContent(html);
  await page.locator('.region').first().evaluate((region, to) => { region.scrollLeft = to.left ?? 0; region.scrollTop = to.top ?? 0; }, scroll);
  const result = await textContrast(page);
  return { found: result.findings.map((finding) => finding.text), skipped: result.skipped.map((item) => `${item.text}: ${item.detail}`) };
}

test('a cell scrolled under the pinned row header of its table is not shown: neither judged nor skipped', async ({ page }) => {
  // Not scrolled: the faint text shows, and it is a finding.
  const shown = await judge(page, page_(table()));
  expect(shown.skipped).toEqual([]);
  expect(shown.found).toContain('淡い文字');
  // Scrolled by the width of the second column: every cell of it is under the pinned header.
  const under = await judge(page, page_(table()), { left: 160 });
  expect(under.skipped).toEqual([]);
  expect(under.found).toEqual([]);
  // The pinned cells themselves and the columns still in view are judged as ever.
  const pinnedFaint = await judge(page, page_(table({ pinned: `${PINNED}${FAINT};` })), { left: 160 });
  expect(pinnedFaint.skipped).toEqual([]);
  expect(pinnedFaint.found).toEqual(expect.arrayContaining(['職員', '高橋 葵']));
});

test('a cell half under the pinned header is judged at the part that still shows', async ({ page }) => {
  // Twenty faint characters (280px) in the second column; scrolled by 200px, the text runs
  // from left of the region to 92px past the pinned cell: the centre of what the region
  // shows of it is under the pinned cell, and its end shows beside it.
  const long = '淡い文字'.repeat(5);
  const partly = await judge(page, page_(table({ second: `<span style="${FAINT}">${long}</span>` })), { left: 200 });
  expect(partly.skipped).toEqual([]);
  expect(partly.found).toContain(long);
});

test('a row that the audit can bring back into view from under a pinned head row is judged, not excused', async ({ page }) => {
  // The audit re-centres a text it finds covered before it gives up. A row under a pinned
  // head row comes back into view that way, so the exception never applies to it: the faint
  // text of the first row, which was under the head row, is a finding.
  const head = 'position:sticky;top:0;';
  const first = `<span style="${FAINT}">先頭の行</span>`;
  const under = await judge(page, page_(table({ head, first })), { top: 44 });
  expect(under.skipped).toEqual([]);
  expect(under.found).toContain('先頭の行');
});

test('a pinned cell of another table, a sticky element that is not a cell, and any other overlay are still reported', async ({ page }) => {
  // 1. An overlay that is no cell at all, over the second column.
  const overlay = '<div style="position:absolute;left:185px;top:24px;width:160px;height:300px;background:rgb(255,255,255)"></div>';
  const covered = await judge(page, page_(`<div style="position:relative">${table()}${overlay}</div>`));
  expect(covered.found).not.toContain('淡い文字');
  expect(covered.skipped).toEqual(expect.arrayContaining([`淡い文字: ${COVERED}`]));

  // 2. A sticky element that is not a th/td (a pinned banner inside the scrolled region).
  const banner = '<div style="position:sticky;left:0;top:0;width:320px;height:0"><div style="position:absolute;left:161px;top:40px;width:160px;height:200px;background:rgb(255,255,255)"></div></div>';
  const bannered = await judge(page, page_(table().replace('<table', `${banner}<table`)));
  expect(bannered.skipped).toEqual(expect.arrayContaining([`淡い文字: ${COVERED}`]));

  // 3. The pinned cell of ANOTHER table laid over this one: not the scrolling of this table.
  const other = `<table style="position:absolute;left:185px;top:60px;border-collapse:separate;border-spacing:0"><tbody><tr><th style="${PINNED}height:220px">別の表</th></tr></tbody></table>`;
  const foreign = await judge(page, page_(`<div style="position:relative">${table()}${other}</div>`));
  expect(foreign.skipped).toEqual(expect.arrayContaining([`淡い文字: ${COVERED}`]));

  // 4. A cell of the same table that covers another without being pinned (position: relative).
  const shifted = table({ pinned: `${CELL}position:relative;left:150px;z-index:1;` });
  const moved = await judge(page, page_(shifted));
  expect(moved.skipped).toEqual(expect.arrayContaining([`淡い文字: ${COVERED}`]));
});

test('content that sticks out of a pinned cell over its neighbour is reported, scrolled or not', async ({ page }) => {
  // A long name in the pinned row header, 300px wide in a cell of 160px, painted over the
  // second column of its row. Nothing was scrolled under the pinned cell: the faint text of
  // the neighbour is covered by what overflows, and that must be said (skipped), not dropped.
  const header = '<span style="position:relative;display:inline-block;width:300px;background:rgb(255,255,255)">エリカ クリスティーナ ファンデンベルグ</span>';
  const overflow = `${PINNED}max-width:160px;overflow:visible;`;
  const still = await judge(page, page_(table({ pinned: overflow, header })));
  expect(still.skipped).toEqual(expect.arrayContaining([`淡い文字: ${COVERED}`]));
  // Scrolled a little, the overflow still lies over the third column of that row: the point
  // is outside the pinned cell's own box, so it is not "scrolled under the pinned cell".
  const faintThird = table({ pinned: overflow, header }).replace('<td style="' + CELL + '">2026-10-12 08:30</td>', `<td style="${CELL}"><span style="${FAINT}">三列目</span></td>`);
  const moved = await judge(page, page_(faintThird), { left: 100 });
  expect(moved.skipped).toEqual(expect.arrayContaining([`三列目: ${COVERED}`]));
  // The other rows of the unscrolled table are judged as ever: their faint text is a finding.
  expect(still.found).toContain('淡い文字');
});
