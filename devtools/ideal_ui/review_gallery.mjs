// One static page that puts the review screenshots of two capture sets side by side.
//
//   node devtools/ideal_ui/review_gallery.mjs --after <dir> [--before <dir>] [--review review.json] [--out <file>]
//
// <dir> is a label directory written by review_capture.mjs. The page has relative image
// paths, system fonts, no script and no external request. With only --after it shows that
// set alone. `review.json` is optional: { "<route>": { "verdict": "...", "notes": "...",
// "categories": { "BROKEN": "...", ... } } } — what a person recorded after looking.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';

const REVIEW_ROOT = '/private/tmp/pharmshift-v3-review';
const RENDERS = [
  { theme: 'light', width: 1440, title: '明るい配色・1440px' },
  { theme: 'light', width: 768, title: '明るい配色・768px' },
  { theme: 'light', width: 320, title: '明るい配色・320px' },
  { theme: 'dark', width: 1440, title: '暗い配色・1440px' },
];
const CATEGORIES = ['BROKEN', 'UNSTYLED', 'HIERARCHY', 'AFFORDANCE', 'LABEL', 'DENSITY', 'RESPONSIVE'];

function args(argv) {
  const out = { before: '', after: '', review: '', out: '' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in out) || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
    out[key] = argv[i + 1];
  }
  if (!out.after) throw new Error('--after <dir> is required');
  return out;
}

function underReviewRoot(path) {
  const full = resolve(path);
  if (!full.startsWith(REVIEW_ROOT + sep)) throw new Error(`Refusing a path outside ${REVIEW_ROOT}: ${full}`);
  for (let at = dirname(full); at !== dirname(at); at = dirname(at)) {
    if (existsSync(resolve(at, '.git'))) throw new Error(`Refusing to write inside a repository: ${at}`);
  }
  return full;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const load = (dir) => ({ dir, manifest: JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) });

function figure(set, entry, base, caption, width) {
  if (!entry) return `<figure class="missing"><figcaption>${esc(caption)}</figcaption><p>この状態の画像はありません。</p></figure>`;
  const src = esc(relative(base, resolve(set.dir, entry.image)).split(sep).join('/'));
  const facts = [`高さ ${entry.height}px`, entry.contentTop === null ? null : `内容の開始 y=${entry.contentTop}px`, entry.open ? `開いた開閉欄 ${entry.detailsOpen}/${entry.details}` : null, entry.pageWidth > entry.viewportWidth ? `横はみ出し ${entry.pageWidth}px` : null].filter(Boolean).join('・');
  const alerts = entry.alerts?.length ? `<p class="alerts">警告の表示 ${entry.alerts.length}件：${esc(entry.alerts.join(' ／ '))}</p>` : '';
  return `<figure><figcaption><strong>${esc(caption)}</strong><span>${esc(facts)}</span></figcaption>${alerts}<a href="${src}"><img loading="lazy" src="${src}" width="${entry.viewportWidth ?? width}" height="${entry.height}" alt="${esc(caption)}の画面（${esc(entry.name)}、${esc(entry.theme)}、幅${width}px${entry.open ? '、開閉欄をすべて開いた状態' : ''}）"></a></figure>`;
}

function delta(before, after) {
  if (!before || !after) return '';
  const diff = after.height - before.height;
  return `${before.height}px → ${after.height}px（${diff > 0 ? '+' : ''}${diff}px）`;
}

