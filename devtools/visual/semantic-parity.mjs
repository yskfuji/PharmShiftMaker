// Element-preservation check: two versions of each .tsx file must have the same syntax
// tree once every className attribute is removed. Anything else that differs
// (elements, order, text, props such as type/name/ref/aria-*/disabled/on*, logic) fails.
//   node semantic-parity.mjs <before-root> <after-root> [relative files...]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [beforeRoot, afterRoot, ...only] = process.argv.slice(2);
// The TypeScript parser always comes from the repository's frontend (PARITY_TS_FROM overrides).
const require = createRequire(process.env.PARITY_TS_FROM ?? path.join(process.cwd(), 'frontend/package.json'));
const ts = require('typescript');

function shape(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let elements = 0;
  const out = [];
  const walk = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'className') return; // presentation only: added, removed or changed classes are ignored
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements++;
    const kind = ts.SyntaxKind[node.kind];
    // List nodes are containers only: an element whose sole attribute was className has a
    // non-empty list, one without attributes an empty one; compare their contents instead.
    if (node.kind === ts.SyntaxKind.SyntaxList) { node.getChildren(sf).forEach(walk); return; }
    if (node.getChildCount(sf) === 0) out.push(`${kind}:${node.getText(sf)}`);
    else { out.push(`(${kind}`); node.getChildren(sf).forEach(walk); out.push(')'); }
  };
  walk(sf);
  return { tree: out.join(' '), elements };
}

const list = only.length ? only : fs.readFileSync(0, 'utf8').split('\n').filter(Boolean);
const results = [];
for (const rel of list) {
  const a = path.join(beforeRoot, rel), b = path.join(afterRoot, rel);
  if (!fs.existsSync(a) || !fs.existsSync(b)) { results.push({ file: rel, error: 'missing in one version' }); continue; }
  const x = shape(a), y = shape(b);
  results.push({ file: rel, elements_before: x.elements, elements_after: y.elements, non_class_ast_equal: x.tree === y.tree });
}
process.stdout.write(JSON.stringify(results, null, 1) + '\n');
process.exitCode = results.every((r) => r.non_class_ast_equal) ? 0 : 1;
