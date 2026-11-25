// PharmShiftMaker desktop shell.
// Starts the bundled Python launcher, waits for its "ready" line, pins TLS to the
// per-install CA, and shows the web app. All servers listen on 127.0.0.1 only.
'use strict';
const { app, BrowserWindow, dialog, session, Menu } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ORIGIN = 'https://127.0.0.1:18513';
const BOOTSTRAP_URL = `${ORIGIN}/api/setup/bootstrap`;
const STOP_TIMEOUT_MS = 30000;
const LOG_LIMIT = 10 * 1024 * 1024;
const smokeResult = process.env.PSM_SMOKE_RESULT || '';

let launcher = null;
let launcherExited = null;
let win = null;
let quitting = false;
let smokeDone = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

function runtimeDir() {
  return app.isPackaged ? path.join(process.resourcesPath, 'runtime') : process.env.PSM_RUNTIME_DIR;
}

function pythonPath(runtime) {
  return process.platform === 'win32'
    ? path.join(runtime, 'python', 'python.exe')
    : path.join(runtime, 'python', 'bin', 'python3');
}

function lockDown(ses, caPem, setupToken) {
  const caKey = new crypto.X509Certificate(caPem).publicKey;
  // Chromium does not pass the issuer for an untrusted root, so verify the leaf
  // signature against the per-install CA public key and require the IP SAN.
  ses.setCertificateVerifyProc((request, callback) => {
    let ok = false;
    try {
      const leaf = new crypto.X509Certificate(request.certificate.data);
      ok = request.hostname === '127.0.0.1' && leaf.verify(caKey) && leaf.checkIP('127.0.0.1') === '127.0.0.1';
    } catch (_error) {
      ok = false;
    }
    callback(ok ? 0 : -2);
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  // The launcher passes a per-launch token only while no account exists.
  if (setupToken) {
    ses.webRequest.onBeforeSendHeaders({ urls: [BOOTSTRAP_URL] }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'X-Setup-Token': setupToken } });
    });
  }
}

function allowed(url) {
  return url === ORIGIN || url.startsWith(`${ORIGIN}/`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'PharmShiftMaker',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // The splash page is loaded programmatically; user and page navigation may
  // only stay on the app origin.
  for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
    win.webContents.on(name, (event) => {
      if (!allowed(event.url)) event.preventDefault();
    });
  }
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'splash.html'));
  win.on('closed', () => {
    win = null;
  });
}

function fail(message) {
  if (smokeDone) return;
  if (smokeResult) {
    fs.writeFileSync(smokeResult, JSON.stringify({ ok: false, message }));
  } else {
    dialog.showErrorBox('PharmShiftMaker を起動できませんでした', message);
  }
  app.quit();
}

function onReady(event) {
  if (quitting || !win) return;
  const ses = session.defaultSession;
  lockDown(ses, fs.readFileSync(event.ca, 'utf8'), event.setup_token);
  if (smokeResult) {
    setTimeout(() => fail('smoke: page did not finish within 120 s'), 120000).unref();
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        let screenshot = false;
        for (let attempt = 0; attempt < 5 && !screenshot; attempt += 1) {
          try {
            const image = await Promise.race([
              win.webContents.capturePage(),
              new Promise((_resolve, reject) => setTimeout(() => reject(new Error('capture timeout')), 5000)),
            ]);
            fs.writeFileSync(smokeResult.replace(/\.json$/, '') + '.png', image.toPNG());
            screenshot = true;
          } catch (_error) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
        let bootstrap = null;
        if (process.env.PSM_SMOKE_BOOTSTRAP === '1' && win.webContents.getURL().endsWith('/setup')) {
          // Test only: the page posts first-run setup itself, so the header
          // injection for the bootstrap URL is exercised end to end.
          const body = JSON.stringify({
            login_id: 'smoke-shell',
            display_name: 'Synthetic Admin',
            password: crypto.randomBytes(18).toString('base64url'),
            facility_id: 'synthetic-facility',
            department_id: 'synthetic-pharmacy',
          });
          bootstrap = await win.webContents.executeJavaScript(
            `fetch('/api/setup/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(r=>r.status)`,
          );
        }
        if (smokeDone) return;
        smokeDone = true;
        fs.writeFileSync(
          smokeResult,
          JSON.stringify({ ok: true, url: win.webContents.getURL(), title: win.webContents.getTitle(), screenshot, bootstrap }),
        );
        app.quit();
      }, Number(process.env.PSM_SMOKE_DELAY_MS || 3000));
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (isMainFrame && code !== -3) fail(`load failed ${code} ${desc} ${url}`);
    });
  }
  win.loadURL(`${ORIGIN}/login`);
}

function start() {
  // macOS delivers Cmd+C/V/X/A and Cmd+Q through the menu's roles, so keep a
  // minimal one there (no reload or developer tools). Elsewhere, no menu.
  Menu.setApplicationMenu(
    process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]) : null,
  );
  createWindow();
  const runtime = runtimeDir();
  if (!runtime || !fs.existsSync(pythonPath(runtime))) {
    fail('同梱の実行環境が見つかりません。インストールし直してください。');
    return;
  }
  // -B: never write __pycache__ into the signed application bundle.
  const args = ['-I', '-B', '-m', 'shift_scheduler.desktop', runtime];
  if (process.env.PSM_DATA_DIR) args.push(process.env.PSM_DATA_DIR);
  const logPath = path.join(app.getPath('logs'), 'launcher.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  try {
    if (fs.statSync(logPath).size > LOG_LIMIT) fs.renameSync(logPath, `${logPath}.1`);
  } catch (_error) {
    // no previous log
  }
  const stderr = fs.openSync(logPath, 'a', 0o600);
  launcher = spawn(pythonPath(runtime), args, { stdio: ['pipe', 'pipe', stderr], windowsHide: true });
  launcherExited = new Promise((resolve) => launcher.once('exit', resolve));
  launcher.once('exit', (code) => {
    launcher = null;
    if (!quitting) fail(`内部の処理が終了しました（コード ${code}）。記録：${logPath}`);
  });
  readline.createInterface({ input: launcher.stdout }).on('line', (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch (_error) {
      return;
    }
    if (event.event === 'stage' && win) win.setTitle(`PharmShiftMaker（起動中：${event.stage}）`);
    else if (event.event === 'ready') onReady(event);
    else if (event.event === 'error') fail(`${event.stage}: ${event.message}${event.log ? `\n記録：${event.log}` : ''}`);
  });
}

app.on('window-all-closed', () => app.quit());
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.quit());

app.on('before-quit', (event) => {
  if (!launcher || quitting) return;
  event.preventDefault();
  quitting = true;
  launcher.stdin.end();
  // SIGTERM only asks the launcher to stop; after the timeout, end it for sure.
  const timer = setTimeout(() => launcher && launcher.kill('SIGKILL'), STOP_TIMEOUT_MS);
  launcherExited.then(() => {
    clearTimeout(timer);
    // Everything behind the window has stopped; do not wait on a stalled renderer.
    setTimeout(() => process.exit(0), 3000);
    app.exit(0);
  });
});
