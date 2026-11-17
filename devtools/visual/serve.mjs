// Serve a directory (the Storybook static build) on 127.0.0.1 only, read-only.
//   node devtools/visual/serve.mjs <dir> <port>
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const [dir, port] = [resolve(process.argv[2]), Number(process.argv[3] ?? 18530)];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };

createServer((request, response) => {
  let path;
  try { path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)).replace(/^([/\\])+/, ''); }
  catch { response.writeHead(400).end(); return; }   // a malformed escape must not stop the server
  let file = join(dir, path || 'index.html');
  if (!file.startsWith(dir)) { response.writeHead(403).end(); return; }
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); statSync(file); }
  catch { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`serving ${dir} on http://127.0.0.1:${port}`));
