// Rename the old Tailwind colour names to the semantic token names (S1 of the re-skin).
//
//   node devtools/codemod/colors.mjs            # dry run: counts per file
//   node devtools/codemod/colors.mjs --write    # rewrite frontend/src, frontend/stories
//   add --palette to also map fixed status shades to the semantic tokens
//
// Only whole Tailwind class tokens are replaced (bounded by quotes, spaces, backticks or a
// variant prefix such as "hover:"), keeping any opacity suffix ("/60"). `text-base` is a
// font size and is left alone: removing the colour named "base" is what ends the clash.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIRS = ['frontend/src', 'frontend/stories'];
// [utility prefix, old colour, new colour]
const RENAMES = [
  ['bg', 'base', 'canvas'], ['ring-offset', 'base', 'canvas'], ['from', 'base', 'canvas'], ['to', 'base', 'canvas'],
  ['text', 'main', 'fg'], ['text', 'sub', 'fg-muted'], ['placeholder', 'sub', 'fg-muted'], ['bg', 'sub', 'fg-muted'],
  ['bg', 'error', 'danger'], ['text', 'error', 'danger'], ['border', 'error', 'danger'], ['ring', 'error', 'danger'],
  ['border', 'border', 'line'], ['divide', 'border', 'line'], ['bg', 'border', 'line'],
  ['text', 'accent', 'success'], ['bg', 'accent', 'success'],
];
// Status colours written as fixed palette shades (tuned for the old dark canvas) → the
// semantic tokens, which meet contrast in both themes. Categorical hues (leave types:
// emerald/orange/violet chips with a dark shade on a light tint) are kept on purpose.
const PALETTE = [
  [/text-(?:blue|sky)-(?:300|400)/, 'text-link'], [/text-amber-(?:300|400|500|700|800)/, 'text-warning'],
  [/text-(?:sky)-700/, 'text-link'], [/text-red-(?:300|500|700)/, 'text-danger'],
  [/bg-(?:blue|sky)-(?:100|400|500)\/(?:5|10)/, 'bg-primary-soft'], [/bg-sky-100/, 'bg-primary-soft'],
  [/bg-amber-(?:300|400)\/(?:5|10|20)/, 'bg-warning-soft'], [/bg-amber-(?:50|100)(?:\/50)?/, 'bg-warning-soft'], [/bg-yellow-50/, 'bg-warning-soft'],
  [/border-(?:blue|sky)-(?:200|400)(?:\/(?:20|30))?/, 'border-primary/40'], [/border-amber-(?:200|300|400)(?:\/(?:20|30|40|50))?/, 'border-warning/40'],
  [/border-red-(?:300|500|700|800)/, 'border-danger'],
  [/bg-sky-400/, 'bg-primary'], [/bg-amber-400/, 'bg-warning'], [/to-emerald-400/, 'to-success'], [/bg-white/, 'bg-surface'],
];
const palette = (re) => new RegExp(`(?<=^|[\\s"'\`:{(])${re.source}(?=$|[\\s"'\`)}])`, 'g');
const pattern = (prefix, name) => new RegExp(`(?<=^|[\\s"'\`:{(])${prefix}-${name}(?=(/\\d+)?(?=$|[\\s"'\`)}]))`, 'g');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.(tsx?|mdx)$/.test(name) ? [full] : [];
  });
}

const write = process.argv.includes('--write');
let total = 0;
for (const file of DIRS.flatMap((d) => files(join(ROOT, d)))) {
  let text = readFileSync(file, 'utf8');
  let count = 0;
  for (const [prefix, from, to] of RENAMES) {
    text = text.replace(pattern(prefix, from), () => { count++; return `${prefix}-${to}`; });
  }
  if (process.argv.includes('--palette')) {
    for (const [re, to] of PALETTE) text = text.replace(palette(re), () => { count++; return to; });
  }
  if (count) {
    total += count;
    console.log(`${String(count).padStart(4)}  ${relative(ROOT, file)}`);
    if (write) writeFileSync(file, text);
  }
}
console.log(`${write ? 'rewrote' : 'would rewrite'} ${total} class names`);
