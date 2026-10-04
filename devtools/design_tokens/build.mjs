// Design tokens: Digital Agency Design System (DADS) primitives → semantic tokens.
//
//   node devtools/design_tokens/build.mjs           # print the CSS
//   node devtools/design_tokens/build.mjs --write   # write frontend/src/styles/tokens.css
//   node devtools/design_tokens/build.mjs --check   # exit 1 if the file is stale or a pair fails contrast
//
// Source: @digital-go-jp/design-tokens (MIT, © Digital Agency), read from its dist/tokens.js.
// DADS defines a light palette; the dark theme is composed here from the same
// primitives. Semantic colours are written as "R G B" so Tailwind's opacity modifiers
// keep working (rgb(var(--color-x) / <alpha-value>)). Every foreground/background pair
// the components use is checked against WCAG 2.2 AA before anything is written.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'frontend/src/styles/tokens.css');
const require = createRequire(join(ROOT, 'frontend/package.json'));
const dadsPath = require.resolve('@digital-go-jp/design-tokens/dist/tokens.css');
const dadsVersion = JSON.parse(readFileSync(join(dirname(dadsPath), '..', 'package.json'), 'utf8')).version;

// Read the DADS custom properties (the CSS is the published contract).
const dads = Object.fromEntries([...readFileSync(dadsPath, 'utf8').matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const value = (name) => {
  let v = dads[name];
  for (let i = 0; v && v.startsWith('var(') && i < 5; i++) v = dads[v.slice(6, -1)];
  if (!v) throw new Error(`DADS token missing: ${name}`);
  return v;
};
const hex = (name) => { const v = /^#[0-9a-f]{6}$/i.test(name) ? name : value(name); if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a solid colour: ${v}`); return v; };

// Semantic roles → DADS primitives plus product-specific soft neutral/blue colours.
// Literal hex values are product design decisions, not official DADS tokens.
// Per theme. Where a DADS semantic colour does not reach
// 4.5:1 on its tinted background (warning-orange-2 = orange-800 on yellow-50 is 4.44:1;
// error-1 on red-50 is 4.08:1), the next darker primitive of the same hue is used.

const THEMES = {
  light: {
    canvas: '#f5f7fb', surface: 'color-neutral-white', 'surface-raised': 'color-neutral-white',
    'surface-sunken': '#edf1f7', fg: '#23354b', 'fg-muted': '#526176',
    line: '#dce3ec', 'line-strong': 'color-neutral-solid-gray-600', control: '#758397',
    primary: '#315fbe', 'primary-hover': '#234c9e', 'primary-fg': 'color-neutral-white', 'primary-soft': 'color-key-50',
    link: 'color-key-800', danger: 'color-semantic-error-2', 'danger-fg': 'color-neutral-white', 'danger-soft': 'color-primitive-red-50', success: 'color-semantic-success-2',
    'success-soft': 'color-primitive-green-50', warning: 'color-primitive-orange-900', 'warning-soft': 'color-primitive-yellow-50',
    focus: 'color-neutral-black', 'focus-halo': 'color-primitive-yellow-300', muted: 'color-neutral-solid-gray-100',
    // Categories (leave kinds, weekend days): a colour for text/marks and a tint for chips.
    'leave-public': 'color-key-800', 'leave-public-soft': 'color-key-50', 'leave-paid': 'color-primitive-green-800', 'leave-paid-soft': 'color-primitive-green-50',
    'leave-summer': 'color-primitive-orange-900', 'leave-summer-soft': 'color-primitive-orange-50', 'leave-refresh': 'color-primitive-purple-800', 'leave-refresh-soft': 'color-primitive-purple-50',
    saturday: 'color-primitive-blue-800', sunday: 'color-primitive-red-900',
  },
  dark: {
    canvas: '#151e2b', surface: '#1e2b3b', 'surface-raised': '#263547',
    'surface-sunken': '#172333', fg: 'color-neutral-solid-gray-50', 'fg-muted': 'color-neutral-solid-gray-200',
    line: '#3e5065', 'line-strong': 'color-neutral-solid-gray-300', control: 'color-neutral-solid-gray-300',
    primary: 'color-key-300', 'primary-hover': 'color-key-200', 'primary-fg': 'color-key-1200', 'primary-soft': 'color-key-1100',
    link: 'color-key-300', danger: 'color-primitive-red-300', 'danger-fg': 'color-primitive-red-1200', 'danger-soft': 'color-primitive-red-1100', success: 'color-primitive-green-300',
    'success-soft': 'color-primitive-green-1100', warning: 'color-primitive-yellow-300', 'warning-soft': 'color-primitive-orange-1100',
    focus: 'color-primitive-yellow-300', 'focus-halo': 'color-neutral-black', muted: 'color-neutral-solid-gray-700',
    'leave-public': 'color-key-300', 'leave-public-soft': 'color-key-1100', 'leave-paid': 'color-primitive-green-300', 'leave-paid-soft': 'color-primitive-green-1100',
    'leave-summer': 'color-primitive-orange-300', 'leave-summer-soft': 'color-primitive-orange-1100', 'leave-refresh': 'color-primitive-purple-300', 'leave-refresh-soft': 'color-primitive-purple-1100',
    saturday: 'color-primitive-blue-300', sunday: 'color-primitive-red-300',
  },
};

// Pairs checked in both themes (foreground, background, required ratio), generated so that
// no combination the components may use is left out:
//  - neutral text on every background (including the hover tint `muted`);
//  - coloured text on the canvas and every surface, and each category on its own tint;
//  - text on filled buttons; control outlines and focus against what surrounds them.
const BACKGROUNDS = ['canvas', 'surface', 'surface-raised', 'surface-sunken'];
const COLOURED = ['link', 'primary', 'danger', 'success', 'warning', 'leave-public', 'leave-paid', 'leave-summer', 'leave-refresh', 'saturday', 'sunday'];
const PAIRS = [
  ...['fg', 'fg-muted'].flatMap((fg) => [...BACKGROUNDS, 'muted', 'primary-soft', 'danger-soft', 'success-soft', 'warning-soft'].map((bg) => [fg, bg, 4.5])),
  ...COLOURED.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg, 4.5])),
  ...[['primary', 'primary-soft'], ['link', 'primary-soft'], ['danger', 'danger-soft'], ['success', 'success-soft'], ['warning', 'warning-soft'],
    ['leave-public', 'leave-public-soft'], ['leave-paid', 'leave-paid-soft'], ['leave-summer', 'leave-summer-soft'], ['leave-refresh', 'leave-refresh-soft']].map(([fg, bg]) => [fg, bg, 4.5]),
  ...[['primary-fg', 'primary'], ['primary-fg', 'primary-hover'], ['danger-fg', 'danger']].map(([fg, bg]) => [fg, bg, 4.5]),
  ...['control', 'line-strong'].flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg, 3])),
  // The focus ring is drawn outside the control with a gap, so it meets the canvas or a
  // surface; the halo (DADS: black and yellow) separates it from any control colour.
  ...BACKGROUNDS.map((bg) => ['focus', bg, 3]), ['focus', 'focus-halo', 3],
];

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function check() {
  const failures = [];
  for (const [theme, roles] of Object.entries(THEMES)) {
    for (const [fg, bg, need] of PAIRS) {
      const got = ratio(hex(roles[fg]), hex(roles[bg]));
      if (got < need) failures.push(`${theme}: ${fg} on ${bg} = ${got.toFixed(2)} < ${need}`);
    }
  }
  return failures;
}

