// Deterministic synthetic visual/a11y gallery for the ideal Storybook stories.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(ROOT, 'frontend/package.json'));
const { chromium, firefox, webkit } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const base = process.argv[2] ?? 'http://127.0.0.1:18777';
const output = resolve(process.argv[3] ?? '/private/tmp/pharmshift-ideal-gallery');
mkdirSync(output, { recursive: true });
const storybook = resolve(process.env.PHARMSHIFT_STORYBOOK_DIR ?? resolve(ROOT, 'frontend/storybook-static'));
const index = JSON.parse(readFileSync(resolve(storybook, 'index.json'), 'utf8'));
const requestedStories = (process.env.PHARMSHIFT_STORIES ?? '').split(',').filter(Boolean);
const stories = Object.values(index.entries).filter(entry => entry.title?.startsWith('Ideal UI v3') &&
  (!requestedStories.length || requestedStories.includes(entry.id)));
const availableEngines = { chromium, firefox, webkit };
const requestedEngines = (process.env.PHARMSHIFT_ENGINES ?? 'chromium,firefox,webkit').split(',');
const engines = Object.fromEntries(requestedEngines.map(name => {
  if (!availableEngines[name]) throw new Error(`Unknown engine: ${name}`);
  return [name, availableEngines[name]];
}));
const widths = (process.env.PHARMSHIFT_WIDTHS ?? '320,768,1440').split(',').map(Number);
if (widths.some(width => !Number.isInteger(width) || width < 320 || width > 2560)) throw new Error('Invalid audit width');
const results = [];
const wsEndpoint = process.env.PHARMSHIFT_WS;
const theme = process.env.PHARMSHIFT_THEME ?? 'light';
if (!['light','dark'].includes(theme)) throw new Error('Invalid audit theme');

function writeAudit() {
  writeFileSync(resolve(output, 'audit.json'), JSON.stringify({ generated_at: new Date().toISOString(), locale: 'ja-JP', timezone: 'Asia/Tokyo', theme, reduced_motion: true, results }, null, 2) + '\n');
}

function writeGallery() {
  const cards = results.map(result => `<li><a href="${result.image}"><img src="${result.image}" alt="${result.story}、${result.engine}、幅${result.width}pxの画面"><strong>${result.story}</strong><span>${result.engine} · ${result.width}px · ${theme}</span></a></li>`).join('');
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PharmShiftMaker 認知中心UI v3 画面集</title><style>
  :root{color-scheme:light}body{margin:0;padding:clamp(1rem,3vw,3rem);color:#17344a;background:#f5f7f5;font-family:system-ui,sans-serif}main{max-width:100rem;margin:auto}h1{font-size:clamp(1.5rem,3vw,2.5rem)}p{max-width:55rem;line-height:1.7;color:#526176}ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,22rem),1fr));gap:1rem;padding:0;list-style:none}a{display:grid;gap:.55rem;min-height:44px;padding:.75rem;border:1px solid #d7e0e6;border-radius:1rem;color:inherit;background:white;text-decoration:none}img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;object-position:top;border:1px solid #e2e8ed;border-radius:.6rem;background:white}span{color:#526176;font-size:.85rem}</style><main><p>合成データ・評価用</p><h1>認知中心UI v3 代表画面</h1><p>390 / 1024 / 1920pxを固定した静的画像です。自動検査だけでWCAG適合や使いやすさを認定するものではありません。原寸は各画像を開いて確認できます。</p><ul>${cards}</ul></main></html>`;
  writeFileSync(resolve(output, 'index.html'), html);
}

async function analyzeWhenIdle(page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return (await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations;
    } catch (error) {
      if (!String(error).includes('Axe is already running') || attempt === 19) throw error;
      await page.waitForTimeout(250);
    }
  }
  throw new Error('Axe did not become idle');
}

for (const [engineName, engine] of Object.entries(engines)) {
  const browser = wsEndpoint
    ? await engine.connect(wsEndpoint, { exposeNetwork: '<loopback>', timeout: 60_000 })
    : await engine.launch({ headless: true, timeout: 60_000 });
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: theme, reducedMotion: 'reduce' });
      for (const story of stories) {
        const page = await context.newPage();
        const url = `${base}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=theme:${theme}`;
        await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
        await page.locator('.ideal-v3-app').waitFor({ timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        const violations = await analyzeWhenIdle(page);
        const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        const name = `${engineName}-${theme}-${width}-${story.id}.png`;
        await page.screenshot({ path: resolve(output, name), fullPage: true, animations: 'disabled' });
        results.push({ engine: engineName, width, story: story.id, image: name, url, violations: violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), horizontalOverflow });
        writeAudit();
        writeGallery();
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
writeAudit();
writeGallery();
const failures = results.filter(result => result.horizontalOverflow || result.violations.length);
console.log(`rendered=${results.length} failures=${failures.length} output=${output}`);
if (failures.length) process.exitCode = 1;
