const fs = require('node:fs');
const path = require('node:path');

function apiTarget(value) {
  const target = value ?? 'https://localhost:8000';
  const url = new URL(target);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('API target must be an HTTP(S) URL without credentials, query or fragment');
  return target.replace(/\/$/, '');
}

function assertApiContract(frontend, distDir, runtimeValue) {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(frontend, distDir, 'required-server-files.json'), 'utf8'));
  const built = manifest.config?.env?.NEXT_PUBLIC_API_BASE_URL;
  if (!built || apiTarget(built) !== apiTarget(runtimeValue))
    throw new Error('API target differs from the production build. Rebuild or use the matching runtime configuration.');
}

module.exports = {apiTarget, assertApiContract};