function block(roles) {
  return Object.entries(roles).map(([role, token]) => `  --color-${role}: ${rgb(hex(token)).join(' ')}; /* ${token} ${hex(token)} */`).join('\n');
}

export function css() {
  const font = (n) => value(`font-size-${n}`);
  return `/* Generated by devtools/design_tokens/build.mjs using @digital-go-jp/design-tokens ${dadsVersion} (MIT, © Digital Agency) and product-specific values. Do not edit. */
/* Semantic colours as "R G B" (Tailwind: rgb(var(--color-x) / <alpha-value>)). Light is the default; */
/* dark applies with data-theme="dark", or with the system preference unless data-theme="light". */
:root, [data-theme="light"] {
  color-scheme: light;
${block(THEMES.light)}
}
[data-theme="dark"] {
  color-scheme: dark;
${block(THEMES.dark)}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${block(THEMES.dark).replaceAll('\n  ', '\n    ').replace(/^  /, '    ')}
  }
}
:root {
  --font-family-sans: ${value('font-family-sans')};
  --font-size-body: ${font(16)};
  --font-size-dense: ${font(14)};
  --line-height-body: ${value('line-height-170')};
  --line-height-dense: ${value('line-height-130')};
  --line-height-heading: ${value('line-height-140')};
  --control-height: 2.75rem;
  --motion-feedback: 140ms;
  --radius-control: 0.625rem;
  --radius-card: 1rem;
  --radius-pill: 999px;
  --font-size-heading-page: 1.625rem;
  --font-size-heading-section: 1.1875rem;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --elevation-raised: 0 4px 18px rgb(27 46 78 / 0.05);
  --elevation-overlay: ${value('elevation-4')};
}
`;
}

const args = process.argv.slice(2);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = check();
  if (failures.length) { console.error('contrast failures:\n' + failures.join('\n')); process.exit(1); }
  if (args.includes('--check')) {
    let current = ''; try { current = readFileSync(OUT, 'utf8'); } catch { /* missing */ }
    if (current !== css()) { console.error('frontend/src/styles/tokens.css is stale; run with --write'); process.exit(1); }
    console.log(`tokens current; ${PAIRS.length * 2} contrast pairs pass`);
  } else if (args.includes('--write')) {
    writeFileSync(OUT, css());
    console.log(`wrote ${OUT}; ${PAIRS.length * 2} contrast pairs pass`);
  } else process.stdout.write(css());
}
