// Screenshots of the workspace (v3) route stories for a human review of the design:
// what a person sees, at the widths and themes the review looks at. Diagnostic only —
// macOS Chromium against a local Storybook; nothing here is a verified build or a baseline.
//
//   node devtools/ideal_ui/review_capture.mjs --label <name> [--base http://127.0.0.1:6006]
//        [--routes a,b] [--stories id1,id2] [--open] [--open-routes a,b]
//
// Output: /private/tmp/pharmshift-v3-review/<label>/ (never inside a repository)
//   <route>__<theme>__<width>[__open].png        the full page
//   <route>__<theme>__<width>[__open]__pN.png    the same page in tiles of at most 1400px
//   manifest.json                                commit, dirty flag and, per image, the
//                                                page height and where the content starts
// A label directory is added to, not replaced: capturing a subset later updates its entries.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REVIEW_ROOT = '/private/tmp/pharmshift-v3-review';
const ROUTE_TITLE = 'Ideal UI v3/Cognitive Workspace';
const ROUTE_PREFIX = 'ideal-ui-v3-cognitive-workspace--';
const TILE = 1400;
const RENDERS = [
  { theme: 'light', width: 1440 },
  { theme: 'light', width: 768 },
  { theme: 'light', width: 320 },
  { theme: 'dark', width: 1440 },
];

function args(argv) {
  const out = { base: 'http://127.0.0.1:6006', label: '', routes: [], stories: [], open: false, openRoutes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, value] = [argv[i], argv[i + 1]];
    const list = () => { i += 1; return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean); };
    if (flag === '--base') { out.base = String(value); i += 1; }
    else if (flag === '--label') { out.label = String(value); i += 1; }
    else if (flag === '--routes') out.routes = list();
    else if (flag === '--stories') out.stories = list();
    else if (flag === '--open') out.open = true;
    else if (flag === '--open-routes') out.openRoutes = list();
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(out.label)) throw new Error('--label <name> is required (lower-case letters, digits and hyphens)');
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(out.base)) throw new Error('--base must be a local Storybook (http://127.0.0.1:<port>)');
  return out;
}

/** The output directory: under the review root, and with no repository above it. */
export function outputDir(label, root = REVIEW_ROOT) {
  const dir = resolve(root, label);
  if (!dir.startsWith(REVIEW_ROOT + sep)) throw new Error(`Refusing to write outside ${REVIEW_ROOT}: ${dir}`);
  for (let at = dir; at !== dirname(at); at = dirname(at)) {
    if (existsSync(resolve(at, '.git'))) throw new Error(`Refusing to write inside a repository: ${at}`);
  }
  return dir;
}

function git(...command) {
  try { return execFileSync('git', ['-C', ROOT, ...command], { encoding: 'utf8' }).trim(); } catch { return ''; }
}

/** The 25 route stories: the generated list of the routes, as the visual specs use it. */
function routeStoryIds() {
  const text = readFileSync(resolve(ROOT, 'frontend/src/features/workspace/generated/usecaseRoutes.ts'), 'utf8');
  const block = text.slice(text.indexOf('export const WORKSPACE_STORY_ROUTES'));
  const end = block.indexOf('] as const');
  return [...block.slice(0, end < 0 ? undefined : end).matchAll(/"storybookId":\s*"([^"]+)"/g)].map((match) => match[1]);
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  // Still: the same height and nothing reading, twice in a row.
  let last = -1;
  let calm = 0;
  for (let i = 0; i < 40 && calm < 2; i += 1) {
    const { height, reading } = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      reading: [...document.querySelectorAll('.ideal-v3-content details[open] > p.ideal-note')].some((note) => /読み込んでいます|準備しています/.test(note.textContent ?? '')),
    }));
    calm = height === last && !reading ? calm + 1 : 0;
    last = height;
    await page.waitForTimeout(150);
  }
}

/** Opens every closed `details` of the content, up to three rounds (a task can hold another). */
async function openAll(page) {
  let opened = 0;
  for (let round = 0; round < 3; round += 1) {
    const count = await page.evaluate(() => {
      const closed = [...document.querySelectorAll('.ideal-v3-content details:not([open])')];
      for (const details of closed) details.open = true;
      return closed.length;
    });
    if (!count) break;
    opened += count;
    await settle(page);
  }
  return opened;
}

