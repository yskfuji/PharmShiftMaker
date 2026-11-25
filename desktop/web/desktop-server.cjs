// HTTPS entry point for the Next.js standalone build in the desktop edition.
// Copied next to the standalone server.js at build time; started by the Python
// launcher with NEXT_SSL_CERT_PATH / NEXT_SSL_KEY_PATH / HOSTNAME / PORT and
// NODE_EXTRA_CA_CERTS (set before Node starts, so the /api rewrite trusts the CA).
'use strict';
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const dir = __dirname;
const host = process.env.HOSTNAME;
const port = Number(process.env.PORT);
if (host !== '127.0.0.1' || !Number.isInteger(port)) {
  console.error('desktop-server: HOSTNAME must be 127.0.0.1 and PORT an integer');
  process.exit(1);
}
process.env.NODE_ENV = 'production';
process.chdir(dir);

const { config } = require(path.join(dir, '.next', 'required-server-files.json'));
const built = config && config.env && config.env.NEXT_PUBLIC_API_BASE_URL;
if (!built || built.replace(/\/$/, '') !== String(process.env.NEXT_PUBLIC_API_BASE_URL || '').replace(/\/$/, '')) {
  console.error('desktop-server: API target differs from the build');
  process.exit(1);
}
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);

const next = require(require.resolve('next', { paths: [dir] }));
const app = next({ dir, dev: false, hostname: host, port, conf: config });
app
  .prepare()
  .then(() => {
    const handle = app.getRequestHandler();
    https
      .createServer(
        { cert: fs.readFileSync(process.env.NEXT_SSL_CERT_PATH), key: fs.readFileSync(process.env.NEXT_SSL_KEY_PATH) },
        (req, res) => handle(req, res),
      )
      .listen(port, host, () => console.log(`desktop-server ready https://${host}:${port}`));
  })
  .catch((error) => {
    console.error('desktop-server: startup failed', error && error.message);
    process.exit(1);
  });
