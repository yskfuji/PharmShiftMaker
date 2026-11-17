// Visual and optical audit runner (docs/design-system/README.md).
//
//   node devtools/visual/run.mjs --run-id visual-2026-09-28-r1 --storybook <static dir>
//        [--app <frontend dist dir>] [--python <python>] [--tls-cert <pem>]
//        [--tls-key <pem>] [--tls-ca <pem>] [--themes light,dark]
//        [--no-screenshots] [--update-baselines]
//
// It checks that its ports are free, serves the Storybook build on 127.0.0.1:18530,
// optionally starts the synthetic API (the build's isolated port) and the app (18531), runs
// playwright.visual-linux.config.ts against the labelled browser container on
// 127.0.0.1:18526, and writes evidence to audit/<run-id>/ (created exclusively).
// Sources and baselines are hashed before and after; a change during the run
// invalidates it. Only the processes it started are stopped.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {sourceHashes, artifactHashes, buildSourceHashes} from './provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FRONTEND = join(ROOT, 'frontend');
// The caller selects the pinned Node version; keep the audit reproducible in a
// detached worktree without reaching into another working tree's untracked tools/.
const NODE = process.execPath;
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const runId = option('--run-id');
const storybook = option('--storybook');
const app = option('--app');
const project = option('--project');
if (project && !['chromium-linux','firefox-linux','webkit-linux'].includes(project)) throw new Error('Unknown audit browser project');
const shard = option('--shard');
if (shard && !/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error('Invalid Playwright shard; expected N/M');
if (!runId || !/^visual-[\w.-]+$/.test(runId) || !storybook) {
  console.error('usage: --run-id visual-<id> --storybook <dir> [--app <dist>] [--themes a,b] [--no-screenshots] [--update-baselines]');
  process.exit(2);
}
const buildDir = option('--build-dir');
const appFrontend = buildDir ? join(resolve(buildDir), 'frontend') : FRONTEND;
const python = resolve(option('--python', join(ROOT, '.venv/bin/python')));
const tlsCert = resolve(option('--tls-cert', join(ROOT, 'certs/localhost-cert.pem')));
const tlsKey = resolve(option('--tls-key', join(ROOT, 'certs/localhost-key.pem')));
const tlsCa = resolve(option('--tls-ca', join(ROOT, 'certs/dev-rootCA.pem')));
const allowedRuntimePath = (path) => path.startsWith('/private/tmp/') || path.startsWith(resolve(ROOT, 'certs') + '/');
if (app) {
  for (const [label, path] of [['Python', python], ['TLS certificate', tlsCert], ['TLS key', tlsKey], ['TLS CA', tlsCa]]) {
    if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  }
  for (const [label, path] of [['TLS certificate', tlsCert], ['TLS key', tlsKey], ['TLS CA', tlsCa]]) {
    if (!allowedRuntimePath(path)) throw new Error(`${label} must be in repository certs/ or /private/tmp`);
  }
}
if (!buildDir && !args.includes('--legacy-diagnostic')) throw new Error('A verified --build-dir is required; old builds may only run as --legacy-diagnostic');
const buildProof = buildDir ? JSON.parse(readFileSync(join(resolve(buildDir),'build-manifest.json'),'utf8')) : null;
const apiPort = buildProof ? Number(new URL(buildProof.api).port) : 18510;
if (![18510,18540].includes(apiPort)) throw new Error('Only isolated audit API ports are allowed');
if (buildProof && (JSON.stringify(buildProof.build_source_hashes) !== JSON.stringify(buildSourceHashes(ROOT))
  || JSON.stringify(buildProof.app) !== JSON.stringify(artifactHashes(join(appFrontend,app || '.next')))
  || JSON.stringify(buildProof.storybook) !== JSON.stringify(artifactHashes(resolve(storybook))))) throw new Error('Build/source/artifact hash mismatch');
const browserContainer = option('--browser-container', 'pharmshift-ui-ux-browser-r1');
if (!/^pharmshift-[a-z0-9-]+$/.test(browserContainer)) throw new Error('Invalid audit container name');
const browserEvidence = execFileSync('docker', ['inspect','--format','{{.Image}} {{index .Config.Labels "pharmshift.synthetic-audit"}}',browserContainer], {encoding:'utf8'}).trim();
if (!browserEvidence.endsWith(' true')) throw new Error('Browser container is not labelled for synthetic auditing');
const browserPorts = JSON.parse(execFileSync('docker', ['inspect','--format','{{json .NetworkSettings.Ports}}',browserContainer], {encoding:'utf8'}));
if (!browserPorts['3000/tcp']?.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === '18526')) {
  throw new Error('The inspected browser container must own loopback port 18526');
}
const browserEndpoint = 'ws://127.0.0.1:18526';
if (process.env.VISUAL_BROWSER_WS && process.env.VISUAL_BROWSER_WS !== browserEndpoint) {
  throw new Error('VISUAL_BROWSER_WS differs from the inspected audit browser');
}
const outputRoot = option('--output-root', join(ROOT, 'audit'));
const resolvedOutputRoot = resolve(outputRoot);
if (resolvedOutputRoot !== join(ROOT, 'audit') && !resolvedOutputRoot.startsWith('/private/tmp/')) {
  throw new Error('Audit output must use repository audit/ or /private/tmp/');
}
const out = join(resolvedOutputRoot, runId);
if (existsSync(out)) { console.error(`${out} exists; evidence is never overwritten`); process.exit(2); }