function build(options) {
  const out = underReviewRoot(options.out || resolve(options.after, 'index.html'));
  const base = dirname(out);
  const after = load(resolve(options.after));
  const before = options.before ? load(resolve(options.before)) : null;
  const review = options.review ? JSON.parse(readFileSync(resolve(options.review), 'utf8')) : {};
  const names = [...new Set(Object.values(after.manifest.images).map((image) => image.name))].sort();
  const key = (name, render, open) => `${name}__${render.theme}__${render.width}${open ? '__open' : ''}`;
  const sets = before ? [[before, '修正前'], [after, '修正後']] : [[after, '画面']];

  const summary = names.map((name) => {
    const cells = RENDERS.map((render) => {
      const [b, a] = [before?.manifest.images[key(name, render, false)], after.manifest.images[key(name, render, false)]];
      return `<td>${esc(before ? delta(b, a) || (a ? `${a.height}px` : '—') : a ? `${a.height}px` : '—')}</td>`;
    }).join('');
    const start = after.manifest.images[key(name, RENDERS[2], false)]?.contentTop;
    const startBefore = before?.manifest.images[key(name, RENDERS[2], false)]?.contentTop;
    return `<tr><th scope="row"><a href="#${esc(name)}">${esc(name)}</a></th>${cells}<td>${esc(startBefore !== undefined && startBefore !== null && before ? `${startBefore}px → ${start}px` : start === undefined || start === null ? '—' : `${start}px`)}</td><td>${esc(review[name]?.verdict ?? '')}</td></tr>`;
  }).join('\n');

  const sections = names.map((name) => {
    const verdict = review[name];
    const recorded = verdict ? `<div class="verdict"><p><strong>${esc(verdict.verdict ?? '')}</strong> ${esc(verdict.notes ?? '')}</p>${verdict.categories ? `<dl>${CATEGORIES.filter((category) => category in verdict.categories).map((category) => `<div><dt>${category}</dt><dd>${esc(verdict.categories[category])}</dd></div>`).join('')}</dl>` : ''}</div>` : '';
    const blocks = RENDERS.map((render) => {
      const closed = sets.map(([set, label]) => figure(set, set.manifest.images[key(name, render, false)], base, label, render.width)).join('');
      const hasOpen = sets.some(([set]) => set.manifest.images[key(name, render, true)]);
      const opened = hasOpen ? `<h4>開閉欄をすべて開いた状態</h4><div class="pair w${render.width}">${sets.map(([set, label]) => figure(set, set.manifest.images[key(name, render, true)], base, `${label}（全開）`, render.width)).join('')}</div>` : '';
      const change = before ? delta(before.manifest.images[key(name, render, false)], after.manifest.images[key(name, render, false)]) : '';
      return `<section class="render"><h3>${esc(render.title)}${change ? ` <small>高さ ${esc(change)}</small>` : ''}</h3><div class="pair w${render.width}">${closed}</div>${opened}</section>`;
    }).join('\n');
    return `<section class="route" id="${esc(name)}"><h2>${esc(name)}</h2>${recorded}${blocks}<p><a href="#top">一覧へ戻る</a></p></section>`;
  }).join('\n');

  const describe = (set, label) => `<li>${esc(label)}：<code>${esc(set.manifest.label)}</code>（コミット <code>${esc(String(set.manifest.commit).slice(0, 12))}</code>${set.manifest.dirty ? '、未コミットの変更あり' : ''}、撮影 ${esc(set.manifest.captured_at)}、${esc(set.manifest.engine)}）</li>`;
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>新 workspace（v3）画面の確認用一覧</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 1.5rem clamp(1rem, 3vw, 3rem) 4rem; font-family: system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", sans-serif; line-height: 1.6; color: CanvasText; background: Canvas; }
h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
h2 { margin: 3rem 0 .5rem; padding-top: 1rem; border-top: 3px solid CanvasText; font-size: 1.35rem; }
h3 { margin: 1.5rem 0 .5rem; font-size: 1.05rem; }
h3 small { margin-left: .75rem; font-weight: 400; font-size: .85rem; }
h4 { margin: 1rem 0 .4rem; font-size: .95rem; }
p, li { max-width: 60rem; }
table { border-collapse: collapse; font-size: .85rem; }
th, td { padding: .35rem .6rem; border: 1px solid GrayText; text-align: left; white-space: nowrap; }
.scroll { overflow-x: auto; }
.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 1rem; align-items: start; }
.pair.w320 { grid-template-columns: repeat(auto-fit, minmax(0, 340px)); }
.pair.w768 { grid-template-columns: repeat(auto-fit, minmax(0, 780px)); }
figure { margin: 0; min-width: 0; }
figcaption { display: flex; flex-wrap: wrap; gap: .25rem .75rem; margin-bottom: .35rem; font-size: .85rem; }
figure img { display: block; width: 100%; height: auto; border: 1px solid GrayText; }
figure.missing p, .alerts { font-size: .85rem; }
.verdict { padding: .5rem .75rem; border: 1px solid GrayText; }
.verdict dl { display: grid; grid-template-columns: max-content 1fr; gap: .15rem .75rem; margin: .25rem 0 0; font-size: .85rem; }
.verdict dl div { display: contents; }
.verdict dd { margin: 0; }
</style>
</head>
<body id="top">
<h1>新 workspace（v3）画面の確認用一覧</h1>
<p>合成データの Storybook を、この端末の Chromium で撮影した画像です。確認用の画像であり、検証済みのビルドの証拠でも基準画像でもありません。画像を選ぶと原寸で開きます。</p>
<ul>
${before ? describe(before, '修正前') : ''}
${describe(after, before ? '修正後' : '画面')}
</ul>
<h2>画面ごとの高さ</h2>
<div class="scroll"><table>
<thead><tr><th scope="col">画面</th>${RENDERS.map((render) => `<th scope="col">${esc(render.title)}</th>`).join('')}<th scope="col">320px で内容が始まる位置</th><th scope="col">確認の記録</th></tr></thead>
<tbody>
${summary}
</tbody>
</table></div>
${sections}
</body>
</html>
`;
  writeFileSync(out, html);
  return { out, routes: names.length };
}

const result = build(args(process.argv.slice(2)));
console.log(`routes=${result.routes} output=${result.out}`);
