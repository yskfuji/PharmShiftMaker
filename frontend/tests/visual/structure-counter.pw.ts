import { expect, test, type Page } from '@playwright/test';

import { reflow } from './lib/optical';
import { FAILURE_CHECKS, structure, type Structure } from './lib/structure';

/*
 * Counterexamples for lib/structure.ts. For every check that fails a test: one page that has
 * the defect and must be reported, and the corrected page that must not be. Then the markup
 * the workspace is designed to have, which must pass whole. The pages are written here with
 * the workspace's class names and inline styles, so they need neither Storybook nor the
 * application's stylesheet: what is judged is the computed result, whatever produced it.
 */

const BASE = 'box-sizing:border-box;margin:0;';
const TEXT = 'font:16px/1.7 sans-serif;color:rgb(23,32,42);';
const MUTED = 'color:rgb(86,97,110);';
const SM = 'font-size:14px;';
const XS = 'font-size:12px;';
const PANEL = `${BASE}padding:20px;border:1px solid rgb(214,221,228);border-radius:16px;background:rgb(255,255,255);`;
const BUTTON = `${BASE}display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:9px 14px;border-radius:10px;font:inherit;font-weight:680;`;
const SECONDARY = `${BUTTON}border:1px solid rgb(120,130,140);color:rgb(23,32,42);background:rgb(255,255,255);text-decoration:none;`;
const PRIMARY = `${BUTTON}border:1px solid rgb(14,111,105);color:rgb(255,255,255);background:rgb(14,111,105);`;
const PILL = `${BASE}display:inline-flex;padding:4px 9px;border:1px solid rgb(214,221,228);border-radius:999px;background:rgb(240,243,246);font-weight:680;line-height:1.3;`;
const H2 = `${BASE}margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgb(214,221,228);font-size:19px;font-weight:700;`;
const H3 = `${BASE}margin-bottom:8px;font-size:16px;font-weight:700;`;
const LINK = 'color:rgb(10,105,96);text-decoration:underline;text-underline-offset:3px;';
const WRAP = `${BASE}overflow-x:auto;margin:8px 0 16px;border:1px solid rgb(214,221,228);border-radius:10px;background:rgb(255,255,255);`;
const TABLE = `${BASE}width:100%;min-width:34rem;border-collapse:collapse;${SM}`;
const CELL = `${BASE}min-width:7em;padding:9.6px 12px;border-top:1px solid rgb(214,221,228);text-align:left;`;
const TH = `${CELL}border-top:0;border-bottom:1px solid rgb(120,130,140);background:rgb(240,243,246);font-weight:600;white-space:nowrap;`;

/** The frame of a workspace route: chrome above, the route's content in one panel. */
const frame = (content: string, chrome = '') => `<!doctype html><html lang="ja"><body style="${BASE}${TEXT}background:rgb(246,248,250)">
  <div class="ideal-v3-app" style="--ideal-teal-text: 10 105 96;"><main class="ideal-v3-main" style="${BASE}padding:16px">
    <header class="ideal-v3-page-head"><h1 style="${BASE}font-size:28px;font-weight:700">職員</h1>${chrome}</header>
    <div class="ideal-v3-content" style="${BASE}margin-top:16px"><section class="ideal-panel" style="${PANEL}">${content}</section></div>
  </main></div></body></html>`;