function files(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((e) => (e.name === '.output' ? [] : files(relative(ROOT, join(full, e.name)))));
}
const hashes = () => sourceHashes(ROOT);
const occupied = (port) => new Promise((done) => { const s = createConnection({ port, host: '127.0.0.1' }, () => { s.end(); done(true); }); s.on('error', () => done(false)); });

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(PHARMSHIFT_|SHIFT_SCHEDULER_|DATABASE_|AUTH_|API_CORS_|FRONTEND_|E2E_|NEXT_|PW_TEST_|PLAYWRIGHT_|VISUAL_)/.test(key)));
const started = [];
function start(name, command, argv, options) {
  const child = spawn(command, argv, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  const logPath = join(out, `${name}.log`);
  writeFileSync(logPath, '', {flag:'wx'});
  child.stdout.on('data', d => appendFileSync(logPath, d));
  child.stderr.on('data', d => appendFileSync(logPath, d));
  started.push({ name, child });
  return child;
}
async function waitFor(port, seconds = 90) {
  for (let i = 0; i < seconds; i++) { if (await occupied(port)) return; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error(`port ${port} did not open`);
}

const ports = [18530, ...(app ? [apiPort, 18531] : [])];
for (const port of ports) if (await occupied(port)) { console.error(`port ${port} is in use; refusing to run`); process.exit(3); }
if (!(await occupied(18526))) { console.error('browser container on 127.0.0.1:18526 is not running (see docs/design-system/README.md)'); process.exit(3); }

// The audited builds must be newer than every source they were built from; a stale build
// would audit something other than the code (the run records which builds it used).
const SOURCES = ['frontend/src', 'frontend/stories', 'frontend/.storybook', 'frontend/tailwind.config.ts'];
const newest = Math.max(...SOURCES.flatMap(files).map((f) => statSync(f).mtimeMs));
const builds = { storybook: join(resolve(storybook), 'index.json'), ...(app ? { app: join(appFrontend, app, 'BUILD_ID') } : {}) };
for (const [name, marker] of Object.entries(builds)) {
  if (!existsSync(marker)) { console.error(`${name} build marker missing: ${marker}`); process.exit(3); }
  if (statSync(marker).mtimeMs < newest) { console.error(`${name} build is older than the sources; rebuild before auditing`); process.exit(3); }
}
const buildIds = Object.fromEntries(Object.entries(builds).map(([name, marker]) => [name, { marker, built_at: new Date(statSync(marker).mtimeMs).toISOString(),
  sha256: createHash('sha256').update(readFileSync(marker)).digest('hex') }]));

mkdirSync(out, { recursive: true });
const before = hashes();
let status = 1;
try {
  start('storybook-static', NODE, [join(ROOT, 'devtools/visual/serve.mjs'), resolve(storybook), '18530'], { cwd: ROOT });
  await waitFor(18530);
  if (app) {
    const env = { ...cleanEnv, PHARMSHIFT_E2E_PORT:String(apiPort), PHARMSHIFT_E2E_OBSERVATION_TIME:'2026-09-28T00:00:00+00:00', PHARMSHIFT_E2E_FLEX: '1', PHARMSHIFT_E2E_FRONTEND_ORIGIN: 'https://127.0.0.1:18531', PHARMSHIFT_E2E_TLS_CERT:tlsCert, PHARMSHIFT_E2E_TLS_KEY:tlsKey, PYTHONPATH: 'src' };
    if (args.includes('--published')) env.PHARMSHIFT_E2E_PUBLICATION = '1';
    if (args.includes('--postgres-ui')) {
      const ownership = execFileSync('docker',['inspect','--format','{{index .Config.Labels "pharmshift.synthetic-audit"}}','pharmshift-ui-ux-db-r1'],{encoding:'utf8'}).trim();
      if (ownership !== 'true') throw new Error('Owned synthetic database required');
      env.PHARMSHIFT_E2E_PG_URL='postgresql+psycopg://audit:synthetic-ui-only@127.0.0.1:55449/pharmshift_audit_uiux';
    }
    start('synthetic-api', python, ['-m', 'scripts.remediation_test_server'], { cwd: ROOT, env });
    start('app', NODE, ['scripts/start-https-server.mjs', '--hostname', '127.0.0.1', '--port', '18531'],
      // Client and SSR use the fixed build target; startup verifies runtime agreement.
      { cwd: appFrontend, env: { ...cleanEnv, NEXT_DIST_DIR: app, NEXT_PUBLIC_API_BASE_URL: `https://127.0.0.1:${apiPort}`, NEXT_SSL_CERT_PATH: tlsCert, NEXT_SSL_KEY_PATH: tlsKey, NODE_EXTRA_CA_CERTS: tlsCa,
        // --ideal: serve the synthetic showcase and the API-backed preview (both off by default).
        ...(args.includes('--ideal') ? { IDEAL_SHOWCASE: '1', IDEAL_PREVIEW: '1' } : {}),
        // --ideal-ui: the ideal UI as the production entry (/workspace, landing page).
        ...(args.includes('--ideal-ui') ? { IDEAL_UI: '1' } : {}) } });
    await waitFor(apiPort); await waitFor(18531);
  }
  const specs = option('--spec') ? [option('--spec')] : app ? [] : ['tests/visual/storybook.pw.ts'];
  const env = { ...cleanEnv, VISUAL_BROWSER_WS: browserEndpoint, VISUAL_OUTPUT: out, VISUAL_WORKERS: option('--workers', '1'), VISUAL_STORY_IDS: option('--story',''), VISUAL_PUBLISHED: args.includes('--published') ? '1' : '0', VISUAL_THEMES: option('--themes', 'light,dark'),
    VISUAL_SCREENSHOTS: args.includes('--no-screenshots') ? '0' : '1', VISUAL_IDEAL_UI: args.includes('--ideal-ui') ? '1' : '0', VISUAL_BASELINE_UPDATE: args.includes('--update-baselines') ? '1' : '0' };
  const test = start('playwright', NODE, ['node_modules/@playwright/test/cli.js', 'test', '-c', 'playwright.visual-linux.config.ts', ...specs, ...(project?[`--project=${project}`]:[]), ...(shard?[`--shard=${shard}`]:[])],
    { cwd: FRONTEND, env });
  status = await new Promise((done) => test.on('exit', (code) => done(code ?? 1)));
} finally {
  for (const { child } of started.reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  const after = hashes();
  const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
  // A baseline update is expected to write baselines; everything else must stay as it was.
  const updating = args.includes('--update-baselines');
  const baselines = changed.filter((k) => k.includes('/__screenshots__/'));
  const drift = updating ? changed.filter((k) => !k.includes('/__screenshots__/')) : changed;
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ run_id: runId, finished_at: new Date().toISOString(), storybook: resolve(storybook),
    presentation_clock: '2026-09-28T00:00:00+00:00', tls: app ? { certificate_sha256:createHash('sha256').update(readFileSync(tlsCert)).digest('hex'), ca_sha256:createHash('sha256').update(readFileSync(tlsCa)).digest('hex'), private_key_recorded:false } : null,
    app: app ?? null, verified_build: !!buildProof, browser_container: browserContainer, browser_evidence: browserEvidence, browser_endpoint: browserEndpoint, browser_ports: browserPorts, builds: buildIds, artifact_manifest: buildProof,  newest_source: new Date(newest).toISOString(), args, playwright_exit: status, sources_unchanged: drift.length === 0, drift,
    baselines_written: updating ? baselines : [], baseline_hashes: updating ? Object.fromEntries(baselines.map((k) => [k, after[k] ?? null])) : {},
    source_hashes: before }, null, 1) + '\n');
  if (drift.length) { console.error(`sources changed during the run (${drift.length}); the result cannot be accepted`); status = 4; }
}
process.exit(status);