async function shoot(page, dir, name) {
  const measured = await page.evaluate(() => {
    const content = document.querySelector('.ideal-v3-content');
    return {
      height: Math.ceil(document.documentElement.scrollHeight),
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      contentTop: content ? Math.round(content.getBoundingClientRect().top + scrollY) : null,
      details: document.querySelectorAll('.ideal-v3-content details').length,
      detailsOpen: document.querySelectorAll('.ideal-v3-content details[open]').length,
      alerts: [...document.querySelectorAll('.ideal-v3-content [role="alert"]')].map((alert) => (alert.textContent ?? '').trim().slice(0, 100)),
    };
  });
  for (const stale of readdirSync(dir)) if (stale.startsWith(`${name}__p`) && stale.endsWith('.png')) rmSync(resolve(dir, stale));
  await page.screenshot({ path: resolve(dir, `${name}.png`), fullPage: true, animations: 'disabled' });
  const tiles = [];
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  for (let top = 0, index = 1; top < measured.height; top += TILE, index += 1) {
    const file = `${name}__p${index}.png`;
    await page.screenshot({ path: resolve(dir, file), fullPage: true, animations: 'disabled', clip: { x: 0, y: top, width, height: Math.min(TILE, measured.height - top) } });
    tiles.push(file);
  }
  return { image: `${name}.png`, tiles, ...measured };
}

async function main() {
  const options = args(process.argv.slice(2));
  const dir = outputDir(options.label);
  mkdirSync(dir, { recursive: true });
  const require = createRequire(resolve(ROOT, 'frontend/package.json'));
  const { chromium } = require('@playwright/test');

  const index = await (await fetch(`${options.base}/index.json`)).json();
  const known = new Set(Object.keys(index.entries));
  const routeIds = routeStoryIds().filter((id) => known.has(id) && index.entries[id].title === ROUTE_TITLE);
  const short = (id) => (id.startsWith(ROUTE_PREFIX) ? id.slice(ROUTE_PREFIX.length) : id);
  for (const wanted of [...options.routes, ...options.openRoutes]) if (!routeIds.some((id) => short(id) === wanted)) throw new Error(`Unknown route: ${wanted} (known: ${routeIds.map(short).join(', ')})`);
  for (const wanted of options.stories) if (!known.has(wanted)) throw new Error(`Unknown story id: ${wanted}`);
  const routes = options.routes.length ? routeIds.filter((id) => options.routes.includes(short(id))) : options.stories.length ? [] : routeIds;
  const targets = [...routes.map((id) => ({ id, name: short(id), kind: 'route' })), ...options.stories.map((id) => ({ id, name: id, kind: 'story' }))];
  const opens = (target) => options.open || options.openRoutes.includes(target.name);

  const manifestPath = resolve(dir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { label: options.label, images: {} };
  Object.assign(manifest, {
    label: options.label,
    captured_at: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    dirty_paths: git('status', '--porcelain').split('\n').filter(Boolean).slice(0, 40),
    base: options.base,
    engine: 'chromium (local, macOS)',
    viewport_height: 900,
    tile_height: TILE,
    note: 'Diagnostic screenshots of synthetic stories for a human review. Not a verified build, not a baseline.',
  });
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // The browser's own language is Japanese, as a user's is. The context's `locale` sets what
  // a page reads (navigator.language, Intl), but a native date or time field is drawn by the
  // browser in its interface language, and headless Chromium takes that from --lang (the
  // LANG variable alone changes nothing). Without it an empty field reads
  // "mm/dd/yyyy, --:--:-- --" (month first, twelve hours with AM/PM); with it
  // "yyyy/mm/dd --:--:--" (year first, twenty-four hours), the order a Japanese browser uses.
  const browser = await chromium.launch({ headless: true, timeout: 60_000, args: ['--lang=ja-JP'] });
  let count = 0;
  try {
    for (const { theme, width } of RENDERS) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: theme, reducedMotion: 'reduce' });
      for (const target of targets) {
        const page = await context.newPage();
        const url = `${options.base}/iframe.html?id=${encodeURIComponent(target.id)}&viewMode=story&globals=theme:${theme}`;
        await page.goto(url, { waitUntil: 'commit', timeout: 60_000 });
        await page.locator('.ideal-v3-app').first().waitFor({ timeout: 60_000 });
        await settle(page);
        const name = `${target.name}__${theme}__${width}`;
        const entry = { story: target.id, name: target.name, kind: target.kind, theme, width, open: false };
        manifest.images[name] = { ...entry, ...(await shoot(page, dir, name)) };
        count += 1;
        if (opens(target)) {
          const opened = await openAll(page);
          manifest.images[`${name}__open`] = { ...entry, open: true, opened, ...(await shoot(page, dir, `${name}__open`)) };
          count += 1;
        }
        save();
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  save();
  console.log(`captured=${count} targets=${targets.length} output=${dir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