async function judge(page: Page, html: string, width = 1440): Promise<Structure> {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(html);
  return structure(page, width);
}
const checks = (result: Structure) => [...new Set(result.findings.map((finding) => finding.check))];
const advised = (result: Structure) => [...new Set(result.advisories.map((advisory) => advisory.check))];
const table = (wrap: string, head: string, label: string, rows = [['高橋 葵', '日勤', '2026-10-12 08:30']]) =>
  `<div class="ideal-table-wrap" role="region" aria-label="${label}" tabindex="0" style="${wrap}"><table class="ideal-table" style="${TABLE}">
    <thead><tr>${['職員', '勤務', '開始'].map((name) => `<th scope="col" style="${head}">${name}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr><th scope="row" style="${CELL}position:sticky;left:0;font-weight:600;background:rgb(255,255,255)">${row[0]}</th>${row.slice(1).map((cell) => `<td style="${CELL}">${cell}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;

// The lifecycle checklist as it was: a grid of `1.7rem 1fr` whose third child, the button, is
// placed into the 1.7rem column of a second row.
const checklist = (columns: string, button: string) => `<ul class="ideal-task-list" style="${BASE}padding:0;list-style:none">
  <li style="${BASE}display:grid;grid-template-columns:${columns};gap:11px;padding:11px 0;border-top:1px solid rgb(214,221,228)">
    <span style="${BASE}display:grid;place-items:center;width:26px;height:26px;border:1px solid rgb(120,130,140);border-radius:50%">・</span>
    <span><strong style="display:block;${SM}">休暇残高の確認</strong><small style="display:block;${XS}">未完了</small></span>
    <button type="button" class="ideal-button ideal-button--secondary" style="${SECONDARY}${button}">確認を記録</button>
  </li></ul>`;

test('every failing check has a counterexample here', () => {
  expect([...COVERED].sort()).toEqual([...FAILURE_CHECKS].sort());
});
const COVERED = new Set<string>();
const counterexample = (check: (typeof FAILURE_CHECKS)[number], title: string, body: (fixtures: { page: Page }) => Promise<void>) => { COVERED.add(check); test(`${check}: ${title}`, body); };

counterexample('squeezed-label', 'a button in a 1.7rem grid column, one character per line', async ({ page }) => {
  for (const width of [1440, 320]) {
    const broken = await judge(page, frame(checklist('1.7rem 1fr', '')), width);
    expect(checks(broken)).toEqual(['squeezed-label']);
    expect(broken.findings[0]).toMatchObject({ text: '確認を記録' });
    expect(broken.findings[0].detail).toMatch(/5 characters on 5 lines \(1\.0 per line\)/);
    expect(broken.findings[0].selector).toContain('button.ideal-button.ideal-button--secondary');
    expect(checks(await judge(page, frame(checklist('1.7rem minmax(0,1fr) auto', 'white-space:nowrap;')), width))).toEqual([]);
  }
});

test('squeezed-label: a header cell and a pill are judged as a button is; a label on two lines is not', async ({ page }) => {
  const head = (width: string) => `<table style="${BASE}border:1px solid rgb(120,130,140);border-collapse:collapse;table-layout:fixed;width:200px;${SM}"><thead><tr>
    <th style="${BASE}width:${width};padding:4px;font-weight:600;background:rgb(240,243,246);text-align:left">保存期間の起算</th><th style="${BASE}font-weight:600;background:rgb(240,243,246)">区分</th></tr></thead>
    <tbody><tr><td style="${BASE}padding:4px">—</td><td style="${BASE}padding:4px">雇用</td></tr></tbody></table>`;
  const narrow = await judge(page, frame(head('36px')));
  expect(narrow.findings.map((finding) => [finding.check, finding.text])).toEqual([['squeezed-label', '保存期間の起算']]);
  expect(checks(await judge(page, frame(head('120px'))))).toEqual([]);
  // 「区/分」: two characters, one per line.
  const pair = await judge(page, frame(`<span class="ideal-pill" style="${PILL}${XS}width:30px;padding:4px 8px">区分</span>`));
  expect(pair.findings.map((finding) => [finding.check, finding.text])).toEqual([['squeezed-label', '区分']]);
  // A long label on two lines at phone width: recorded, not failed. A name broken at its space is nothing.
  const long = await judge(page, frame(`<button type="button" class="ideal-button ideal-button--primary" style="${PRIMARY}min-width:8em">原本と保存済み実績を照合して記録する</button>
    <p style="${BASE}${SM}width:3em">高橋 葵</p>`), 320);
  expect(checks(long)).toEqual([]);
  expect(long.advisories.map((advisory) => [advisory.check, advisory.text])).toEqual([['wrapped-label', '原本と保存済み実績を照合して記録する']]);
  // The same wrap in a button narrower than 6em is squeezed, however few its lines.
  const stub = await judge(page, frame(`<button type="button" class="ideal-button ideal-button--primary" style="${PRIMARY}width:78px">記録する</button>`));
  expect(stub.findings.map((finding) => [finding.check, finding.detail])).toEqual([['squeezed-label', 'label on 2 lines in a button 78px wide < 6em (96px)']]);
});

counterexample('squeezed-text', 'a value in a column three characters wide', async ({ page }) => {
  const list = (row: string) => `<dl class="ideal-definition-list" style="${BASE}"><div style="${BASE}${row}padding:12px 0;border-top:1px solid rgb(214,221,228)">
    <dt style="${BASE}${MUTED}font-weight:600">本人アカウント</dt><dd style="${BASE}overflow-wrap:anywhere">システム管理者・有効（版1）</dd></div></dl>`;
  const broken = await judge(page, frame(`<div style="width:228px">${list('display:grid;grid-template-columns:10rem 1fr;gap:1rem;')}</div>`), 320);
  expect(broken.findings.map((finding) => [finding.check, finding.text])).toEqual([['squeezed-text', 'システム管理者・有効（版1）']]);
  expect(checks(await judge(page, frame(`<div style="width:228px">${list('display:grid;gap:2px;')}</div>`), 320))).toEqual([]);
  // Vertical writing is a choice, not a squeeze.
  expect(checks(await judge(page, frame(`<p style="${BASE}writing-mode:vertical-rl;height:3em">縦書きの見出しです</p>`)))).toEqual([]);
});

counterexample('bare-heading', 'a heading at the weight of the text around it', async ({ page }) => {
  const section = (weight: number, extra = '') => `<h2 style="${BASE}font-size:18.56px;font-weight:${weight};margin:2.4px 0">現在の状態</h2><p style="${BASE}${SM}">登録済みの実績を表示します。</p>${extra}`;
  const broken = await judge(page, frame(section(400)));
  expect(broken.findings.map((finding) => [finding.check, finding.text])).toEqual([['bare-heading', '現在の状態']]);
  expect(broken.findings[0].detail).toMatch(/font-weight 400 < 600 at 18\.56px/);
  expect(checks(await judge(page, frame(section(700))))).toEqual([]);
  // In a closed task the heading is not rendered and is not judged; opened, it is.
  const task = (open: string) => section(700, `<details class="ideal-v3-disclosure" ${open} style="${BASE}border:1px solid rgb(214,221,228)"><summary style="${BASE}padding:12px;font-weight:720">本人アカウントを紐付ける</summary>
    <h3 style="${BASE}font-size:15px;font-weight:400">アカウントを紐付ける</h3></details>`);
  expect(checks(await judge(page, frame(task(''))))).toEqual([]);
  expect((await judge(page, frame(task('open')))).findings.map((finding) => [finding.check, finding.text])).toEqual([['bare-heading', 'アカウントを紐付ける']]);
  // The frame's own h1 is the chrome: recorded until the chrome is tokenised.
  const chrome = await judge(page, frame(section(700)).replace('font-size:28px;font-weight:700', 'font-size:28px;font-weight:400'));
  expect(checks(chrome)).toEqual([]);
  expect(chrome.advisories.filter((advisory) => advisory.check === 'bare-heading').map((advisory) => [advisory.text, advisory.detail])).toEqual([['職員', 'font-weight 400 < 600 at 28px (parent 16px); in the chrome']]);
});

counterexample('bare-table', 'no frame and no header fill; two regions that touch', async ({ page }) => {
  const plain = `${BASE}overflow-x:auto;margin-top:9.6px;`;
  const plainHead = `${CELL}${MUTED}font-weight:600;`;
  const broken = await judge(page, frame(`<h3 style="${H3}">年休の残高と取得義務</h3>${table(plain, plainHead, '年休残高')}${table(plain, plainHead, '年5日の取得管理')}`));
  expect(broken.findings.map((finding) => [finding.check, finding.text])).toEqual([['bare-table', '年休残高'], ['bare-table', '年5日の取得管理']]);
  expect(broken.findings[0].detail).toMatch(/no frame \(0 bordered sides\) and header fill equals row fill/);
  expect(checks(await judge(page, frame(`<h3 style="${H3}">年休の残高と取得義務</h3>${table(WRAP, TH, '年休残高')}${table(WRAP, TH, '年5日の取得管理')}`)))).toEqual([]);
  // Framed, but set against each other: they read as one table again.
  const touching = await judge(page, frame(`${table(`${WRAP}margin:0`, TH, '年休残高')}${table(`${WRAP}margin:3px 0 0`, TH, '年5日の取得管理')}`));
  expect(touching.findings.map((finding) => [finding.check, finding.text])).toEqual([['bare-table', '年5日の取得管理']]);
  expect(touching.findings[0].detail).toMatch(/3\.0px below the previous table region < 8px/);
});

counterexample('bare-list', 'items that are only stacked text', async ({ page }) => {
  const list = (style: string, item = '') => `<ul class="ideal-note-list" style="${BASE}padding-left:17.6px;${XS}${MUTED}${style}">
    <li style="${BASE}${item}">高橋 葵：保全中（第1版）。理由：係争中の記録の保全</li><li style="${BASE}${item}">鈴木 悠斗：解除済み（第2版）</li></ul>`;
  const broken = await judge(page, frame(list('list-style:none;')));
  expect(broken.findings.map((finding) => finding.check)).toEqual(['bare-list']);
  expect(broken.findings[0].selector).toContain('ul.ideal-note-list');
  expect(checks(await judge(page, frame(list('list-style:disc;'))))).toEqual([]);
  // A list of rows needs no marker: each item has a rule and room of its own.
  expect(checks(await judge(page, frame(list('list-style:none;padding:0;', 'padding:8px 0;border-top:1px solid rgb(214,221,228);'))))).toEqual([]);
  // One item is a sentence, not a list.
  expect(checks(await judge(page, frame(`<ul style="${BASE}padding:0;list-style:none;${XS}"><li>登録されている記録はありません。</li></ul>`)))).toEqual([]);
});

counterexample('bare-definition-list', 'terms and values that look the same', async ({ page }) => {
  const list = (term: string) => `<dl class="ideal-definition-list" style="${BASE}${SM}">${[['制御ハッシュ', 'synthetic-manifest-sha256'], ['説明', '隔離復旧演習で消去制御を再適用しました。']]
    .map(([dt, dd]) => `<div style="${BASE}display:grid;grid-template-columns:10rem 1fr;gap:16px;padding:8px 0;border-top:1px solid rgb(214,221,228)"><dt style="${BASE}${term}">${dt}</dt><dd style="${BASE}">${dd}</dd></div>`).join('')}</dl>`;
  const broken = await judge(page, frame(list('')));
  expect(broken.findings.map((finding) => finding.check)).toEqual(['bare-definition-list']);
  expect(broken.findings[0].detail).toMatch(/2 terms and values equal in colour .* weight \(400\) and size \(14px\)/);
  expect(checks(await judge(page, frame(list(`${MUTED}font-weight:600;`))))).toEqual([]);
});

counterexample('variantless-button', 'a workspace button with neither fill nor border', async ({ page }) => {
  const actions = (danger: string) => `<div class="ideal-actions" style="${BASE}display:flex;gap:10px"><button type="button" class="ideal-button ideal-button--secondary" style="${SECONDARY}">この公開版を出力</button>
    <button type="button" class="ideal-button ideal-button--danger" style="${BUTTON}${danger}">公開を取り消す</button></div>`;
  const broken = await judge(page, frame(actions('border:0;background:transparent;')));
  expect(broken.findings.map((finding) => [finding.check, finding.text])).toEqual([['variantless-button', '公開を取り消す']]);
  expect(broken.findings[0].detail).toContain('ideal-button ideal-button--danger');
  expect(checks(await judge(page, frame(actions('border:1px solid rgb(180,35,24);color:rgb(180,35,24);background:rgb(254,243,242);'))))).toEqual([]);
  // A button of no class that is only text is bare too; one that is a row of a list is not.
  const bare = await judge(page, frame(`<button type="button" style="${BASE}padding:0;border:0;background:transparent;font:inherit;color:inherit">やめる</button>
    <button type="button" style="${BASE}display:grid;width:100%;padding:9px;border:1px solid transparent;background:transparent;font:inherit;color:inherit;text-align:left"><strong>佐藤 美咲</strong></button>`));
  expect(bare.findings.map((finding) => [finding.check, finding.text])).toEqual([['variantless-button', 'やめる']]);
});

counterexample('text-floor', 'text under 12px in the content', async ({ page }) => {
  const head = (size: string) => `<span class="ideal-eyebrow" style="${BASE}display:block;font-size:${size};font-weight:720">入職・退職</span><h2 style="${H2}">手続きのケース</h2>
    <span class="ideal-pill ideal-pill--info" style="${PILL}font-size:${size}">入職</span> <span style="font-size:${size}">✓</span>`;
  const broken = await judge(page, frame(head('11.04px')));
  expect(broken.findings.map((finding) => [finding.check, finding.text])).toEqual([['text-floor', '入職・退職'], ['text-floor', '入職']]);   // the mark ✓ is not reading text
  expect(broken.findings[0].detail).toMatch(/^11\.04px < 12px/);
  expect(checks(await judge(page, frame(head('12px'))))).toEqual([]);
  // The chrome is recorded, not failed, until its sizes are tokenised; so is the timetable's dense grid.
  const elsewhere = await judge(page, frame(`<table class="ideal-schedule-table" style="${BASE}border:1px solid rgb(120,130,140)"><tbody><tr><td><span style="font-size:9.44px">日勤</span></td></tr></tbody></table>`,
    `<small style="font-size:10.24px">勤務計画・運用支援</small>`));
  expect(checks(elsewhere)).toEqual([]);
  expect(elsewhere.advisories.map((advisory) => [advisory.check, advisory.detail])).toEqual([['text-floor', '10.24px < 12px; in the chrome'], ['text-floor', '9.44px < 12px; in the timetable']]);
});

counterexample('link-colour', 'a link that is not the workspace link colour', async ({ page }) => {
  const links = (colour: string) => `<p style="${BASE}${SM}">希望休・年休の申請は、<a class="ideal-inline-link" href="#leave" style="${LINK}">休暇の画面</a>で行います。</p>
    <nav aria-label="選択職員の詳細" style="display:flex;gap:8px">${['本人アカウント', '契約・資格'].map((name) => `<a href="#${name}" style="${BASE}display:inline-flex;align-items:center;min-height:44px;padding:7px 10px;border:1px solid rgb(214,221,228);border-radius:10px;color:${colour};text-decoration:none">${name}</a>`).join('')}</nav>`;
  const broken = await judge(page, frame(links('rgb(0,49,216)')));
  expect(broken.findings.map((finding) => [finding.check, finding.text])).toEqual([['link-colour', '本人アカウント'], ['link-colour', '契約・資格']]);
  expect(broken.findings[0].detail).toBe('rgb(0, 49, 216) is not the link colour rgb(10, 105, 96) (--ideal-teal-text)');
  expect(checks(await judge(page, frame(links('rgb(10,105,96)'))))).toEqual([]);
  // Without the token the page's own majority decides; a link styled as a button and a link
  // that is a whole row are not text links.
  const untokened = frame(`${links('rgb(10,105,96)')}<a class="ideal-link" href="#audit" style="color:rgb(0,49,216)">監査の履歴を開く</a>
    <a class="ideal-button ideal-button--secondary" href="#contracts" style="${SECONDARY}">契約・資格</a>
    <a href="#case" style="display:block;color:inherit;text-decoration:none"><strong>勤務交換</strong><small style="display:block;${XS}">同意待ち</small></a>`).replace('--ideal-teal-text: 10 105 96;', '');
  const mixed = await judge(page, untokened);
  expect(mixed.findings.map((finding) => [finding.check, finding.text, finding.detail])).toEqual([['link-colour', '監査の履歴を開く', 'rgb(0, 49, 216) is not the link colour rgb(10, 105, 96) (the colour of most links here)']]);
});

counterexample('machine-value', 'a date, a state or a role as the server wrote it', async ({ page }) => {
  const row = (when: string, state: string, role: string) => `<ul class="ideal-record-list" style="${BASE}padding:0;list-style:none;${SM}">
    <li style="${BASE}padding:8px 0;border-top:1px solid rgb(214,221,228)"><strong>勤務交換 · ${state}</strong> <small style="${XS}">版 2 · ${when}</small></li>
    <li style="${BASE}padding:8px 0;border-top:1px solid rgb(214,221,228)">計画・公開・${role}・関係した人 3名</li></ul>`;
  const broken = await judge(page, frame(row('2026-10-12T08:30:00+09:00', 'AWAITING_CONSENT', 'LEADER')));
  expect(broken.findings.map((finding) => [finding.check, finding.detail])).toEqual([
    ['machine-value', 'enumeration value: AWAITING_CONSENT'],
    ['machine-value', 'ISO 8601 date and time: 2026-10-12T08:30:00+09:00'],
    ['machine-value', 'enumeration value: LEADER'],
  ]);
  expect(checks(await judge(page, frame(row('10月12日（月）08:30', '同意待ち', '部署管理者'))))).toEqual([]);
  // What is allowed: the formats of the record tables, a time of day, identifiers shown on purpose
  // (code, the information reveals), what a person typed into a field, and words that are not states.
  const allowed = await judge(page, frame(`<p style="${BASE}${SM}">2026-10-12 08:30 から 2026-10-13 まで・日勤 08:30–17:30・PDF と CSV・参照 SYNTHETIC-2</p>
    <p style="${BASE}${SM}">記録種別 <code>schedule.published</code>・状態 <code>AWAITING_CONSENT</code>・<code>2026-10-12T08:30:00+09:00</code></p>
    <details class="ideal-v3-disclosure ideal-v3-disclosure--info" open><summary style="${SM}${LINK}">識別情報</summary><p style="${BASE}${SM}">READY・2026-10-12T08:30:00+09:00・synthetic-employment-1</p></details>
    <label style="${SM}">理由<input class="ideal-input" value="2026-10-12T08:30:00+09:00 ADMIN" style="${BASE}border:1px solid rgb(120,130,140)"></label>
    <label style="${SM}">取込<textarea style="${BASE}border:1px solid rgb(120,130,140)">LEADER</textarea></label>`));
  expect(checks(allowed)).toEqual([]);
  expect(advised(allowed)).toEqual([]);
  // The implementation's own word in a sentence for the user.
  const wording = await judge(page, frame(`<p style="${BASE}${SM}">以前の版は、APIが返さないため表示できません。</p>`));
  expect(wording.findings.map((finding) => [finding.check, finding.detail])).toEqual([['machine-value', 'wording of the implementation: API']]);
  expect(checks(await judge(page, frame(`<p style="${BASE}${SM}">以前の版はこの画面には表示されません。監査の履歴で確認できます。</p>`)))).toEqual([]);
  // What a person typed, shown back to them: a finding as plain text (the detector cannot know
  // who wrote it), and not judged in an element marked `data-verbatim`. The mark covers its own
  // element only: the same words beside it are still findings.
  const history = (mark: string) => `<ul class="ideal-record-list" style="${BASE}padding:0;list-style:none;${SM}">
    <li style="${BASE}padding:8px 0;border-top:1px solid rgb(214,221,228)"><strong>第2版 本人確認済み</strong> <span${mark}>理由：合成判断 VERIFIED（API）・参照：AWAITING_CONSENT 2026-10-12T08:30:00+09:00</span></li>
    <li style="${BASE}padding:8px 0;border-top:1px solid rgb(214,221,228)">状態 APPROVED</li></ul>`;
  const typed = await judge(page, frame(history('')));
  expect(typed.findings.map((finding) => [finding.check, finding.detail])).toEqual([
    ['machine-value', 'ISO 8601 date and time: 2026-10-12T08:30:00+09:00'],
    ['machine-value', 'enumeration value: AWAITING_CONSENT'],
    ['machine-value', 'enumeration value: VERIFIED'],
    ['machine-value', 'wording of the implementation: API'],
    ['machine-value', 'enumeration value: APPROVED'],
  ]);
  const marked = await judge(page, frame(history(' data-verbatim')));
  expect(marked.findings.map((finding) => [finding.check, finding.detail])).toEqual([['machine-value', 'enumeration value: APPROVED']]);
  expect(marked.advisories.filter((advisory) => advisory.check === 'machine-value')).toEqual([]);
  // The mark excuses the words only: typed text below the floor of the scale is still a finding.
  const small = await judge(page, frame(`<p style="${BASE}${SM}">理由：<span data-verbatim style="font-size:10px">合成判断 VERIFIED（API）</span></p>`));
  expect(small.findings.map((finding) => [finding.check, finding.text])).toEqual([['text-floor', '合成判断 VERIFIED（API）']]);
  // What is only recorded: an event kind outside code, and a capital word the list does not know.
  const unsure = await judge(page, frame(`<p style="${BASE}${SM}">記録種別 schedule.published・区分 ESCALATED</p>`));
  expect(checks(unsure)).toEqual([]);
  expect(unsure.advisories.map((advisory) => advisory.detail)).toEqual(['capital word that may be an enumeration value: ESCALATED', 'event kind: schedule.published']);
});

test('measurements whose limit is a matter of design are advisories and metrics, never findings', async ({ page }) => {
  const box = `${BASE}padding:12px;border:1px solid rgb(214,221,228);border-radius:10px;`;
  const result = await judge(page, frame(`<h2 style="${BASE}font-size:19px;font-weight:700">現在の状態</h2><p style="${BASE}">サーバーが返したあなたの権限：部署管理者。この内容は現在の版です。</p>
    <p class="ideal-note" style="${BASE}${XS}">この画面が受け取るのは現在の版だけです。過去の版は監査の履歴で確認できます。</p>
    <div style="${box}"><div style="${box}"><div style="${box}"><p style="${BASE}${SM}">入れ子の面</p></div></div></div>
    <div style="height:3000px"></div>`));
  expect(checks(result)).toEqual([]);
  expect(advised(result).sort()).toEqual(['heading-touches-content', 'page-length', 'planes', 'text-outliers']);
  expect(result.metrics).toMatchObject({ width: 1440, 'viewport-height': 900, headings: 2, tables: 0, 'advisories-planes': 1 });
  expect(result.metrics['page-length']).toBeGreaterThan(3);
  const phone = await judge(page, frame(`<h2 style="${H2}">現在の状態</h2><p style="${BASE}${SM}">内容</p>`, '<div style="height:500px"></div>'), 320);
  expect(checks(phone)).toEqual([]);
  expect(advised(phone)).toEqual(['content-start']);
  expect(phone.metrics['content-start']).toBeGreaterThan(420);
});

test('nothing is judged outside the workspace frame', async ({ page }) => {
  await page.setContent(`<main><h2 style="font-weight:400">現在の状態</h2><button class="ideal-button">公開を取り消す</button><p>AWAITING_CONSENT</p></main>`);
  expect(await structure(page, 1440)).toEqual({ findings: [], advisories: [], metrics: {} });
});

// The markup the repair is designed to produce (the design's section A): a task with its hint
// and tag beside the <details>, an information reveal, framed tables with a sticky row header,
// a callout, secondary link-buttons, one link colour, the five-step type scale.
const designed = `
  <span class="ideal-eyebrow" style="${BASE}display:block;${XS}font-weight:720;color:rgb(10,105,96)">個人情報</span>
  <h2 style="${H2}">次の操作</h2>
  <p style="${BASE}${SM}${MUTED}max-width:48rem">保存期間を過ぎた記録の消去は、請求の判断のあとに行います。<a class="ideal-inline-link" href="#audit" style="${LINK}">監査の履歴</a>で経過を確認できます。</p>
  <section class="ideal-note" role="alert" style="${BASE}margin:12px 0;padding:12px;border:1px solid rgb(181,110,0);border-inline-start-width:4px;border-radius:10px;${SM}">
    <h3 style="${H3}">確認が必要な点（サーバーの検証結果）</h3>
    <ul class="ideal-note-list" style="${BASE}padding-left:18px;list-style:disc"><li>未確認：雇用条件 1件が入力に含まれていません。</li><li>未確認：清算期間の終了日が未登録です。</li></ul>
  </section>
  <h3 class="ideal-v3-heading" style="${H3}">職員ごとの消去</h3>
  <div class="ideal-v3-task-list" style="${BASE}display:grid;gap:8px">
    <div class="ideal-v3-task ideal-v3-task--routine" style="${BASE}min-width:0;border:1px solid rgb(214,221,228);border-radius:10px">
      <details class="ideal-v3-disclosure" style="${BASE}"><summary aria-describedby="hint-1" style="${BASE}padding:12px 16px;font-weight:700">請求を判断する</summary>
        <div role="group" aria-label="請求を判断する"><h3 style="${H3}">判断の内容</h3></div></details>
      <p id="hint-1" class="ideal-v3-task__hint" style="${BASE}padding:0 16px 12px;${SM}${MUTED}">受け付けた請求に、開示・訂正・消去の判断を記録します。</p>
    </div>
    <div class="ideal-v3-task ideal-v3-task--danger" style="${BASE}min-width:0;border:1px solid rgb(180,35,24);border-radius:10px">
      <details class="ideal-v3-disclosure" open style="${BASE}"><summary aria-describedby="hint-2" style="${BASE}padding:12px 16px;border-bottom:1px solid rgb(214,221,228);background:rgb(240,243,246);font-weight:700">人物制御後の消去計画を作成し、実行可能分を消去する</summary>
        <div role="group" aria-label="人物制御後の消去計画を作成し、実行可能分を消去する" style="${BASE}padding:12px 16px">
          <h3 class="ideal-v3-heading" style="${H3}">1. 対象を選ぶ</h3>
          <label class="ideal-field-label" style="display:block;${SM}font-weight:600;margin-bottom:4px" for="who">職員を検索</label>
          <input id="who" class="ideal-input" value="高橋" style="${BASE}min-height:44px;padding:8px;border:1px solid rgb(120,130,140);border-radius:10px;font:inherit">
          <dl class="ideal-definition-list" style="${BASE}margin-top:12px;${SM}">
            <div style="${BASE}display:grid;grid-template-columns:minmax(8rem,14rem) minmax(0,1fr);gap:16px;padding:8px 0;border-top:1px solid rgb(214,221,228)"><dt style="${BASE}${MUTED}font-weight:600">対象</dt><dd style="${BASE}">高橋 葵・2026-10-12 08:30 時点の第3版</dd></div>
            <div style="${BASE}display:grid;grid-template-columns:minmax(8rem,14rem) minmax(0,1fr);gap:16px;padding:8px 0;border-top:1px solid rgb(214,221,228)"><dt style="${BASE}${MUTED}font-weight:600">通知</dt><dd style="${BASE}"><ul style="${BASE}padding-left:18px;list-style:disc"><li>部署管理者</li><li>本人</li></ul></dd></div>
          </dl>
          ${table(WRAP, TH, 'サーバーが消去できると答えた勤務入力', [['高橋 葵', '日勤', '2026-10-12 08:30'], ['鈴木 悠斗', '遅番', '2026-10-12 10:30']])}
          ${table(WRAP, TH, '消去できない勤務入力', [['佐藤 美咲', '日勤', '2026-10-13 08:30']])}
          <details class="ideal-v3-disclosure ideal-v3-disclosure--info" open style="${BASE}"><summary style="${BASE}${SM}${LINK}">識別情報</summary>
            <p class="ideal-note" style="${BASE}${SM}${MUTED}">職員の識別子 synthetic-person-1・状態 AWAITING_CONSENT・登録 2026-10-12T08:30:00+09:00</p></details>
          <div class="ideal-actions" style="${BASE}display:flex;flex-wrap:wrap;gap:10px;margin-top:16px">
            <button type="button" class="ideal-button ideal-button--danger" style="${BUTTON}border:1px solid rgb(180,35,24);color:rgb(255,255,255);background:rgb(180,35,24)">消去計画の作成内容を確認する</button>
            <button type="button" class="ideal-button ideal-button--secondary" disabled style="${SECONDARY}border-style:dashed;background:rgb(240,243,246);color:rgb(86,97,110)">やめる</button>
          </div>
        </div></details>
      <p id="hint-2" class="ideal-v3-task__hint" style="${BASE}padding:8px 16px 12px;${SM}${MUTED}"><span class="ideal-pill ideal-pill--danger" style="${PILL}${XS}border-color:rgb(180,35,24);color:rgb(180,35,24)">消去は取り消せません</span> 職員を選び、消去できる記録だけを消去します。</p>
    </div>
  </div>
  <nav aria-label="選択職員の詳細" style="${BASE}display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">
    <a class="ideal-button ideal-button--secondary" href="#memberships" style="${SECONDARY}">本人アカウント</a><a class="ideal-button ideal-button--secondary" href="#contracts" style="${SECONDARY}">契約・資格</a>
  </nav>`;

for (const width of [1440, 768, 320]) {
  test(`the designed markup has no finding at ${width}px`, async ({ page }) => {
    const result = await judge(page, frame(designed), width);
    expect(result.findings).toEqual([]);
    // At phone width a long label may take two lines: recorded, never failed.
    expect(advised(result).filter((check) => !['wrapped-label', 'narrow-text'].includes(check))).toEqual([]);
    expect(result.metrics).toMatchObject({ tables: 2, details: 3, 'details-open': 2 });
  });
}

// The design moves a task's frame from the <details> to a wrapper beside its hint. The wrapper
// is then the grid item that holds a table 34rem wide, and a grid item is as wide as its
// content at least unless it says otherwise. globals.css says so for the <details>
// (`.ideal-v3-content .ideal-v3-disclosure { min-width: 0 }`); the wrapper has to as well.
test('a task wrapper without min-width: 0 widens the page at 320px', async ({ page }) => {
  const stack = (wrapper: string) => frame(`<div class="ideal-stack" style="${BASE}display:grid;gap:16px">
    <div class="ideal-v3-task ideal-v3-task--routine" style="${BASE}${wrapper}border:1px solid rgb(214,221,228);border-radius:10px">
      <details class="ideal-v3-disclosure" open style="${BASE}min-width:0"><summary style="${BASE}padding:12px 16px;font-weight:700">勤務案の割当を確認する</summary>
        ${table(WRAP, TH, '勤務案の割当')}</details>
      <p class="ideal-v3-task__hint" style="${BASE}padding:0 16px 12px;${SM}${MUTED}">割当を確認し、必要なら訂正します。</p>
    </div></div>`);
  await judge(page, stack(''), 320);
  expect((await reflow(page)).findings.map((finding) => finding.check)).toEqual(['reflow']);
  const kept = await judge(page, stack('min-width:0;'), 320);
  expect((await reflow(page)).findings).toEqual([]);
  expect(kept.findings).toEqual([]);
});
