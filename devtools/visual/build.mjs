// Isolated, synthetic build. Never copies .env or changes the working tsconfig.
// Linux dependencies are installed only inside the disposable build copy.
import {cpSync, mkdirSync, symlinkSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, execFileSync} from 'node:child_process';
import {sourceHashes, artifactHashes, buildSourceHashes} from './provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2] && resolve(process.argv[2]);
if (!output || !output.startsWith('/private/tmp/')) throw new Error('Use a new /private/tmp/ build directory');
mkdirSync(output); // exclusive: never overwrite an earlier build/evidence
const frontend = join(output, 'frontend');
mkdirSync(frontend);
const before = sourceHashes(root);
for (const name of ['src', 'scripts', 'stories', '.storybook', 'public', 'package.json', 'package-lock.json',
  'next.config.js', 'next-env.d.ts', 'tsconfig.json', 'tailwind.config.ts', 'postcss.config.js']) {
  if (name === 'public' && !existsSync(join(root,'frontend',name))) continue;
  cpSync(join(root,'frontend',name), join(frontend,name), {recursive:true});
}
const linux = process.argv.includes('--linux');
let renderingBuild = {platform:process.platform, architecture:process.arch, image:null};
if (linux) {
  const image = execFileSync('docker',['image','inspect','--format','{{.Id}}','pharmshift-remediation-frontend:20260922'],{encoding:'utf8'}).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Pinned local image required');
  renderingBuild = {platform:'linux', architecture:execFileSync('docker',['image','inspect','--format','{{.Architecture}}',image],{encoding:'utf8'}).trim(), image};
  // Only the isolated copy is mounted. No repository, credentials, socket or production data.
  const result=spawnSync('docker',['run','--rm','--label','pharmshift.synthetic-audit=true',
    '--cpus','2','--memory','3g','--cap-drop','ALL','--security-opt','no-new-privileges',
    '--mount',`type=bind,src=${output},dst=/build`,'--workdir','/build/frontend',
    '--env','NEXT_PUBLIC_API_BASE_URL=https://127.0.0.1:18540','--env','NEXT_TELEMETRY_DISABLED=1',
    '--env','STORYBOOK_DISABLE_TELEMETRY=1','--entrypoint','sh',image,'-c',
    'node --version > /build/node-version.txt && npm ci --include=dev --no-audit --no-fund > /build/install.log 2>&1 && node node_modules/next/dist/bin/next build --webpack > /build/app.log 2>&1 && node node_modules/storybook/dist/bin/dispatcher.js build -o /build/storybook --disable-telemetry --quiet > /build/storybook.log 2>&1'],{encoding:'utf8',maxBuffer:4*1024*1024});
  writeFileSync(join(output,'linux-build.log'),`${result.stdout??''}\n${result.stderr??''}`);
  if(result.status!==0) throw new Error('Linux build failed; inspect isolated build logs');
} else symlinkSync(join(root,'frontend/node_modules'), join(frontend,'node_modules'));
// Use the exact Node executable that launched this verifier. A detached worktree
// must not depend on an untracked tools/ symlink that happens to exist elsewhere.
const node = process.execPath;
const env = {PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV:'production',
  NEXT_PUBLIC_API_BASE_URL:'https://127.0.0.1:18540', NEXT_TELEMETRY_DISABLED:'1', STORYBOOK_DISABLE_TELEMETRY:'1'};
if (!linux) for (const [name, args] of [
  ['app', ['node_modules/next/dist/bin/next','build','--webpack']],
  ['storybook', ['node_modules/storybook/dist/bin/dispatcher.js','build','-o',join(output,'storybook'),'--disable-telemetry','--quiet']],
]) {
  const result = spawnSync(node,args,{cwd:frontend,env,encoding:'utf8',maxBuffer:32*1024*1024});
  writeFileSync(join(output,`${name}.log`),`${result.stdout??''}\n${result.stderr??''}`);
  if (result.status !== 0) throw new Error(`${name} build failed; inspect ${name}.log`);
}
const after = sourceHashes(root);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Sources changed during the build');
writeFileSync(join(output,'build-manifest.json'),JSON.stringify({schema:1, source_hashes:before,
  build_source_hashes:buildSourceHashes(root),
  rendering_build:renderingBuild, node:process.version, api:env.NEXT_PUBLIC_API_BASE_URL,
  app:artifactHashes(join(frontend,'.next')), storybook:artifactHashes(join(output,'storybook'))},null,2));
console.log(`Verified isolated build: ${output}`);
