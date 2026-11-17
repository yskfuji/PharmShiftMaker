import {createHash} from 'node:crypto';
import {lstatSync, readdirSync, readFileSync, existsSync} from 'node:fs';
import {join, relative} from 'node:path';

export const BUILD_INPUTS = ['frontend/src', 'frontend/stories', 'frontend/.storybook',
  'frontend/scripts', 'frontend/next.config.js', 'frontend/tailwind.config.ts', 'frontend/postcss.config.js',
  'frontend/tsconfig.json', 'frontend/next-env.d.ts', 'frontend/public', 'frontend/package.json', 'frontend/package-lock.json'];
export const FROZEN = [...BUILD_INPUTS, 'frontend/tests/visual', 'frontend/playwright.visual-linux.config.ts',
  'devtools/visual', 'devtools/design_tokens', 'src/shift_scheduler', 'scripts/remediation_test_server.py',
  'scripts/remediation_fixture.py', 'pyproject.toml', 'poetry.lock'];

export function treeFiles(root) {
  if (!existsSync(root)) return [];
  const info = lstatSync(root);
  if (info.isSymbolicLink()) return [];
  if (info.isFile()) return [root];
  return readdirSync(root).filter(name => !['node_modules', 'cache', '__pycache__', '.output'].includes(name))
    .sort().flatMap(name => treeFiles(join(root, name)));
}
export function hashFiles(root, files) {
  return Object.fromEntries(files.sort().map(file => [relative(root, file), createHash('sha256').update(readFileSync(file)).digest('hex')]));
}
export const sourceHashes = root => hashFiles(root, FROZEN.flatMap(name => treeFiles(join(root, name))));
export const buildSourceHashes = root => hashFiles(root, BUILD_INPUTS.flatMap(name => treeFiles(join(root, name))));
export const artifactHashes = root => hashFiles(root, treeFiles(root));
