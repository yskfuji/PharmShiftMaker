import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Colours in components come from the design tokens only, so the contrast checked by
// devtools/design_tokens/build.mjs is the contrast on screen:
//  - no fixed palette shades (they were tuned for one background and fail on the other);
//  - no opacity on text colours (it lowers contrast below what the tokens guarantee).
const SRC = join(__dirname, '..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const full = join(dir, n);
  if (statSync(full).isDirectory()) return n === '__tests__' ? [] : files(full);
  return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [full] : [];
});
const PALETTE = /(?<![\w-])(?:bg|text|border|ring|from|via|to|fill|stroke|outline|divide|decoration|accent)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d+)?(?:\/\d+)?(?![\w-])/g;
// The dialog scrim is deliberately translucent black in both themes.
const ALLOWED = new Set(['bg-black/60']);

test('components use design-token colours, not fixed palette shades', () => {
  const found = files(SRC).flatMap((f) => (readFileSync(f, 'utf8').match(PALETTE) ?? []).filter((c) => !ALLOWED.has(c)).map((c) => `${f.slice(SRC.length + 1)}: ${c}`));
  expect(found).toEqual([]);
});

test('text colours carry no opacity', () => {
  const found = files(SRC).flatMap((f) => (readFileSync(f, 'utf8').match(/(?<![\w-])text-(?:fg|fg-muted|primary|link|danger|success|warning|saturday|sunday|leave-[a-z]+)\/\d+(?![\w-])/g) ?? []).map((c) => `${f.slice(SRC.length + 1)}: ${c}`));
  expect(found).toEqual([]);
});
